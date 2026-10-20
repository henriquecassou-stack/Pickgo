import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet, History } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { FiltroMovimentacoes, TipoMovimentacao } from '../../lib/tipos'
import { brl, dataBR, hojeISO, numero, ROTULO_MOTIVO } from '../../lib/formato'
import { exportarExcel } from '../../lib/exportar'
import { Botao, CabecalhoPagina, Carregando, Cartao, Rotulo, useAviso, Vazio } from '../../componentes/ui'
import { COLUNAS_EXPORT_MOV, TabelaMovimentacoes } from '../../componentes/TabelaMovimentacoes'
import { FormMovimentacao } from '../../componentes/FormMovimentacao'
import { CampoData } from '../../componentes/CampoData'

export default function Movimentacoes() {
  const api = useApi()
  const avisar = useAviso()
  const [filtro, setFiltro] = useState<FiltroMovimentacoes>({ inicio: hojeISO(-30), fim: hojeISO() })
  const [form, setForm] = useState<TipoMovimentacao | null>(null)
  const movs = useCarregar(() => api.listarMovimentacoes({ ...filtro, limite: 2000 }), [JSON.stringify(filtro)])
  const aux = useCarregar(() => Promise.all([api.listarProdutos(), api.listarCategorias(), api.listarFornecedores()]), [])
  const [produtos, categorias, fornecedores] = aux.dados ?? [[], [], []]

  const resumo = useMemo(() => {
    const l = movs.dados ?? []
    const ent = l.filter((m) => m.tipo === 'entrada')
    const sai = l.filter((m) => m.tipo === 'saida')
    return {
      entradas: ent.reduce((s, m) => s + m.quantidade, 0),
      valorEntradas: ent.reduce((s, m) => s + m.quantidade * (m.custo_unitario ?? 0), 0),
      vendas: sai.filter((m) => m.motivo === 'venda').reduce((s, m) => s + m.quantidade, 0),
      perdas: sai.filter((m) => m.motivo !== 'venda').reduce((s, m) => s + m.quantidade, 0),
      valorPerdas: sai.filter((m) => m.motivo !== 'venda').reduce((s, m) => s + m.quantidade * (m.custo_unitario ?? 0), 0),
    }
  }, [movs.dados])

  const set = (k: keyof FiltroMovimentacoes) => (e: { target: { value: string } }) =>
    setFiltro((f) => ({ ...f, [k]: e.target.value ? (k === 'categoria_id' ? Number(e.target.value) : e.target.value) : undefined }))

  async function exportar() {
    try {
      await exportarExcel(`movimentacoes_${filtro.inicio ?? ''}_${filtro.fim ?? ''}`, [{ titulo: 'Movimentações', colunas: COLUNAS_EXPORT_MOV, linhas: movs.dados ?? [] }])
    } catch (e) {
      avisar('erro', `Falha ao exportar: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Movimentações de estoque"
        descricao="Toda alteração de estoque fica registrada aqui. Saídas por venda são geradas automaticamente."
        acoes={<>
          <Botao variante="secundario" icone={<FileSpreadsheet className="size-4" />} onClick={exportar} disabled={!movs.dados?.length}>Excel</Botao>
          <Botao variante="secundario" icone={<ArrowUpFromLine className="size-4" />} onClick={() => setForm('saida')}>Saída manual</Botao>
          <Botao icone={<ArrowDownToLine className="size-4" />} onClick={() => setForm('entrada')}>Entrada</Botao>
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini rotulo="Unidades que entraram" valor={numero(resumo.entradas)} detalhe={`${brl(resumo.valorEntradas)} em compras`} cor="text-emerald-700" />
        <Mini rotulo="Unidades vendidas" valor={numero(resumo.vendas)} cor="text-sky-700" />
        <Mini rotulo="Perdas e saídas manuais" valor={numero(resumo.perdas)} detalhe={`${brl(resumo.valorPerdas)} a custo`} cor="text-rose-600" />
        <Mini rotulo="Registros no período" valor={numero(movs.dados?.length ?? 0)} detalhe={`${dataBR(filtro.inicio)} a ${dataBR(filtro.fim)}`} cor="text-slate-800" />
      </div>

      <Cartao>
        <div className="grid gap-3 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Rotulo texto="De"><CampoData valor={filtro.inicio ?? ''} max={filtro.fim} aoMudar={(v) => setFiltro((f) => ({ ...f, inicio: v || undefined }))} /></Rotulo>
          <Rotulo texto="Até"><CampoData valor={filtro.fim ?? ''} min={filtro.inicio} aoMudar={(v) => setFiltro((f) => ({ ...f, fim: v || undefined }))} /></Rotulo>
          <Rotulo texto="Produto">
            <select className="campo" value={filtro.produto_id ?? ''} onChange={set('produto_id')}>
              <option value="">Todos</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </Rotulo>
          <Rotulo texto="Categoria">
            <select className="campo" value={filtro.categoria_id ?? ''} onChange={set('categoria_id')}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Rotulo>
          <Rotulo texto="Tipo">
            <select className="campo" value={filtro.motivo ?? ''} onChange={set('motivo')}>
              <option value="">Todos</option>
              <option value="entrada">Todas as entradas</option>
              <option value="saida">Todas as saídas</option>
              {Object.entries(ROTULO_MOTIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Rotulo>
        </div>
        {movs.carregando && !movs.dados ? <Carregando /> : movs.erro ? <p className="p-6 text-sm text-rose-600">{movs.erro}</p>
          : !movs.dados?.length ? <Vazio icone={<History className="size-6" />} titulo="Nenhuma movimentação no filtro" />
          : <TabelaMovimentacoes linhas={movs.dados} />}
      </Cartao>

      <FormMovimentacao aberto={!!form} tipoInicial={form ?? 'entrada'} produtos={produtos} fornecedores={fornecedores}
        aoFechar={() => setForm(null)} aoSalvar={() => { setForm(null); movs.recarregar(); aux.recarregar() }} />
    </>
  )
}

function Mini({ rotulo, valor, detalhe, cor }: { rotulo: string; valor: string; detalhe?: string; cor: string }) {
  return (
    <Cartao className="p-4">
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>}
    </Cartao>
  )
}
