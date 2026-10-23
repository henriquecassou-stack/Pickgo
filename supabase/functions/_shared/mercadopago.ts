// Integração com o Mercado Pago (PIX, maquininha Point e Checkout Pro).
// O access token fica só em variável de ambiente das Edge Functions.
// Em sandbox use o token de TESTE (começa com "TEST-") das credenciais de teste.

const API = 'https://api.mercadopago.com'

function token() {
  const t = Deno.env.get('MP_ACCESS_TOKEN')
  if (!t) throw new Error('MP_ACCESS_TOKEN não configurado')
  return t
}

async function mp<T>(path: string, init: RequestInit & { idempotencia?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json',
  }
  if (init.idempotencia) headers['X-Idempotency-Key'] = init.idempotencia
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const texto = await res.text()
  const corpo = texto ? JSON.parse(texto) : {}
  if (!res.ok) {
    console.error('Mercado Pago', res.status, path, texto)
    throw new Error(corpo?.message ?? `Mercado Pago respondeu ${res.status}`)
  }
  return corpo as T
}

/** Data no formato aceito pelo MP: yyyy-MM-ddTHH:mm:ss.SSS-03:00 */
function dataMP(d: Date) {
  const local = new Date(d.getTime() - 3 * 3600_000)
  return local.toISOString().replace('Z', '-03:00')
}

export function urlWebhook() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-pagamento`
}

export interface PagamentoMP {
  id: number
  status: 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back'
  status_detail: string
  transaction_amount: number
  external_reference: string | null
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }
}

export function criarPix(p: { pagamentoId: string; valor: number; descricao: string; expiraEm: Date }) {
  return mp<PagamentoMP>('/v1/payments', {
    method: 'POST',
    idempotencia: p.pagamentoId,
    body: JSON.stringify({
      transaction_amount: p.valor,
      description: p.descricao,
      payment_method_id: 'pix',
      external_reference: p.pagamentoId,
      notification_url: urlWebhook(),
      date_of_expiration: dataMP(p.expiraEm),
      payer: { email: Deno.env.get('MP_PAYER_EMAIL') ?? 'morador@mercado-autonomo.app' },
    }),
  })
}

/** Cobrança na maquininha Point vinculada ao totem (modo PDV). */
export function criarIntencaoPoint(p: { pagamentoId: string; valor: number; descricao: string; tipo: 'credit_card' | 'debit_card' }) {
  const device = Deno.env.get('MP_POINT_DEVICE_ID')!
  return mp<{ id: string }>(`/point/integration-api/devices/${device}/payment-intents`, {
    method: 'POST',
    idempotencia: p.pagamentoId,
    body: JSON.stringify({
      amount: Math.round(p.valor * 100), // em centavos
      description: p.descricao,
      payment: { type: p.tipo, installments: 1, installments_cost: 'seller' },
      additional_info: { external_reference: p.pagamentoId, print_on_terminal: false },
    }),
  })
}

export function cancelarIntencaoPoint(intentId: string) {
  const device = Deno.env.get('MP_POINT_DEVICE_ID')!
  return mp(`/point/integration-api/devices/${device}/payment-intents/${intentId}`, { method: 'DELETE' })
}

export interface IntencaoPoint { id: string; state: string; additional_info?: { external_reference?: string } }

/** Estado real de uma intenção da maquininha (o webhook não confia no corpo da notificação). */
export function buscarIntencaoPoint(intentId: string) {
  return mp<IntencaoPoint>(`/point/integration-api/payment-intents/${encodeURIComponent(intentId)}`)
}

/** Sem maquininha: checkout do Mercado Pago aberto pelo celular do morador via QR. */
export async function criarCheckout(p: { pagamentoId: string; valor: number; descricao: string; tipo: 'credit_card' | 'debit_card'; expiraEm: Date }) {
  const pref = await mp<{ id: string; init_point: string; sandbox_init_point: string }>('/checkout/preferences', {
    method: 'POST',
    idempotencia: p.pagamentoId,
    body: JSON.stringify({
      items: [{ id: p.pagamentoId, title: p.descricao, quantity: 1, unit_price: p.valor, currency_id: 'BRL' }],
      external_reference: p.pagamentoId,
      notification_url: urlWebhook(),
      expires: true,
      expiration_date_to: dataMP(p.expiraEm),
      payment_methods: {
        installments: 1,
        excluded_payment_types: [
          { id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' },
          { id: p.tipo === 'credit_card' ? 'debit_card' : 'credit_card' },
        ],
      },
    }),
  })
  const sandbox = token().startsWith('TEST-')
  return { id: pref.id, url: sandbox ? pref.sandbox_init_point : pref.init_point }
}

export function buscarPagamento(id: string | number) {
  return mp<PagamentoMP>(`/v1/payments/${id}`)
}

export function cancelarPagamento(id: string | number) {
  return mp(`/v1/payments/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) })
}

/**
 * Valida a assinatura x-signature do webhook (painel MP → Webhooks → chave secreta).
 * manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 */
export async function assinaturaValida(req: Request, dataId: string) {
  const segredo = Deno.env.get('MP_WEBHOOK_SECRET')
  if (!segredo) return true // sem segredo configurado (ambiente de teste local)
  const assinatura = req.headers.get('x-signature') ?? ''
  const requestId = req.headers.get('x-request-id') ?? ''
  const partes = Object.fromEntries(assinatura.split(',').map((p) => p.trim().split('=') as [string, string]))
  if (!partes.ts || !partes.v1) return false
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId
  const manifesto = `id:${id};request-id:${requestId};ts:${partes.ts};`
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(manifesto))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // comparação em tempo constante
  if (hex.length !== partes.v1.length) return false
  let dif = 0
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i)
  return dif === 0
}
