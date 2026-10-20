// Cancela (morador desistiu) ou expira (5 min sem pagar) um pagamento pendente.
// Antes de cancelar no provedor, confere se ele não foi pago no último segundo.
import { clienteServico, cors, erro, json, usuarioDaRequisicao } from '../_shared/comum.ts'
import { buscarPagamento, cancelarIntencaoPoint, cancelarPagamento } from '../_shared/mercadopago.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = clienteServico()
  const usuario = await usuarioDaRequisicao(req, db)
  if (!usuario) return erro('Não autorizado', 401)

  const { pagamento_id, motivo } = await req.json().catch(() => ({}))
  const { data: pag } = await db.from('pagamentos').select('*').eq('id', pagamento_id).maybeSingle()
  if (!pag) return erro('Pagamento não encontrado', 404)
  if (usuario.perfil !== 'admin' && pag.totem_id !== usuario.id) return erro('Sem permissão', 403)
  if (pag.status !== 'pendente') return json({ status: pag.status })

  const expirado = motivo === 'expirado'

  if (pag.provedor === 'mercadopago' && pag.id_externo) {
    try {
      if (pag.metodo === 'pix') {
        const atual = await buscarPagamento(pag.id_externo)
        if (atual.status === 'approved') {
          await db.rpc('finalizar_pagamento', { p_pagamento_id: pag.id, p_id_externo: String(atual.id) })
          return json({ status: 'aprovado' })
        }
        await cancelarPagamento(pag.id_externo)
      } else if (!pag.checkout_url && Deno.env.get('MP_POINT_DEVICE_ID')) {
        await cancelarIntencaoPoint(pag.id_externo)
      }
    } catch (e) {
      // Se não deu para cancelar no provedor (ex.: já processado), o webhook resolve.
      console.warn('Cancelamento no provedor falhou', e)
    }
  }

  await db.rpc('encerrar_pagamento', {
    p_pagamento_id: pag.id,
    p_status: expirado ? 'expirado' : 'cancelado',
    p_motivo: expirado ? 'QR Code expirado' : 'Cancelado pelo morador',
  })
  return json({ status: expirado ? 'expirado' : 'cancelado' })
})
