import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export function erro(mensagem: string, status = 400) {
  return json({ erro: mensagem }, status)
}

/** Cliente com service role: ignora RLS. Só existe no backend. */
export function clienteServico(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

export type Perfil = 'admin' | 'totem'

/** Valida o JWT do chamador e devolve id + perfil. */
export async function usuarioDaRequisicao(req: Request, db: SupabaseClient) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: perfil } = await db.from('usuarios').select('id, perfil, ativo').eq('id', data.user.id).single()
  if (!perfil?.ativo) return null
  return { id: perfil.id as string, perfil: perfil.perfil as Perfil }
}

/** Provedor ativo: 'mercadopago' quando há token configurado, senão 'simulado' (sandbox local). */
export function provedorAtivo(): 'mercadopago' | 'simulado' {
  const forcado = Deno.env.get('PAYMENT_PROVIDER')
  if (forcado === 'simulado') return 'simulado'
  return Deno.env.get('MP_ACCESS_TOKEN') ? 'mercadopago' : 'simulado'
}

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** CPF só com números se for válido (dígitos verificadores), senão null */
export function cpfLimpo(valor: unknown): string | null {
  const d = String(valor ?? '').replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null
  const dv = (base: string, peso: number) => {
    const resto = ([...base].reduce((s, n, i) => s + Number(n) * (peso - i), 0) * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]) ? d : null
}
