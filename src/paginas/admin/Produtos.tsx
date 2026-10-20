import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, CalendarClock, Camera, History, Package, Pencil, Plus, Power, Search, TriangleAlert } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Produto, TipoMovimentacao } from '../../lib/tipos'
import { brl, pct } from '../../lib/formato'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, useAviso, Vazio } from '../../componentes/ui'
import { FotoProduto } from '../../componentes/IconeCategoria'
import { SaldoEstoque, Validade } from '../../componentes/Alertas'
import { FormProduto } from '../../componentes/FormProduto'
import { FormMovimentacao } from '../../componentes/FormMovimentacao'
import { LeitorCamera, useLeitorUSB } from '../../componentes/LeitorCodigo'

type FiltroAlerta = 'todos' | 'estoque' | 'validade'
type FiltroStatus = 'ativos' | 'inativos' | 'todos'

export default function Produtos() {
  const api = useApi()
  const avisar = useAviso()
  const produtos = useCarregar(() => api.listarProdutos(), [])
  const aux = useCarregar(() => Promise.all([api.listarCategorias(), api.listarFornecedores()]), [])
  const [categorias, fornecedores] = aux.dados ?? [[], []]

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [alerta, setAlerta] = useState<FiltroAlerta>('todos')
  const [status, setStatus] = useState<FiltroStatus>('ativos')
  const [camera, setCamera] = useState(false)
  const [edicao, setEdicao] = useState<{ produto: Produto | null; codigo?: string } | null>(null)
  const [mov, setMov] = useState<{ tipo: TipoMovimentacao; produto?: string } | null>(null)

  const lista = produtos.dados ?? []
  const contagem = useMemo(() => {
    const ativos = lista.filter((p) => p.ativo)
    return { estoque: ativos.filter((p) => p.estoque_baixo).length, validade: ativos.filter((p) => p.perto_validade).length }
  }, [lista])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista.filter((p) =>
      (status === 'todos' || (status === 'ativos') === p.ativo) &&
      (!categoria || String(p.categoria_id) === categoria) &&
      (alerta === 'todos' || (alerta === 'estoque' ? p.estoque_baixo : p.perto_validade)) &&
      (!t || p.nome.toLowerCase().includes(t) || (p.codigo_barras ?? '').includes(t)),
    )
  }, [lista, busca, categoria, alerta, status])

  const categoriaDe = (id: number | null) => categorias.find((c) => c.id === id)

  /** código lido (USB ou câmera): encontra o produto ou oferece cadastrar */
  const aoLerCodigo = useCallback((codigo: string) => {
    setCamera(false)
    const p = lista.find((x) => x.codigo_barras === codigo)
    if (p) {
      setBusca(codigo)
      setStatus('todos')
    } else if (confirm(`Nenhum produto com o código ${codigo}. Cadastrar agora?`)) {
      setEdicao({ produto: null, codigo })
    }
  }, [lista])
  useLeitorUSB(aoLerCodigo, !edicao && !mov)

  async function alternarAtivo(p: Produto) {
    try {
      await api.salvarProduto({ ...p, ativo: !p.ativo })
      avisar('sucesso', p.ativo ? `${p.nome} desativado (histórico preservado)` : `${p.nome} reativado`)
      produtos.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    }
  }

  const salvo = () => {
    setEdicao(null)
    setMov(null)
    produtos.recarregar()
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos"
        descricao={`${lista.filter((p) => p.ativo).length} produtos ativos`}
        acoes={<>
          <Botao variante="secundario" icone={<ArrowDownToLine className="size-4" />} onClick={() => setMov({ tipo: 'entrada' })}>Registrar entrada</Botao>
          <Botao icone={<Plus className="size-4" />} onClick={() => setEdicao({ produto: null })}>Novo produto</Botao>
        </>}
      />

      {/* resumo de alertas */}
      <div className="mb-4 flex flex-wrap gap-2">
        <BotaoAlerta ativo={alerta === 'estoque'} onClick={() => setAlerta(alerta === 'estoque' ? 'todos' : 'estoque')}
          tom="amarelo" icone={<TriangleAlert className="size-4" />} texto={`${contagem.estoque} com estoque baixo`} />
        <BotaoAlerta ativo={alerta === 'validade'} onClick={() => setAlerta(alerta === 'validade' ? 'todos' : 'validade')}
          tom="vermelho" icone={<CalendarClock className="size-4" />} texto={`${contagem.validade} vencendo em até 7 dias`} />
      </div>

      <Cartao>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="campo pl-9" placeholder="Buscar por nome ou código de barras (ou bipe o leitor)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Botao variante="secundario" onClick={() => setCamera(true)} icone={<Camera className="size-4" />}>Câmera</Botao>
          <select className="campo w-auto" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select className="campo w-auto" value={status} onChange={(e) => setStatus(e.target.value as FiltroStatus)} aria-label="Situação">
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        {produtos.carregando && !produtos.dados ? <Carregando /> : produtos.erro ? (
          <p className="p-6 text-sm text-rose-600">{produtos.erro}</p>
        ) : filtrados.length === 0 ? (
          <Vazio icone={<Package className="size-6" />} titulo="Nenhum produto encontrado" texto="Ajuste os filtros ou cadastre um novo produto."
            acao={<Botao icone={<Plus className="size-4" />} onClick={() => setEdicao({ produto: null, codigo: /^\d{6,}$/.test(busca) ? busca : undefined })}>Novo produto</Botao>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[900px]">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Custo</th>
                  <th className="num">Venda</th>
                  <th className="num">Margem</th>
                  <th>Estoque</th>
                  <th>Validade</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const c = categoriaDe(p.categoria_id)
                  return (
                    <tr key={p.id} className={cx(!p.ativo && 'opacity-60', (p.estoque_baixo || p.perto_validade) && p.ativo && 'bg-amber-50/40')}>
                      <td>
                        <div className="flex items-center gap-3">
                          <FotoProduto url={p.foto_url} nome={p.nome} icone={c?.icone} cor={c?.cor} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{p.nome}</p>
                            <p className="text-xs text-slate-400">{c?.nome ?? 'Sem categoria'} · <span className="font-mono">{p.codigo_barras ?? 'sem código'}</span></p>
                          </div>
                          {!p.ativo && <Etiqueta>Inativo</Etiqueta>}
                        </div>
                      </td>
                      <td className="num text-slate-600">{brl(p.preco_custo)}</td>
                      <td className="num font-medium">{brl(p.preco_venda)}</td>
                      <td className="num text-slate-600">{pct((p.preco_venda - p.preco_custo) / p.preco_venda)}</td>
                      <td><SaldoEstoque p={p} /></td>
                      <td><Validade p={p} /></td>
                      <td>
                        <div className="flex justify-end gap-0.5">
                          <Acao titulo="Entrada" onClick={() => setMov({ tipo: 'entrada', produto: p.id })}><ArrowDownToLine /></Acao>
                          <Acao titulo="Saída manual" onClick={() => setMov({ tipo: 'saida', produto: p.id })}><ArrowUpFromLine /></Acao>
                          <Link to={`/admin/produtos/${p.id}`} title="Histórico" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 [&>svg]:size-4"><History /></Link>
                          <Acao titulo="Editar" onClick={() => setEdicao({ produto: p })}><Pencil /></Acao>
                          <Acao titulo={p.ativo ? 'Desativar' : 'Ativar'} onClick={() => alternarAtivo(p)} perigo={p.ativo}><Power /></Acao>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <FormProduto aberto={!!edicao} produto={edicao?.produto ?? null} codigoInicial={edicao?.codigo} categorias={categorias} fornecedores={fornecedores}
        aoFechar={() => setEdicao(null)} aoSalvar={salvo} />
      <FormMovimentacao aberto={!!mov} tipoInicial={mov?.tipo} produtoInicial={mov?.produto} produtos={lista} fornecedores={fornecedores}
        aoFechar={() => setMov(null)} aoSalvar={salvo} />
      <LeitorCamera aberto={camera} aoFechar={() => setCamera(false)} aoLer={aoLerCodigo} />
    </>
  )
}

function Acao({ titulo, onClick, children, perigo }: { titulo: string; onClick: () => void; children: React.ReactNode; perigo?: boolean }) {
  return (
    <button title={titulo} aria-label={titulo} onClick={onClick}
      className={cx('rounded-lg p-2 text-slate-500 hover:bg-slate-100 [&>svg]:size-4', perigo ? 'hover:text-rose-600' : 'hover:text-slate-800')}>
      {children}
    </button>
  )
}

function BotaoAlerta({ ativo, onClick, tom, icone, texto }: { ativo: boolean; onClick: () => void; tom: 'amarelo' | 'vermelho'; icone: React.ReactNode; texto: string }) {
  return (
    <button onClick={onClick} className={cx(
      'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
      tom === 'amarelo' ? 'border-amber-200 text-amber-800' : 'border-rose-200 text-rose-700',
      ativo ? (tom === 'amarelo' ? 'bg-amber-100' : 'bg-rose-100') : 'bg-white hover:bg-slate-50',
    )}>
      {icone} {texto}
    </button>
  )
}
