// Agenda o envio automático dos avisos (pg_cron + pg_net), com o segredo do cron
// guardado no Vault do Supabase e nos segredos das Edge Functions. Nada é exibido.
// Uso: node scripts/agendar-avisos.mjs  (precisa de `npx supabase login` e `npx supabase link`)
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const segredo = randomBytes(24).toString('hex')
const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
const url = `https://${ref}.supabase.co/functions/v1/enviar-avisos`
const env = join(tmpdir(), `pickgo-${randomBytes(4).toString('hex')}.env`)
const sql = join(tmpdir(), `pickgo-${randomBytes(4).toString('hex')}.sql`)

const chamada = (modo) => `$job$
  select net.http_post(
    url := '${url}',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret')),
    body := '{"modo":"${modo}"}'::jsonb)
$job$`

try {
  writeFileSync(env, `AVISOS_CRON_SECRET=${segredo}\n`)
  execSync(`${npx} --yes supabase secrets set --env-file "${env}"`, { stdio: ['ignore', 'ignore', 'inherit'], shell: true })

  writeFileSync(sql, `
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from vault.secrets where name = 'avisos_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'avisos_cron_secret'), '${segredo}');
  else
    perform vault.create_secret('${segredo}', 'avisos_cron_secret', 'Segredo do cron para a Edge Function enviar-avisos');
  end if;
  -- endereço da função, usado pelo envio imediato (trigger em avisos)
  if exists (select 1 from vault.secrets where name = 'avisos_funcao_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'avisos_funcao_url'), '${url}');
  else
    perform vault.create_secret('${url}', 'avisos_funcao_url', 'URL da Edge Function enviar-avisos');
  end if;
end $$;

-- avisos novos (urgente/atenção) a cada 10 minutos
select cron.schedule('avisos-pendentes', '*/10 * * * *', ${chamada('pendentes')});
-- resumo diário às 8h de Brasília (11h UTC)
select cron.schedule('avisos-resumo', '0 11 * * *', ${chamada('resumo')});
-- validade e estoque: varredura diária às 6h de Brasília (9h UTC)
select cron.schedule('verificar-avisos', '0 9 * * *', 'select public.verificar_avisos()');

select jobname, schedule, active from cron.job order by jobname;
`)
  const saida = execSync(`${npx} --yes supabase db query --linked -f "${sql}"`, { shell: true }).toString()
  console.log(saida.replace(/[0-9a-f]{40,}/g, '…'))
} finally {
  rmSync(env, { force: true })
  rmSync(sql, { force: true })
}
