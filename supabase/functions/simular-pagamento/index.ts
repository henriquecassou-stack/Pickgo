// Sandbox local: simula a confirmação que viria do webhook do provedor.
// Só funciona para pagamentos criados com provedor 'simulado' (sem MP_ACCESS_TOKEN)
// e passa pelas mesmas funções do banco que o webhook real usa.
import { clienteServico, cors, erro, json, usuarioDaRequisicao } from '../_shared/comum.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = clienteServico()
  const usuario = await usuarioDaRequisicao(req, db)
  if (!usuario) return erro('Não autorizado', 401)

  const { pagamento_id, resultado } = await req.json().catch(() => ({}))
  const { data: pag } = await db.from('pagamentos').select('id, provedor, totem_id, status').eq('id', pagamento_id).maybeSingle()
  if (!pag) return erro('Pagamento não encontrado', 404)
  if (pag.provedor !== 'simulado') return erro('Simulação disponível apenas no modo sandbox', 403)
  if (usuario.perfil !== 'admin' && pag.totem_id !== usuario.id) return erro('Sem permissão', 403)

  // pequeno atraso para o totem exibir o estado "aguardando"
  await new Promise((r) => setTimeout(r, 1200))

  const { error } = resultado === 'aprovado'
    ? await db.rpc('finalizar_pagamento', { p_pagamento_id: pag.id, p_resposta: { simulado: true } })
    : await db.rpc('encerrar_pagamento', { p_pagamento_id: pag.id, p_status: 'recusado', p_motivo: 'Recusado (simulação)' })
  if (error) return erro(error.message, 500)
  return json({ ok: true })
})
