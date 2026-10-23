// Webhook do Mercado Pago. Única porta de entrada que aprova uma venda.
// Nunca confia no corpo da notificação: consulta o pagamento na API do MP
// e só então chama finalizar_pagamento() (idempotente) ou encerrar_pagamento().
// Publicar com:  supabase functions deploy webhook-pagamento --no-verify-jwt
import { clienteServico, json } from '../_shared/comum.ts'
import { assinaturaValida, buscarIntencaoPoint, buscarPagamento, type PagamentoMP } from '../_shared/mercadopago.ts'

const MOTIVOS: Record<string, string> = {
  cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente',
  cc_rejected_bad_filled_card_number: 'Número do cartão incorreto',
  cc_rejected_bad_filled_date: 'Data de validade incorreta',
  cc_rejected_bad_filled_security_code: 'Código de segurança incorreto',
  cc_rejected_bad_filled_other: 'Dados do cartão incorretos',
  cc_rejected_call_for_authorize: 'Pagamento não autorizado pelo banco',
  cc_rejected_card_disabled: 'Cartão bloqueado ou inativo',
  cc_rejected_high_risk: 'Pagamento recusado por segurança',
  cc_rejected_max_attempts: 'Limite de tentativas atingido',
  expired: 'QR Code expirado',
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true })

  // Produção sem chave secreta: não há como autenticar a notificação. Falha fechado
  // (o Mercado Pago reenvia depois); configure MP_WEBHOOK_SECRET junto com o token.
  if (Deno.env.get('MP_ACCESS_TOKEN') && !Deno.env.get('MP_WEBHOOK_SECRET')) {
    console.error('MP_WEBHOOK_SECRET não configurado: notificação recusada')
    return json({ erro: 'webhook sem chave secreta configurada' }, 503)
  }

  const url = new URL(req.url)
  const corpo = await req.json().catch(() => ({}))
  const db = clienteServico()

  // Notificação da maquininha Point (intenção cancelada/abandonada no terminal).
  // Autentica pela assinatura e confirma o estado consultando a intenção no provedor.
  if (corpo?.additional_info?.external_reference && corpo?.state && !corpo?.payment?.id) {
    const intentId = String(url.searchParams.get('data.id') ?? corpo?.id ?? '')
    if (!intentId || !(await assinaturaValida(req, intentId))) {
      console.warn('Assinatura inválida (Point)', intentId)
      return json({ erro: 'assinatura inválida' }, 401)
    }
    let intencao
    try {
      intencao = await buscarIntencaoPoint(intentId)
    } catch (e) {
      console.error(e)
      return json({ erro: 'falha ao consultar intenção' }, 500) // MP tentará novamente
    }
    const ref = intencao.additional_info?.external_reference
    if (ref && ['CANCELED', 'ERROR', 'ABANDONED'].includes(intencao.state)) {
      const { error } = await db.rpc('encerrar_pagamento', {
        p_pagamento_id: ref,
        p_status: intencao.state === 'ERROR' ? 'recusado' : 'cancelado',
        p_motivo: intencao.state === 'ERROR' ? 'Erro na maquininha' : 'Operação cancelada na maquininha',
        p_resposta: { id: intencao.id, state: intencao.state },
      })
      if (error) {
        console.error(error)
        return json({ erro: error.message }, 500)
      }
    }
    return json({ ok: true })
  }

  const tipo = corpo?.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
  const dataId = String(corpo?.data?.id ?? corpo?.payment?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '')
  if (!dataId || (tipo && !['payment', 'point_integration_wh'].includes(tipo))) return json({ ignorado: true })

  if (!(await assinaturaValida(req, url.searchParams.get('data.id') ?? dataId))) {
    console.warn('Assinatura inválida para', dataId)
    return json({ erro: 'assinatura inválida' }, 401)
  }

  let pagamentoMP: PagamentoMP
  try {
    pagamentoMP = await buscarPagamento(dataId)
  } catch (e) {
    console.error(e)
    return json({ erro: 'falha ao consultar pagamento' }, 500) // MP tentará novamente
  }

  const pagamentoId = pagamentoMP.external_reference
  if (!pagamentoId) return json({ ignorado: 'sem external_reference' })

  const { data: pagamento } = await db.from('pagamentos').select('id, valor, status').eq('id', pagamentoId).maybeSingle()
  if (!pagamento) return json({ ignorado: 'pagamento desconhecido' })

  if (Math.abs(Number(pagamento.valor) - Number(pagamentoMP.transaction_amount)) > 0.009) {
    console.error('Valor divergente', pagamentoId, pagamento.valor, pagamentoMP.transaction_amount)
    return json({ erro: 'valor divergente' }, 422)
  }

  const resumo = { id: pagamentoMP.id, status: pagamentoMP.status, status_detail: pagamentoMP.status_detail }
  let resultado
  if (pagamentoMP.status === 'approved') {
    resultado = await db.rpc('finalizar_pagamento', { p_pagamento_id: pagamentoId, p_id_externo: String(pagamentoMP.id), p_resposta: resumo })
  } else if (pagamentoMP.status === 'refunded' || pagamentoMP.status === 'charged_back') {
    // estorno ou contestação: tira a venda do faturamento e avisa o administrador
    resultado = await db.rpc('registrar_estorno', {
      p_pagamento_id: pagamentoId,
      p_status: pagamentoMP.status === 'refunded' ? 'estornado' : 'contestado',
      p_resposta: resumo,
    })
  } else if (pagamentoMP.status === 'rejected' || pagamentoMP.status === 'cancelled') {
    const expirado = pagamentoMP.status_detail === 'expired'
    resultado = await db.rpc('encerrar_pagamento', {
      p_pagamento_id: pagamentoId,
      p_status: expirado ? 'expirado' : pagamentoMP.status === 'rejected' ? 'recusado' : 'cancelado',
      p_motivo: MOTIVOS[pagamentoMP.status_detail] ?? (pagamentoMP.status === 'rejected' ? 'Pagamento recusado' : 'Pagamento cancelado'),
      p_resposta: resumo,
    })
  }
  if (resultado?.error) {
    console.error(resultado.error)
    return json({ erro: resultado.error.message }, 500)
  }
  return json({ ok: true, status: pagamentoMP.status })
})
