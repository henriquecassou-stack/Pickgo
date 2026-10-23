import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, CreditCard, FileSpreadsheet, QrCode, Receipt } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { StatusVenda, Venda } from '../../lib/tipos'
import { rotuloCliente } from '../../lib/formato'
import { brl, dataHoraBR, hojeISO, numero, ROTULO_METODO, ROTULO_STATUS_VENDA } from '../../lib/formato'
import { exportarExcel, fmtExcel, type Coluna } from '../../lib/exportar'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Rotulo, Vazio } from '../../componentes/ui'
import { CampoData } from '../../componentes/CampoData'

const TOM_STATUS: Record<StatusVenda, 'verde' | 'amarelo' | 'vermelho' | 'neutro'> = {
  paga: 'verde', aguardando_pagamento: 'amarelo', recusada: 'vermelho', expirada: 'neutro', cancelada: 'neutro', estornada: 'vermelho',
}

const COLUNAS: Coluna<Venda>[] = [
  { titulo: 'Nº', valor: (v) => v.numero },
  { titulo: 'Data', valor: (v) => dataHoraBR(v.criado_em), largura: 18 },
  { titulo: 'Status', valor: (v) => ROTULO_STATUS_VENDA[v.status] },
  { titulo: 'Pagamento', valor: (v) => ROTULO_METODO[v.metodo] },
  { titulo: 'Cliente', valor: (v) => rotuloCliente(v), largura: 24 },
  { titulo: 'Apartamento', valor: (v) => v.apartamento },
  { titulo: 'Itens', valor: (v) => v.itens_venda.map((i) => `${i.quantidade}x ${i.nome_produto}`).join('; '), largura: 50 },
  { titulo: 'Total', valor: (v) => v.total, formatoExcel: fmtExcel.moeda },
  { titulo: 'Custo', valor: (v) => v.custo_total, formatoExcel: fmtExcel.moeda },
  { titulo: 'Lucro bruto', valor: (v) => v.total - v.custo_total, formatoExcel: fmtExcel.moeda },
]

export default function Vendas() {
  const api = useApi()
  const [inicio, setInicio] = useState(hojeISO(-7))
  const [fim, setFim] = useState(hojeISO())
  const [status, setStatus] = useState<StatusVenda | ''>('')
  const [aberta, setAberta] = useState<string | null>(null)
  const vendas = useCarregar(() => api.listarVendas({ inicio, fim, status: status || undefined, limite: 3000 }), [inicio, fim, status])

  const resumo = useMemo(() => {
    const pagas = (vendas.dados ?? []).filter((v) => v.status === 'paga')
    const total = pagas.reduce((s, v) => s + v.total, 0)
    return { n: pagas.length, total, lucro: pagas.reduce((s, v) => s + v.total - v.custo_total, 0) }
  }, [vendas.dados])

  return (
    <>
      <CabecalhoPagina
        titulo="Vendas"
        descricao={`${numero(resumo.n)} vendas pagas · ${brl(resumo.total)} faturados · ${brl(resumo.lucro)} de lucro bruto`}
        acoes={<Botao variante="secundario" icone={<FileSpreadsheet className="size-4" />} disabled={!vendas.dados?.length}
          onClick={() => exportarExcel(`vendas_${inicio}_${fim}`, [{ titulo: 'Vendas', colunas: COLUNAS, linhas: vendas.dados ?? [] }])}>Excel</Botao>}
      />
      <Cartao>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
          <Rotulo texto="De"><CampoData valor={inicio} max={fim} obrigatorio aoMudar={setInicio} className="w-40" /></Rotulo>
          <Rotulo texto="Até"><CampoData valor={fim} min={inicio} obrigatorio aoMudar={setFim} className="w-40" /></Rotulo>
          <Rotulo texto="Status">
            <select className="campo" value={status} onChange={(e) => setStatus(e.target.value as StatusVenda | '')}>
              <option value="">Todos</option>
              {Object.entries(ROTULO_STATUS_VENDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Rotulo>
        </div>
        {vendas.carregando && !vendas.dados ? <Carregando /> : !vendas.dados?.length ? (
          <Vazio icone={<Receipt className="size-6" />} titulo="Nenhuma venda no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[760px]">
              <thead>
                <tr><th>Nº</th><th>Data</th><th>Itens</th><th>Cliente</th><th>Apto</th><th>Pagamento</th><th>Status</th><th className="num">Total</th><th className="num">Lucro</th><th /></tr>
              </thead>
              <tbody>
                {vendas.dados.map((v) => (
                  <Fragment key={v.id}>
                    <tr className="cursor-pointer" onClick={() => setAberta(aberta === v.id ? null : v.id)}>
                      <td className="font-mono text-slate-500">#{v.numero}</td>
                      <td className="whitespace-nowrap tabular-nums text-slate-600">{dataHoraBR(v.pago_em ?? v.criado_em)}</td>
                      <td className="text-slate-600">{v.itens_venda.reduce((s, i) => s + i.quantidade, 0)} item(ns)</td>
                      <td className={v.tipo_cliente === 'morador_cadastrado' ? 'text-slate-800' : 'text-slate-500'}>{rotuloCliente(v)}</td>
                      <td className="text-slate-600">{v.apartamento ?? '—'}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                          {v.metodo === 'pix' ? <QrCode className="size-4 text-teal-600" /> : <CreditCard className="size-4 text-indigo-500" />}
                          {ROTULO_METODO[v.metodo]}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Etiqueta tom={TOM_STATUS[v.status]}>{ROTULO_STATUS_VENDA[v.status]}</Etiqueta>
                          {v.offline && <Etiqueta tom={v.conferencia === 'pendente' ? 'amarelo' : 'neutro'}>{v.conferencia === 'pendente' ? 'Sem internet · a conferir' : 'Sem internet'}</Etiqueta>}
                        </div>
                      </td>
                      <td className="num font-medium">{brl(v.total)}</td>
                      <td className="num text-slate-600">{v.status === 'paga' ? brl(v.total - v.custo_total) : '—'}</td>
                      <td><ChevronDown className={cx('size-4 text-slate-400 transition', aberta === v.id && 'rotate-180')} /></td>
                    </tr>
                    {aberta === v.id && (
                      <tr>
                        <td colSpan={10} className="bg-slate-50/60">
                          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                            {v.itens_venda.map((i) => (
                              <li key={i.produto_id} className="flex justify-between gap-4 px-3 py-2">
                                <span>{i.quantidade}× {i.nome_produto} <span className="text-slate-400">({brl(i.preco_unitario)} un.)</span></span>
                                <span className="tabular-nums">{brl(i.subtotal)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  )
}
