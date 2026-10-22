import { useMemo, useState, type FormEvent } from 'react'
import { Pencil, Plus, Power, PowerOff, Search, TicketPercent } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Produto, Promocao, PromocaoEditavel, SituacaoPromocao, TipoPromocao } from '../../lib/tipos'
import { brl, dataBR, decimalParaCampo, hojeISO, lerDecimal, numero } from '../../lib/formato'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Modal, Rotulo, useAviso, Vazio } from '../../componentes/ui'
import { CampoData } from '../../componentes/CampoData'

type Filtro = SituacaoPromocao | 'todas'
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'ativa', rotulo: 'Ativas' },
  { id: 'agendada', rotulo: 'Agendadas' },
  { id: 'encerrada', rotulo: 'Encerradas' },
  { id: 'todas', rotulo: 'Todas' },
]
const ETIQUETA: Record<SituacaoPromocao, { tom: 'verde' | 'azul' | 'neutro'; texto: string }> = {
  ativa: { tom: 'verde', texto: 'Ativa' },
  agendada: { tom: 'azul', texto: 'Agendada' },
  encerrada: { tom: 'neutro', texto: 'Encerrada' },
}

/** mesmo cálculo do banco (preco_com_promocao) */
export function precoComPromocao(preco: number, tipo: TipoPromocao, valor: number) {
  const final = tipo === 'percentual' ? Math.round(preco * (100 - valor)) / 100 : Math.round(valor * 100) / 100
  return Math.max(0.01, Math.min(preco, final))
}

const descontoPct = (normal: number, promo: number) => Math.round((1 - promo / normal) * 100)

