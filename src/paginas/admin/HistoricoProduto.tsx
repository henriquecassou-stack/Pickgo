import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, FileSpreadsheet, History } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { MotivoMovimentacao, TipoMovimentacao } from '../../lib/tipos'
import { brl, hojeISO, pct, ROTULO_MOTIVO } from '../../lib/formato'
import { exportarExcel } from '../../lib/exportar'
import { Botao, Carregando, Cartao, Etiqueta, Rotulo, Vazio } from '../../componentes/ui'
import { FotoProduto } from '../../componentes/IconeCategoria'
import { SaldoEstoque, Validade } from '../../componentes/Alertas'
import { COLUNAS_EXPORT_MOV, TabelaMovimentacoes } from '../../componentes/TabelaMovimentacoes'
import { FormMovimentacao } from '../../componentes/FormMovimentacao'
import { CampoData } from '../../componentes/CampoData'

export default function HistoricoProduto() {
  const { id } = useParams()
  const api = useApi()
  const [inicio, setInicio] = useState(hojeISO(-60))
  const [fim, setFim] = useState(hojeISO())
  const [motivo, setMotivo] = useState<MotivoMovimentacao | TipoMovimentacao | ''>('')
  const [form, setForm] = useState<TipoMovimentacao | null>(null)

  const base = useCarregar(() => Promise.all([api.listarProdutos(), api.listarCategorias(), api.listarFornecedores()]), [id])
  const movs = useCarregar(() => api.listarMovimentacoes({ produto_id: id, inicio, fim, motivo: motivo || undefined, limite: 5000 }), [id, inicio, fim, motivo])

  if (base.carregando && !base.dados) return <Carregando />
  const [produtos, categorias, fornecedores] = base.dados ?? [[], [], []]
  const p = produtos.find((x) => x.id === id)
  if (!p) return <Vazio icone={<History className="size-6" />} titulo="Produto não encontrado" acao={<Link to="/admin/produtos" className="text-emerald-700 hover:underline">Voltar</Link>} />
  const c = categorias.find((x) => x.id === p.categoria_id)

  return (
    <>
      <Link to="/admin/produtos" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Produtos</Link>

      <Cartao className="mb-6 p-5">
        <div className="flex flex-wrap items-start gap-5">
          <FotoProduto url={p.foto_url} nome={p.nome} icone={c?.icone} cor={c?.cor} className="size-20" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{p.nome}</h1>
              {!p.ativo && <Etiqueta>Inativo</Etiqueta>}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{c?.nome ?? 'Sem categoria'} · <span className="font-mono">{p.codigo_barras ?? 'sem código'}</span></p>
            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-5">
              <div><dt className="text-xs text-slate-500">Estoque</dt><dd><SaldoEstoque p={p} /></dd></div>
              <div><dt className="text-xs text-slate-500">Custo</dt><dd className="tabular-nums">{brl(p.preco_custo)}</dd></div>
              <div><dt className="text-xs text-slate-500">Venda</dt><dd className="font-medium tabular-nums">{brl(p.preco_venda)}</dd></div>
              <div><dt className="text-xs text-slate-500">Margem</dt><dd className="tabular-nums">{pct((p.preco_venda - p.preco_custo) / p.preco_venda)}</dd></div>
              <div><dt className="text-xs text-slate-500">Validade</dt><dd><Validade p={p} /></dd></div>
            </dl>
          </div>
          <div className="flex gap-2">
            <Botao variante="secundario" icone={<ArrowUpFromLine className="size-4" />} onClick={() => setForm('saida')}>Saída</Botao>
            <Botao icone={<ArrowDownToLine className="size-4" />} onClick={() => setForm('entrada')}>Entrada</Botao>
          </div>
        </div>
      </Cartao>

      <Cartao>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
          <Rotulo texto="De"><CampoData valor={inicio} max={fim} obrigatorio aoMudar={setInicio} className="w-40" /></Rotulo>
          <Rotulo texto="Até"><CampoData valor={fim} min={inicio} obrigatorio aoMudar={setFim} className="w-40" /></Rotulo>
          <Rotulo texto="Tipo">
            <select className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)}>
              <option value="">Todos</option>
              <option value="entrada">Entradas</option>
              <option value="saida">Saídas</option>
              {Object.entries(ROTULO_MOTIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Rotulo>
          <div className="flex-1" />
          <Botao variante="secundario" icone={<FileSpreadsheet className="size-4" />} disabled={!movs.dados?.length}
            onClick={() => exportarExcel(`historico_${p.nome.replace(/\W+/g, '_')}`, [{ titulo: 'Histórico', colunas: COLUNAS_EXPORT_MOV, linhas: movs.dados ?? [] }])}>
            Excel
          </Botao>
        </div>
        {movs.carregando && !movs.dados ? <Carregando /> : !movs.dados?.length
          ? <Vazio icone={<History className="size-6" />} titulo="Sem movimentações no período" />
          : <TabelaMovimentacoes linhas={movs.dados} mostrarProduto={false} />}
      </Cartao>

      <FormMovimentacao aberto={!!form} tipoInicial={form ?? 'entrada'} produtoInicial={p.id} produtos={produtos} fornecedores={fornecedores}
        aoFechar={() => setForm(null)} aoSalvar={() => { setForm(null); movs.recarregar(); base.recarregar() }} />
    </>
  )
}
