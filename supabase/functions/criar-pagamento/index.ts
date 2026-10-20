// Cria a venda (aguardando pagamento) a partir do carrinho do totem e gera a
// cobrança no provedor. Preços e custos vêm SEMPRE do banco, nunca do navegador.
// O estoque NÃO é baixado aqui: só quando o webhook confirmar o pagamento.
import { clienteServico, cors, cpfLimpo, erro, json, provedorAtivo, usuarioDaRequisicao, brl } from '../_shared/comum.ts'
import { criarCheckout, criarIntencaoPoint, criarPix } from '../_shared/mercadopago.ts'

type Metodo = 'pix' | 'cartao_credito' | 'cartao_debito'
interface Entrada {
  itens: { produto_id: string; quantidade: number }[]
  metodo: Metodo
  apartamento?: string | null
  cliente?: 'visitante' | 'morador' | 'morador_cadastrado'
  morador_id?: string | null
  cpf?: string | null // obrigatório para visitante e morador sem cadastro
}

const EXPIRACAO_MS = 5 * 60_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return erro('Método não permitido', 405)

  const db = clienteServico()
  const usuario = await usuarioDaRequisicao(req, db)
  if (!usuario) return erro('Não autorizado', 401)

  let entrada: Entrada
  try {
    entrada = await req.json()
  } catch {
    return erro('JSON inválido')
  }
  if (!['pix', 'cartao_credito', 'cartao_debito'].includes(entrada.metodo)) return erro('Forma de pagamento inválida')
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0 || entrada.itens.length > 50) return erro('Carrinho vazio ou grande demais')

  // agrupa itens repetidos e valida quantidades
  const qtd = new Map<string, number>()
  for (const i of entrada.itens) {
    const q = Math.trunc(Number(i.quantidade))
    if (!i.produto_id || !(q >= 1 && q <= 50)) return erro('Quantidade inválida')
    qtd.set(i.produto_id, (qtd.get(i.produto_id) ?? 0) + q)
  }

  await db.rpc('expirar_pagamentos_vencidos')

  const { data: produtos, error: errProd } = await db
    .from('produtos')
    .select('id, nome, preco_venda, preco_custo, ativo')
    .in('id', [...qtd.keys()])
  if (errProd) return erro(errProd.message, 500)
  if (!produtos || produtos.length !== qtd.size || produtos.some((p) => !p.ativo)) {
    return erro('Algum produto do carrinho não está mais disponível', 409)
  }

  const itens = produtos.map((p) => ({
    produto_id: p.id,
    nome_produto: p.nome,
    quantidade: qtd.get(p.id)!,
    preco_unitario: Number(p.preco_venda),
    custo_unitario: Number(p.preco_custo),
  }))
  const centavos = (v: number) => Math.round(v * 100)
  const total = itens.reduce((s, i) => s + centavos(i.preco_unitario) * i.quantidade, 0) / 100
  const custo = itens.reduce((s, i) => s + centavos(i.custo_unitario) * i.quantidade, 0) / 100
  // tipo de cliente: visitante não tem apartamento; morador cadastrado usa o do cadastro
  const cliente = entrada.cliente ?? 'morador'
  if (!['visitante', 'morador', 'morador_cadastrado'].includes(cliente)) return erro('Tipo de cliente inválido')
  let apartamento = cliente === 'visitante' ? null : entrada.apartamento?.toString().trim().slice(0, 20) || null
  let moradorId: string | null = null
  const cpf = cpfLimpo(entrada.cpf)
  if (cliente !== 'morador_cadastrado' && !cpf) return erro('Informe um CPF válido para continuar a compra')
  if (cliente === 'morador_cadastrado') {
    const { data: morador } = await db.from('moradores').select('id, apartamento, bloco, ativo').eq('id', entrada.morador_id ?? '').maybeSingle()
    if (!morador?.ativo) return erro('Cadastro do morador não encontrado', 409)
    moradorId = morador.id
    apartamento = morador.bloco ? `${morador.apartamento} ${morador.bloco}` : morador.apartamento
  }

  const { data: venda, error: errVenda } = await db
    .from('vendas')
    .insert({ metodo: entrada.metodo, apartamento, tipo_cliente: cliente, morador_id: moradorId, cpf_cliente: cliente === 'morador_cadastrado' ? null : cpf, total, custo_total: custo, totem_id: usuario.id })
    .select('id, numero, total')
    .single()
  if (errVenda) return erro(errVenda.message, 500)

  const { error: errItens } = await db.from('itens_venda').insert(itens.map((i) => ({ ...i, venda_id: venda.id })))
  if (errItens) return erro(errItens.message, 500)

  const provedor = provedorAtivo()
  const expiraEm = new Date(Date.now() + EXPIRACAO_MS)
  const { data: pagamento, error: errPag } = await db
    .from('pagamentos')
    .insert({ venda_id: venda.id, totem_id: usuario.id, provedor, metodo: entrada.metodo, valor: total, expira_em: expiraEm.toISOString() })
    .select('id')
    .single()
  if (errPag) return erro(errPag.message, 500)

  const descricao = `pickgo — compra #${venda.numero}`
  let atualizacao: Record<string, unknown> = {}
  let modo: 'pix' | 'maquininha' | 'checkout' = entrada.metodo === 'pix' ? 'pix' : 'maquininha'

  try {
    if (provedor === 'simulado') {
      // Sandbox local: QR fictício; o totem mostra botões para simular aprovação/recusa.
      atualizacao = entrada.metodo === 'pix'
        ? { qr_code: `SANDBOX-PIX|${pagamento.id}|${brl(total)}`, id_externo: `SIM-${pagamento.id.slice(0, 8)}` }
        : { id_externo: `SIM-${pagamento.id.slice(0, 8)}` }
    } else if (entrada.metodo === 'pix') {
      const pix = await criarPix({ pagamentoId: pagamento.id, valor: total, descricao, expiraEm })
      atualizacao = {
        id_externo: String(pix.id),
        qr_code: pix.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: pix.point_of_interaction?.transaction_data?.qr_code_base64,
        resposta_provedor: { id: pix.id, status: pix.status },
      }
    } else {
      const tipo = entrada.metodo === 'cartao_credito' ? 'credit_card' : 'debit_card'
      if (Deno.env.get('MP_POINT_DEVICE_ID')) {
        const intent = await criarIntencaoPoint({ pagamentoId: pagamento.id, valor: total, descricao, tipo })
        atualizacao = { id_externo: intent.id, resposta_provedor: intent }
      } else {
        modo = 'checkout'
        const checkout = await criarCheckout({ pagamentoId: pagamento.id, valor: total, descricao, tipo, expiraEm })
        atualizacao = { id_externo: checkout.id, checkout_url: checkout.url }
      }
    }
  } catch (e) {
    await db.rpc('encerrar_pagamento', { p_pagamento_id: pagamento.id, p_status: 'cancelado', p_motivo: String(e) })
    return erro('Não foi possível iniciar o pagamento. Tente novamente.', 502)
  }

  const { data: final, error: errUpd } = await db
    .from('pagamentos')
    .update({ ...atualizacao, atualizado_em: new Date().toISOString() })
    .eq('id', pagamento.id)
    .select('id, status, provedor, metodo, valor, qr_code, qr_code_base64, checkout_url, expira_em')
    .single()
  if (errUpd) return erro(errUpd.message, 500)

  return json({ venda, pagamento: { ...final, modo } })
})
