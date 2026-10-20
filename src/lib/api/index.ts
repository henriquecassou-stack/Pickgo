import type { Api } from './contrato'
import { criarApiSupabase } from './supabase'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Sem Supabase configurado, o app roda em modo demonstração. */
export const MODO_DEMO = !url || !chave || import.meta.env.VITE_MODO_DEMO === 'true'

let instancia: Api | null = null
const progresso = new Set<(msg: string) => void>()

export async function obterApi(): Promise<Api> {
  if (instancia) return instancia
  if (MODO_DEMO) {
    // carregado sob demanda: o PGlite (WASM) não entra no bundle de produção
    const { criarApiDemo } = await import('./demo')
    instancia = criarApiDemo((m) => progresso.forEach((cb) => cb(m)))
  } else {
    instancia = criarApiSupabase(url!, chave!)
  }
  return instancia
}

export function aoProgressoDemo(cb: (msg: string) => void) {
  progresso.add(cb)
  return () => progresso.delete(cb)
}

export type { Api }
