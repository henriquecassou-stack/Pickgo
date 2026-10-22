-- Envio imediato dos avisos por e-mail: quando surge um aviso de nível configurado
-- (urgente/atenção), chama a Edge Function enviar-avisos na hora, via pg_net.
-- O cron de 10 em 10 minutos continua como rede de segurança.
--
-- Usa dois segredos do Vault (gravados por scripts/agendar-avisos.mjs):
--   avisos_funcao_url   -> https://<projeto>.supabase.co/functions/v1/enviar-avisos
--   avisos_cron_secret  -> segredo conferido pela função (x-cron-secret)
-- Sem pg_net ou sem os segredos (ex.: modo demonstração), não faz nada.
-- O pedido do pg_net só sai depois do COMMIT: se a transação desfizer, nada é enviado.

create or replace function public.disparar_envio_avisos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cfg  config_avisos%rowtype;
  v_url  text;
  v_seg  text;
begin
  if coalesce(current_setting('app.sem_avisos', true), '') = 'on' then return null; end if;
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then return null; end if;

  select * into v_cfg from config_avisos where id = 1;
  if not found or v_cfg.email is null or not v_cfg.enviar_imediato then return null; end if;
  if not exists (select 1 from novos where gravidade = any (v_cfg.niveis_imediato) and not resolvido) then return null; end if;

  execute $q$ select
      (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_funcao_url'),
      (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret') $q$
    into v_url, v_seg;
  if v_url is null or v_seg is null then return null; end if;

  execute $q$ select net.http_post(url := $1, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', $2),
                                    body := '{"modo":"pendentes"}'::jsonb) $q$
    using v_url, v_seg;
  return null;
exception when others then
  -- o aviso nunca deixa de ser criado por causa do e-mail; o cron tenta depois
  raise warning 'disparar_envio_avisos: %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_avisos_envio_imediato on public.avisos;
create trigger trg_avisos_envio_imediato
  after insert on public.avisos
  referencing new table as novos
  for each statement execute function public.disparar_envio_avisos();