export default function Promocoes() {
  const api = useApi()
  const avisar = useAviso()
  const lista = useCarregar(() => api.listarPromocoes(), [])
  const produtos = useCarregar(() => api.listarProdutos(), [])
  const [filtro, setFiltro] = useState<Filtro>('ativa')
  const [busca, setBusca] = useState('')
  const [edicao, setEdicao] = useState<Promocao | 'nova' | null>(null)

  const contagem = useMemo(() => {
    const c = { ativa: 0, agendada: 0, encerrada: 0, todas: 0 } as Record<Filtro, number>
    for (const p of lista.dados ?? []) { c[p.situacao]++; c.todas++ }
    return c
  }, [lista.dados])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (lista.dados ?? []).filter((p) => (filtro === 'todas' || p.situacao === filtro)
      && (!t || p.produto_nome.toLowerCase().includes(t) || (p.titulo ?? '').toLowerCase().includes(t)))
  }, [lista.dados, filtro, busca])

  async function alternar(p: Promocao) {
    const encerrar = p.situacao !== 'encerrada'
    try {
      await api.alterarPromocaoAtiva(p.id, !encerrar)
      avisar('sucesso', encerrar ? `Promoção de ${p.produto_nome} encerrada` : `Promoção de ${p.produto_nome} reativada`)
      lista.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Promoções"
        descricao="Desconto em % ou preço promocional por período. O totem mostra o “de / por” e já cobra o preço com desconto."
        acoes={<Botao icone={<Plus className="size-4" />} onClick={() => setEdicao('nova')}>Nova promoção</Botao>}
      />
      <Cartao>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button key={f.id} onClick={() => setFiltro(f.id)} className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                filtro === f.id ? 'bg-marca text-white' : 'text-slate-600 hover:bg-slate-100',
              )}>
                {f.rotulo} <span className={cx('tabular-nums', filtro === f.id ? 'text-white/70' : 'text-slate-400')}>{contagem[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="campo pl-9" placeholder="Buscar produto ou promoção" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <p className="p-6 text-sm text-rose-600">{lista.erro}</p>
          : visiveis.length === 0 ? (
            <Vazio icone={<TicketPercent className="size-6" />}
              titulo={filtro === 'ativa' ? 'Nenhuma promoção ativa' : 'Nenhuma promoção aqui'}
              texto="Crie uma promoção para um produto: o preço muda no totem na hora."
              acao={<Botao icone={<Plus className="size-4" />} onClick={() => setEdicao('nova')}>Nova promoção</Botao>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[820px]">
                <thead>
                  <tr><th>Produto</th><th>Promoção</th><th className="num">De</th><th className="num">Por</th><th>Período</th><th>Situação</th><th className="text-right">Ações</th></tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr key={p.id} className={cx(p.situacao === 'encerrada' && 'opacity-60')}>
                      <td className="font-medium text-slate-900">{p.produto_nome}</td>
                      <td>
                        <p className="text-slate-800">{p.titulo || '—'}</p>
                        <p className="text-xs text-slate-500">{p.tipo === 'percentual' ? `${numero(p.valor)}% de desconto` : 'Preço promocional'}</p>
                      </td>
                      <td className="num text-slate-400 line-through">{brl(p.preco_normal)}</td>
                      <td className="num">
                        <span className="font-semibold text-emerald-700">{brl(p.preco_promocional)}</span>
                        <span className="block text-xs text-slate-500">−{descontoPct(p.preco_normal, p.preco_promocional)}%</span>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">{dataBR(p.inicio)} {p.fim ? `a ${dataBR(p.fim)}` : <span className="text-slate-400">· sem data para acabar</span>}</td>
                      <td><Etiqueta tom={ETIQUETA[p.situacao].tom}>{ETIQUETA[p.situacao].texto}</Etiqueta></td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button title="Editar" aria-label={`Editar promoção de ${p.produto_nome}`} onClick={() => setEdicao(p)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Pencil className="size-4" /></button>
                          {p.situacao === 'encerrada' && !p.ativa && (!p.fim || p.fim >= hojeISO()) ? (
                            <button title="Reativar" aria-label={`Reativar promoção de ${p.produto_nome}`} onClick={() => alternar(p)}
                              className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"><Power className="size-4" /></button>
                          ) : p.situacao !== 'encerrada' && (
                            <button title="Encerrar agora" aria-label={`Encerrar promoção de ${p.produto_nome}`} onClick={() => alternar(p)}
                              className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><PowerOff className="size-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Cartao>

      <FormPromocao valor={edicao} produtos={(produtos.dados ?? []).filter((p) => p.ativo)}
        aoFechar={() => setEdicao(null)} aoSalvar={() => { setEdicao(null); lista.recarregar() }} />
    </>
  )
}

function FormPromocao({ valor, produtos, aoFechar, aoSalvar }: {
  valor: Promocao | 'nova' | null; produtos: Produto[]; aoFechar: () => void; aoSalvar: () => void
}) {
  const api = useApi()
  const avisar = useAviso()
  const nova = valor === 'nova'
  const vazio = { produto_id: '', titulo: '', tipo: 'percentual' as TipoPromocao, valor: '', inicio: hojeISO(), fim: '' }
  const [f, setF] = useState(vazio)
  const [ultimo, setUltimo] = useState(valor)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  if (valor !== ultimo) {
    setUltimo(valor)
    setErro(null)
    setF(valor && valor !== 'nova'
      ? { produto_id: valor.produto_id, titulo: valor.titulo ?? '', tipo: valor.tipo, valor: valor.tipo === 'percentual' ? String(valor.valor) : decimalParaCampo(valor.valor), inicio: valor.inicio, fim: valor.fim ?? '' }
      : vazio)
  }

  const produto = produtos.find((p) => p.id === f.produto_id)
  const n = lerDecimal(f.valor || '')
  const valido = Number.isFinite(n) && n > 0
  const final = produto && valido ? precoComPromocao(produto.preco_venda, f.tipo, n) : null

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!produto) return setErro('Escolha o produto.')
    if (!valido) return setErro(f.tipo === 'percentual' ? 'Informe o desconto em %.' : 'Informe o preço promocional.')
    if (f.tipo === 'percentual' && n >= 100) return setErro('O desconto deve ser menor que 100%.')
    if (f.tipo === 'preco_fixo' && n >= produto.preco_venda) return setErro(`O preço promocional precisa ser menor que o normal (${brl(produto.preco_venda)}).`)
    if (!f.inicio) return setErro('Informe a data de início.')
    if (f.fim && f.fim < f.inicio) return setErro('A data de fim não pode ser antes do início.')
    const dados: PromocaoEditavel = {
      id: valor && valor !== 'nova' ? valor.id : undefined,
      produto_id: produto.id, titulo: f.titulo.trim() || null, tipo: f.tipo, valor: n, inicio: f.inicio, fim: f.fim || null,
    }
    setSalvando(true)
    try {
      await api.salvarPromocao(dados)
      avisar('sucesso', nova ? `Promoção criada: ${produto.nome} por ${brl(final)}` : 'Promoção atualizada')
      aoSalvar()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal aberto={!!valor} aoFechar={aoFechar} titulo={nova ? 'Nova promoção' : 'Editar promoção'}
      rodape={<><Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao><Botao type="submit" form="form-promocao" carregando={salvando}>Salvar</Botao></>}>
      <form id="form-promocao" onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
        <Rotulo texto="Produto" className="sm:col-span-2">
          <select className="campo" required value={f.produto_id} onChange={(e) => setF((x) => ({ ...x, produto_id: e.target.value }))} autoFocus>
            <option value="">Escolha o produto…</option>
            {[...produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((p) => (
              <option key={p.id} value={p.id}>{p.nome} — {brl(p.preco_venda)}</option>
            ))}
          </select>
        </Rotulo>
        <Rotulo texto="Nome da promoção" dica="Opcional; aparece no totem (ex.: Semana do chocolate)" className="sm:col-span-2">
          <input className="campo" maxLength={60} value={f.titulo} onChange={(e) => setF((x) => ({ ...x, titulo: e.target.value }))} placeholder="Promoção" />
        </Rotulo>

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Tipo de desconto</legend>
          <div className="grid grid-cols-2 gap-2">
            {([['percentual', '% de desconto'], ['preco_fixo', 'Preço promocional']] as const).map(([t, rot]) => (
              <button key={t} type="button" onClick={() => setF((x) => ({ ...x, tipo: t, valor: '' }))} aria-pressed={f.tipo === t}
                className={cx('rounded-lg border px-3 py-2 text-sm font-medium transition',
                  f.tipo === t ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>
                {rot}
              </button>
            ))}
          </div>
        </fieldset>

        <Rotulo texto={f.tipo === 'percentual' ? 'Desconto (%)' : 'Preço promocional (R$)'}>
          <div className="relative max-w-40">
            {f.tipo === 'preco_fixo' && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">R$</span>}
            <input className={cx('campo tabular-nums', f.tipo === 'preco_fixo' ? 'pl-9' : 'pr-8')} inputMode="decimal" required
              value={f.valor} onChange={(e) => setF((x) => ({ ...x, valor: e.target.value.replace(/[^\d,.]/g, '') }))}
              placeholder={f.tipo === 'percentual' ? '20' : '0,00'} />
            {f.tipo === 'percentual' && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">%</span>}
          </div>
        </Rotulo>
        <div className="flex items-end">
          {produto && final != null ? (
            <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
              De <span className="text-slate-500 line-through">{brl(produto.preco_venda)}</span> por{' '}
              <strong className="text-base">{brl(final)}</strong>{' '}
              <span className="text-emerald-700">(−{descontoPct(produto.preco_venda, final)}%)</span>
            </p>
          ) : <p className="text-sm text-slate-400">Escolha o produto e o desconto para ver o preço final.</p>}
        </div>

        <Rotulo texto="Começa em">
          <CampoData valor={f.inicio} aoMudar={(v) => setF((x) => ({ ...x, inicio: v }))} obrigatorio ariaLabel="Data de início" />
        </Rotulo>
        <Rotulo texto="Termina em" dica="Em branco = sem data para acabar">
          <CampoData valor={f.fim} aoMudar={(v) => setF((x) => ({ ...x, fim: v }))} min={f.inicio} ariaLabel="Data de fim" />
        </Rotulo>
        {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{erro}</p>}
      </form>
    </Modal>
  )
}
