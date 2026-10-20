// Envia o comprovante da compra por e-mail (Resend).
// O e-mail digitado no totem é usado só para este envio e não é guardado;
// sem e-mail digitado, usa o do cadastro do morador.
import { brl, clienteServico, cors, erro, json, usuarioDaRequisicao } from '../_shared/comum.ts'
import { enviarEmail } from '../_shared/mensageria.ts'

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

const METODOS: Record<string, string> = { pix: 'PIX', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito' }

interface Item { quantidade: number; nome_produto: string; subtotal: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = clienteServico()
  const usuario = await usuarioDaRequisicao(req, db)
  if (!usuario) return erro('Não autorizado', 401)

  const { venda_id, destino: destinoDigitado } = await req.json().catch(() => ({}))
  const { data: venda } = await db
    .from('vendas')
    .select('id, numero, status, metodo, total, apartamento, pago_em, totem_id, morador_id, moradores(email), itens_venda(nome_produto, quantidade, preco_unitario, subtotal)')
    .eq('id', venda_id)
    .maybeSingle()
  if (!venda || venda.status !== 'paga') return erro('Venda não encontrada ou não paga', 404)
  if (usuario.perfil !== 'admin' && venda.totem_id !== usuario.id) return erro('Sem permissão', 403)
  if (usuario.perfil !== 'admin' && Date.now() - new Date(venda.pago_em!).getTime() > 30 * 60_000) {
    return erro('Comprovante disponível por 30 minutos após a compra', 410)
  }

  const cadastro = (venda as unknown as { moradores: { email: string | null } | null }).moradores
  const destino: string | undefined = destinoDigitado || cadastro?.email || undefined
  if (!destino) return erro('Informe o e-mail para o comprovante')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) return erro('E-mail inválido')
  if (!Deno.env.get('RESEND_API_KEY')) return erro('Envio por e-mail não configurado', 501)

  const itens = venda.itens_venda as Item[]
  const texto = [
    `pickgo — compra #${venda.numero}`,
    fmtData(venda.pago_em!),
    venda.apartamento ? `Apartamento: ${venda.apartamento}` : null,
    '',
    ...itens.map((i) => `${i.quantidade}x ${i.nome_produto} — ${brl(Number(i.subtotal))}`),
    '',
    `Total: ${brl(Number(venda.total))}`,
    `Pagamento: ${METODOS[venda.metodo]}`,
  ].filter((l) => l !== null).join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px">
    <h2 style="margin:0 0 4px">pickgo</h2><p style="color:#64748b;margin:0 0 16px">Compra #${venda.numero} · ${fmtData(venda.pago_em!)}</p>
    <table style="width:100%;border-collapse:collapse">${itens.map((i) =>
      `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0">${i.quantidade}x ${i.nome_produto}</td><td style="text-align:right;border-bottom:1px solid #e2e8f0">${brl(Number(i.subtotal))}</td></tr>`).join('')}
    </table><p style="font-size:20px;font-weight:700;text-align:right">Total ${brl(Number(venda.total))}</p>
    <p style="color:#64748b">Pago com ${METODOS[venda.metodo]}${venda.apartamento ? ` · Apto ${venda.apartamento}` : ''}</p></div>`

  try {
    await enviarEmail(destino, `Comprovante — compra #${venda.numero}`, html, texto)
  } catch (e) {
    console.error(e)
    return erro('Falha ao enviar e-mail', 502)
  }
  return json({ ok: true })
})
