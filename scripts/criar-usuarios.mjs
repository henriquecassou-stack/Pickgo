// Cria (ou atualiza) as contas do administrador e do totem.
// Usa a service role key — rode só na sua máquina, nunca no navegador.
//
//   node scripts/criar-usuarios.mjs                      (pergunta e-mails e senhas)
//   node scripts/criar-usuarios.mjs <email-admin> <senha-admin> <email-totem> <senha-totem>
//
// URL: VITE_SUPABASE_URL do .env.local (ou SUPABASE_URL).
// Chave: SUPABASE_SERVICE_ROLE_KEY; sem ela, busca pela CLI do Supabase
// (precisa de `supabase login` e `supabase link`). A chave nunca é exibida.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (existsSync('.env.local')) {
  for (const linha of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function chaveDaCli() {
  const ref = existsSync('supabase/.temp/project-ref') ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() : ''
  if (!ref) return null
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  try {
    const saida = execSync(`${npx} --yes supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'], shell: true }).toString()
    return JSON.parse(saida).find((k) => k.name === 'service_role')?.api_key ?? null
  } catch {
    return null
  }
}

function perguntar(texto, oculto = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((ok) => {
    rl.question(texto, (r) => { if (oculto) process.stdout.write('\n'); rl.close(); ok(r.trim()) })
    // a pergunta já foi escrita: daqui em diante nada do que é digitado ou colado aparece
    if (oculto) rl._writeToOutput = () => {}
  })
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || chaveDaCli()
if (!url || !chave) {
  console.error('Não achei a URL ou a service role key do Supabase.')
  console.error('Rode `npx supabase login` e `npx supabase link`, ou defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

let [emailAdmin, senhaAdmin, emailTotem, senhaTotem] = process.argv.slice(2)
if (!emailTotem) {
  console.log('Contas do pickgo (a senha não aparece enquanto você digita)\n')
  emailAdmin = await perguntar('E-mail do administrador: ')
  senhaAdmin = await perguntar('Senha do administrador (mín. 8): ', true)
  emailTotem = await perguntar('E-mail do totem: ')
  senhaTotem = await perguntar('Senha do totem (mín. 8): ', true)
}
for (const [email, senha] of [[emailAdmin, senhaAdmin], [emailTotem, senhaTotem]]) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) { console.error(`E-mail inválido: ${email}`); process.exit(1) }
  if ((senha ?? '').length < 8) { console.error(`Senha de ${email} muito curta (mínimo 8 caracteres).`); process.exit(1) }
}

const db = createClient(url, chave, { auth: { persistSession: false } })

async function garantir(email, senha, perfil, nome) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    app_metadata: { perfil }, user_metadata: { nome },
  })
  let id = data?.user?.id
  if (error) {
    if (!/already|registered|exists/i.test(error.message)) throw error
    const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 })
    id = lista.users.find((u) => u.email === email)?.id
    await db.auth.admin.updateUserById(id, { password: senha, app_metadata: { perfil } })
  }
  const { error: e2 } = await db.from('usuarios').upsert({ id, email, nome, perfil, ativo: true })
  if (e2) throw e2
  console.log(`✓ ${perfil.padEnd(5)} ${email}`)
}

await garantir(emailAdmin, senhaAdmin, 'admin', 'Administrador')
await garantir(emailTotem, senhaTotem, 'totem', 'Totem da portaria')
console.log('\nPronto! Use essas contas para entrar no painel e no totem.')
