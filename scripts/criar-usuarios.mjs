// Cria (ou atualiza) as contas do administrador e do totem.
// Usa a service role key — rode só na sua máquina, nunca no navegador.
//
//   node scripts/criar-usuarios.mjs <email-admin> <senha-admin> <email-totem> <senha-totem>
//
// Variáveis: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (lidas do ambiente ou do .env.local)
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const linha of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
const [emailAdmin, senhaAdmin, emailTotem, senhaTotem] = process.argv.slice(2)
if (!url || !chave || !emailAdmin || !senhaAdmin || !emailTotem || !senhaTotem) {
  console.error('Uso: node scripts/criar-usuarios.mjs <email-admin> <senha-admin> <email-totem> <senha-totem>')
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
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
