// Roda o app no modo demonstração (banco no navegador) mesmo com o
// Supabase configurado no .env.local — para testar sem mexer nos dados reais.
// Uso: npm run dev:demo
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL = ''
process.env.VITE_SUPABASE_ANON_KEY = ''

const servidor = await createServer({ server: { port: 5174, strictPort: true } })
await servidor.listen()
servidor.printUrls()
