import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CircleCheck, CircleX, Printer, QrCode, WifiOff } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { ConfigPix, TipoChavePix, Venda } from '../../lib/tipos'
import { brl, dataHoraBR, hojeISO } from '../../lib/formato'
import { chavePixValida, gerarPixEstatico, normalizarChave } from '../../lib/pix'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Rotulo, useAviso, Vazio } from '../../componentes/ui'

const TIPOS: { id: TipoChavePix; rotulo: string; exemplo: string }[] = [
  { id: 'cnpj', rotulo: 'CNPJ', exemplo: '12.345.678/0001-90' },
  { id: 'cpf', rotulo: 'CPF', exemplo: '123.456.789-09' },
  { id: 'email', rotulo: 'E-mail', exemplo: 'pix@condominio.com.br' },
  { id: 'celular', rotulo: 'Celular', exemplo: '(11) 91234-5678' },
  { id: 'aleatoria', rotulo: 'Chave aleatória', exemplo: '123e4567-e89b-12d3-a456-426614174000' },
]

export default function PixOffline() {
  const api = useApi()
  const avisar = useAviso()
  const cfg = useCarregar(() => api.obterConfigPix(), [])
  const vendas = useCarregar(() => api.listarVendas({ apenasOffline: true, inicio: hojeISO(-90), limite: 300 }), [])
  const [f, setF] = useState<ConfigPix | null>(null)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { if (cfg.dados) setF(cfg.dados) }, [cfg.dados])

  // entram como pagas; "não recebido" tira do faturamento
  const pendentes = (vendas.dados ?? []).filter((v) => v.conferencia === 'pendente')
  const conferidas = (vendas.dados ?? []).filter((v) => v.conferencia !== 'pendente')

  const configurado = !!(cfg.dados?.chave && cfg.dados.nome_recebedor && cfg.dados.cidade)
  const codigoCartaz = useMemo(() => (configurado
    ? gerarPixEstatico({ chave: cfg.dados!.chave!, nome: cfg.dados!.nome_recebedor!, cidade: cfg.dados!.cidade! })
    : ''), [configurado, cfg.dados])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!f?.tipo_chave || !f.chave) return avisar('erro', 'Informe o tipo e a chave PIX')
    if (!chavePixValida(f.chave, f.tipo_chave)) return avisar('erro', `Chave PIX inválida para o tipo ${TIPOS.find((t) => t.id === f.tipo_chave)?.rotulo}`)
    if (!f.nome_recebedor?.trim() || !f.cidade?.trim()) return avisar('erro', 'Informe o nome do recebedor e a cidade')
    setSalvando(true)
    try {
      await api.salvarConfigPix({ ...f, chave: normalizarChave(f.chave, f.tipo_chave), nome_recebedor: f.nome_recebedor.trim().slice(0, 25), cidade: f.cidade.trim().slice(0, 15) })
      avisar('sucesso', 'Chave PIX salva. O totem passa a usá-la na próxima vez que carregar com internet.')
      cfg.recarregar()
    } catch (err) {
      avisar('erro', (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function conferir(v: Venda, recebido: boolean) {
    if (!recebido && !confirm(`Marcar a compra #${v.numero} (${brl(v.total)}) como NÃO recebida? Ela sai do faturamento; o estoque continua baixado porque o produto saiu da loja.`)) return
    try {
      await api.conferirVendaOffline(v.id, recebido)
      avisar('sucesso', recebido ? `Compra #${v.numero} conferida` : `Compra #${v.numero} marcada como não recebida`)
      vendas.recarregar()
    } catch (err) {
      avisar('erro', (err as Error).message)
    }
  }

  function imprimirCartaz() {
    const svg = document.getElementById('qr-cartaz')?.outerHTML ?? ''
    const janela = window.open('', '_blank', 'width=800,height=1000')
    if (!janela) return avisar('erro', 'Permita pop-ups para imprimir o cartaz')
    janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartaz PIX</title>
      <style>
        @page { size: A4; margin: 18mm }
        body { font-family: system-ui, sans-serif; text-align: center; color: #0f172a; margin: 0 }
        h1 { font-size: 40px; margin: 10px 0 4px } h2 { font-size: 24px; font-weight: 500; color: #475569; margin: 0 0 24px }
        .qr { display: inline-block; padding: 18px; border: 6px solid #0d9488; border-radius: 28px }
        .qr svg { width: 92mm; height: 92mm }
        ol { text-align: left; display: inline-block; font-size: 22px; line-height: 1.6; margin: 24px 0 }
        .rec { font-size: 18px; color: #475569 } .aviso { margin-top: 18px; font-size: 16px; color: #64748b }
      </style></head><body>
      <h1>Totem sem internet?</h1><h2>Pague suas compras pelo PIX</h2>
      <div class="qr">${svg}</div>
      <p class="rec">Recebedor: <strong>${cfg.dados?.nome_recebedor ?? ''}</strong></p>
      <ol><li>Abra o app do seu banco e leia o QR Code</li><li>Digite o <strong>valor total</strong> dos produtos</li>
      <li>Na descrição, informe o <strong>apartamento</strong> (se for morador)</li></ol>
      <p class="aviso">Use este cartaz só quando o totem estiver desligado ou fora do ar.</p>
      <script>window.onload = () => { window.print() }</script></body></html>`)
    janela.document.close()
  }

  return (
    <>
      <CabecalhoPagina
        titulo="PIX sem internet"
        descricao="Se a internet do mercado cair, o totem continua vendendo: ele gera um PIX com a sua chave e o valor exato da compra. Essas vendas chegam aqui para você conferir no extrato."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Cartao className="p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><QrCode className="size-4 text-slate-400" /> Chave PIX do mercado</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">Use a chave da conta que recebe as vendas. Ela aparece para o cliente no QR Code.</p>
          {!f ? <Carregando /> : (
            <form onSubmit={salvar} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <Rotulo texto="Tipo de chave">
                  <select className="campo" value={f.tipo_chave ?? ''} onChange={(e) => setF({ ...f, tipo_chave: (e.target.value || null) as TipoChavePix | null })}>
                    <option value="">Selecione…</option>
                    {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                  </select>
                </Rotulo>
                <Rotulo texto="Chave PIX">
                  <input className="campo" value={f.chave ?? ''} onChange={(e) => setF({ ...f, chave: e.target.value })}
                    placeholder={TIPOS.find((t) => t.id === f.tipo_chave)?.exemplo ?? 'Escolha o tipo'} />
                </Rotulo>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Rotulo texto="Nome do recebedor" dica="Como aparece no banco (até 25 letras)">
                  <input className="campo" maxLength={25} value={f.nome_recebedor ?? ''} onChange={(e) => setF({ ...f, nome_recebedor: e.target.value })} placeholder="Condomínio Jardim" />
                </Rotulo>
                <Rotulo texto="Cidade"><input className="campo" maxLength={15} value={f.cidade ?? ''} onChange={(e) => setF({ ...f, cidade: e.target.value })} placeholder="São Paulo" /></Rotulo>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={f.offline_ativo} onChange={(e) => setF({ ...f, offline_ativo: e.target.checked })} />
                Permitir vendas no totem sem internet (PIX direto)
              </label>
              {api.modo === 'demo' && f.chave === 'pix@mercado-autonomo.exemplo' && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">A chave atual é só um exemplo. Troque pela chave real antes de usar.</p>
              )}
              <Botao type="submit" carregando={salvando}>Salvar</Botao>
            </form>
          )}
        </Cartao>

        <Cartao className="flex flex-col items-center p-5 text-center">
          <h2 className="flex items-center gap-2 self-start font-semibold text-slate-900"><Printer className="size-4 text-slate-400" /> Cartaz para emergência</h2>
          <p className="mt-1 self-start text-left text-sm text-slate-500">QR fixo (sem valor) para colar no mercado. Serve até se o totem desligar de vez, por exemplo, numa falta de energia.</p>
          {configurado ? (
            <>
              <div className="mt-4 rounded-2xl border-4 border-teal-100 p-3"><QRCodeSVG id="qr-cartaz" value={codigoCartaz} size={180} level="M" /></div>
              <p className="mt-2 text-sm text-slate-600">Recebedor: <strong>{cfg.dados?.nome_recebedor}</strong></p>
              <Botao className="mt-4" variante="secundario" icone={<Printer className="size-4" />} onClick={imprimirCartaz}>Imprimir cartaz</Botao>
            </>
          ) : <p className="my-10 text-sm text-slate-500">Salve a chave PIX para gerar o cartaz.</p>}
        </Cartao>
      </div>

      <Cartao className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><WifiOff className="size-4 text-slate-400" /> Vendas feitas sem internet</h2>
          <p className="text-sm text-slate-500">Confira no extrato pelo valor, horário e identificador.</p>
        </div>
        {vendas.carregando && !vendas.dados ? <Carregando /> : !vendas.dados?.length ? (
          <Vazio icone={<WifiOff className="size-6" />} titulo="Nenhuma venda sem internet nos últimos 90 dias" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[760px]">
              <thead><tr><th>Nº</th><th>Data</th><th>Itens</th><th className="num">Valor</th><th>Identificador (txid)</th><th>Situação</th><th className="text-right">Conferência</th></tr></thead>
              <tbody>
                {[...pendentes, ...conferidas].map((v) => (
                  <tr key={v.id} className={cx(v.conferencia === 'pendente' && 'bg-amber-50/40')}>
                    <td className="font-mono text-slate-500">#{v.numero}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dataHoraBR(v.pago_em ?? v.criado_em)}</td>
                    <td className="max-w-64 truncate text-slate-600" title={v.itens_venda.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(', ')}>
                      {v.itens_venda.map((i) => `${i.quantidade}x ${i.nome_produto}`).join(', ')}
                    </td>
                    <td className="num font-medium">{brl(v.total)}</td>
                    <td className="font-mono text-xs text-slate-600">{v.txid}</td>
                    <td>
                      {v.conferencia === 'pendente' ? <Etiqueta tom="amarelo">A conferir</Etiqueta>
                        : v.conferencia === 'recebido' ? <Etiqueta tom="verde">Recebido</Etiqueta>
                        : <Etiqueta tom="vermelho">Não recebido</Etiqueta>}
                    </td>
                    <td>
                      {v.conferencia === 'pendente' && (
                        <div className="flex justify-end gap-2">
                          <Botao tamanho="sm" variante="secundario" className="whitespace-nowrap" icone={<CircleX className="size-4 text-rose-600" />} onClick={() => conferir(v, false)}>Não recebido</Botao>
                          <Botao tamanho="sm" className="whitespace-nowrap" icone={<CircleCheck className="size-4" />} onClick={() => conferir(v, true)}>Recebido</Botao>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  )
}
