// Guarda a chave do Brevo nos segredos das Edge Functions do Supabase,
// para o pickgo enviar comprovantes e avisos por e-mail.
// A chave é digitada escondida e vai direto para o Supabase (não fica no projeto).
//
//   node scripts/configurar-email.mjs
//
// Precisa de `npx supabase login` e `npx supabase link` feitos antes.
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

function perguntar(texto, oculto = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((ok) => {
    rl.question(texto, (r) => { if (oculto) process.stdout.write('\n'); rl.close(); ok(r.trim()) })
    // a pergunta já foi escrita: daqui em diante nada do que é digitado ou colado aparece
    if (oculto) rl._writeToOutput = () => {}
  })
}

console.log('E-mails do pickgo pelo Brevo (a chave não aparece enquanto você digita ou cola)\n')
const remetente = (await perguntar('E-mail que envia [pickgoadm@gmail.com]: ')) || 'pickgoadm@gmail.com'
const chave = await perguntar('Chave de API do Brevo (começa com xkeysib-): ', true)
if (!/^xkeysib-[\w-]{20,}$/.test(chave)) {
  console.error('Essa não parece uma chave de API do Brevo (deve começar com "xkeysib-"). Nada foi alterado.')
  process.exit(1)
}

// arquivo temporário só durante o envio para o Supabase
const arquivo = join(tmpdir(), `pickgo-${randomBytes(6).toString('hex')}.env`)
try {
  writeFileSync(arquivo, `BREVO_API_KEY=${chave}\nEMAIL_FROM=pickgo <${remetente}>\n`, { mode: 0o600 })
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  execSync(`${npx} --yes supabase secrets set --env-file "${arquivo}"`, { stdio: ['ignore', 'ignore', 'inherit'], shell: true })
  console.log(`\n✓ Pronto! Os e-mails do pickgo vão sair de ${remetente}.`)
  console.log('Teste no painel: Avisos → "Receber por e-mail" → Enviar teste.')
} catch {
  console.error('\nNão consegui salvar no Supabase. Confira se fez `npx supabase login` e `npx supabase link`.')
  process.exitCode = 1
} finally {
  rmSync(arquivo, { force: true })
}
