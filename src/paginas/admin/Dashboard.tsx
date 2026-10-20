import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { CalendarClock, FileSpreadsheet, FileText, Receipt, ShoppingCart, Star, TrendingUp, TriangleAlert, Wallet } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Agrupamento, MetodoPagamento } from '../../lib/tipos'
import { brl, brlCurto, dataBR, hojeISO, numero, pct, rotuloPeriodo, ROTULO_CLIENTE, ROTULO_METODO, somarDias } from '../../lib/formato'
import { exportarExcel, exportarPDF, fmtExcel } from '../../lib/exportar'
import { Botao, Carregando, Cartao, cx, useAviso } from '../../componentes/ui'
import { CampoData } from '../../componentes/CampoData'

// Paleta da marca pickgo, validada para daltonismo (verde · dourado · azul, ordem fixa)
const COR = { faturamento: '#237a4b', lucro: '#d99a12', pix: '#237a4b', cartao_debito: '#d99a12', cartao_credito: '#5a8fd0', barra: '#237a4b' }
const GRADE = '#e2e8f0'
const EIXO = { fontSize: 12, fill: '#64748b' }

type Preset = 'hoje' | '7d' | '30d' | 'mes' | 'custom'
const PRESETS: { id: Preset; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' }, { id: '7d', rotulo: '7 dias' }, { id: '30d', rotulo: '30 dias' }, { id: 'mes', rotulo: 'Mês atual' }, { id: 'custom', rotulo: 'Personalizado' },
]

function intervalo(p: Preset, custom: { inicio: string; fim: string }) {
  const hoje = hojeISO()
  switch (p) {
    case 'hoje': return { inicio: hoje, fim: hoje }
    case '7d': return { inicio: somarDias(hoje, -6), fim: hoje }
    case '30d': return { inicio: somarDias(hoje, -29), fim: hoje }
    case 'mes': return { inicio: `${hoje.slice(0, 8)}01`, fim: hoje }
    default: return custom
  }
}

export default function Dashboard() {
  const api = useApi()
  const avisar = useAviso()
  const [preset, setPreset] = useState<Preset>('30d')
  const [custom, setCustom] = useState({ inicio: somarDias(hojeISO(), -59), fim: hojeISO() })
  const { inicio, fim } = intervalo(preset, custom)
  const dias = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 86_400_000) + 1
  const [agrupEscolhido, setAgrupEscolhido] = useState<Agrupamento | null>(null)
  const agrup: Agrupamento = agrupEscolhido ?? (dias <= 45 ? 'dia' : dias <= 180 ? 'semana' : 'mes')
  const [versao, setVersao] = useState(0)
  const [exportando, setExportando] = useState<'pdf' | 'xlsx' | null>(null)

  // atualiza sozinho quando o totem conclui uma venda (realtime)
  useEffect(() => {
    let t: number | undefined
    const off = api.aoNovaVenda(() => {
      clearTimeout(t)
      t = window.setTimeout(() => setVersao((v) => v + 1), 1500)
    })
    return () => { off(); clearTimeout(t) }
  }, [api])

  const d = useCarregar(async () => {
    const [resumo, serie, top, cats, metodos, produtos, clientes, avaliacoes] = await Promise.all([
      api.resumo(inicio, fim), api.serie(inicio, fim, agrup), api.topProdutos(inicio, fim, 10),
      api.porCategoria(inicio, fim), api.porMetodo(inicio, fim), api.listarProdutos(), api.porCliente(inicio, fim),
      api.resumoAvaliacoes(inicio, fim),
    ])
    return { resumo, serie, top, cats, metodos, produtos, clientes, avaliacoes }
  }, [inicio, fim, agrup, versao])

  const serie = useMemo(() => (d.dados?.serie ?? []).map((p) => ({ ...p, rotulo: rotuloPeriodo(p.periodo, agrup) })), [d.dados, agrup])
  const metodos = d.dados?.metodos ?? []
  const top = d.dados?.top ?? []
  const cats = d.dados?.cats ?? []
  const totalMetodos = metodos.reduce((s, m) => s + m.faturamento, 0)
  const fatPix = metodos.find((m) => m.metodo === 'pix')?.faturamento ?? 0
  const alertas = useMemo(() => {
    const ativos = (d.dados?.produtos ?? []).filter((p) => p.ativo)
    return { estoque: ativos.filter((p) => p.estoque_baixo), validade: ativos.filter((p) => p.perto_validade) }
  }, [d.dados])

  async function exportar(tipo: 'pdf' | 'xlsx') {
    if (!d.dados) return
    const { resumo } = d.dados
    const nome = `relatorio_${inicio}_${fim}`
    const periodo = `Período: ${dataBR(inicio)} a ${dataBR(fim)}`
    const colSerie = [
      { titulo: agrup === 'dia' ? 'Dia' : agrup === 'semana' ? 'Semana de' : 'Mês', valor: (p: (typeof serie)[0]) => dataBR(p.periodo) },
      { titulo: 'Vendas', valor: (p: (typeof serie)[0]) => p.vendas, alinhar: 'direita' as const },
      { titulo: 'Faturamento', valor: (p: (typeof serie)[0]) => (tipo === 'pdf' ? brl(p.faturamento) : p.faturamento), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
      { titulo: 'Lucro bruto', valor: (p: (typeof serie)[0]) => (tipo === 'pdf' ? brl(p.lucro) : p.lucro), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
    ]
    const v = (n: number) => (tipo === 'pdf' ? brl(n) : n)
    const secoes = [
      { titulo: 'Faturamento e lucro', colunas: colSerie, linhas: serie },
      { titulo: 'Produtos mais vendidos', linhas: top, colunas: [
        { titulo: 'Produto', valor: (p: (typeof top)[0]) => p.nome, largura: 34 },
        { titulo: 'Quantidade', valor: (p: (typeof top)[0]) => p.quantidade, alinhar: 'direita' as const },
        { titulo: 'Faturamento', valor: (p: (typeof top)[0]) => v(p.faturamento), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
        { titulo: 'Lucro bruto', valor: (p: (typeof top)[0]) => v(p.lucro), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
      ] },
      { titulo: 'Faturamento por categoria', linhas: cats, colunas: [
        { titulo: 'Categoria', valor: (c: (typeof cats)[0]) => c.categoria, largura: 20 },
        { titulo: 'Itens', valor: (c: (typeof cats)[0]) => c.quantidade, alinhar: 'direita' as const },
        { titulo: 'Faturamento', valor: (c: (typeof cats)[0]) => v(c.faturamento), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
        { titulo: 'Lucro bruto', valor: (c: (typeof cats)[0]) => v(c.lucro), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
      ] },
      { titulo: 'Formas de pagamento', linhas: metodos, colunas: [
        { titulo: 'Forma', valor: (m: (typeof metodos)[0]) => ROTULO_METODO[m.metodo] },
        { titulo: 'Vendas', valor: (m: (typeof metodos)[0]) => m.vendas, alinhar: 'direita' as const },
        { titulo: 'Faturamento', valor: (m: (typeof metodos)[0]) => v(m.faturamento), formatoExcel: fmtExcel.moeda, alinhar: 'direita' as const },
        { titulo: 'Participação', valor: (m: (typeof metodos)[0]) => (tipo === 'pdf' ? pct(m.faturamento / (totalMetodos || 1)) : m.faturamento / (totalMetodos || 1)), formatoExcel: fmtExcel.pct, alinhar: 'direita' as const },
      ] },
    ]
    setExportando(tipo)
    try {
      if (tipo === 'pdf') {
        await exportarPDF(nome, 'pickgo — Relatório de vendas', periodo, secoes, [
          { rotulo: 'Faturamento', valor: brl(resumo.faturamento) },
          { rotulo: 'Lucro bruto', valor: brl(resumo.lucro_bruto) },
          { rotulo: 'Vendas', valor: numero(resumo.num_vendas) },
          { rotulo: 'Ticket médio', valor: brl(resumo.ticket_medio) },
        ])
      } else {
        const linhasResumo = [
          ['Período', `${dataBR(inicio)} a ${dataBR(fim)}`], ['Faturamento', resumo.faturamento], ['Custo das mercadorias', resumo.custo],
          ['Lucro bruto', resumo.lucro_bruto], ['Margem bruta', resumo.faturamento ? resumo.lucro_bruto / resumo.faturamento : 0],
          ['Número de vendas', resumo.num_vendas], ['Ticket médio', resumo.ticket_medio], ['Itens vendidos', resumo.itens_vendidos],
        ] as [string, string | number][]
        await exportarExcel(nome, [
          { titulo: 'Resumo', linhas: linhasResumo, colunas: [{ titulo: 'Indicador', valor: (l) => l[0], largura: 26 }, { titulo: 'Valor', valor: (l) => l[1], largura: 24, formatoExcel: '#,##0.00' }] },
          ...secoes,
        ])
      }
    } catch (e) {
      avisar('erro', `Falha ao exportar: ${(e as Error).message}`)
    } finally {
      setExportando(null)
    }
  }

  const r = d.dados?.resumo
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">{dataBR(inicio)} a {dataBR(fim)}</p>
        </div>
        <div className="flex gap-2">
          <Botao variante="secundario" icone={<FileText className="size-4" />} carregando={exportando === 'pdf'} disabled={!d.dados} onClick={() => exportar('pdf')}>PDF</Botao>
          <Botao variante="secundario" icone={<FileSpreadsheet className="size-4" />} carregando={exportando === 'xlsx'} disabled={!d.dados} onClick={() => exportar('xlsx')}>Excel</Botao>
        </div>
      </div>

      {/* filtros: uma linha acima dos gráficos */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => setPreset(p.id)} className={cx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition', preset === p.id ? 'bg-marca text-white' : 'text-slate-600 hover:bg-slate-100',
            )}>{p.rotulo}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <CampoData valor={custom.inicio} max={custom.fim} obrigatorio aoMudar={(v) => setCustom((c) => ({ ...c, inicio: v }))} ariaLabel="Data inicial" className="w-40" />
            <span className="text-slate-400">até</span>
            <CampoData valor={custom.fim} min={custom.inicio} max={hojeISO()} obrigatorio aoMudar={(v) => setCustom((c) => ({ ...c, fim: v }))} ariaLabel="Data final" className="w-40" />
          </div>
        )}
      </div>

      {!d.dados && d.carregando ? <Carregando /> : d.erro ? <p className="text-sm text-rose-600">{d.erro}</p> : r && (
        <div className={cx('space-y-6 transition-opacity', d.carregando && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
            <Indicador rotulo="Faturamento hoje" valor={brl(r.faturamento_hoje)} icone={<Wallet />} />
            <Indicador rotulo="Faturamento do mês" valor={brl(r.faturamento_mes)} icone={<TrendingUp />} />
            <Indicador rotulo="Ticket médio" valor={brl(r.ticket_medio)} detalhe="no período" icone={<Receipt />} />
            <Indicador rotulo="Número de vendas" valor={numero(r.num_vendas)} detalhe={`${numero(r.itens_vendidos)} itens no período`} icone={<ShoppingCart />} />
            <Link to="/admin/avaliacoes" className="block rounded-xl focus-visible:outline-2">
              <Indicador rotulo="Satisfação" icone={<Star />}
                valor={d.dados!.avaliacoes.total ? `${numero(d.dados!.avaliacoes.media, 1)} ★` : '—'}
                detalhe={`${numero(d.dados!.avaliacoes.total)} avaliações${d.dados!.avaliacoes.nao_lidas ? ` · ${d.dados!.avaliacoes.nao_lidas} novas` : ''}`} />
            </Link>
            <Indicador rotulo="Lucro bruto" valor={brl(r.lucro_bruto)} detalhe={`margem ${pct(r.faturamento ? r.lucro_bruto / r.faturamento : 0)} · fat. ${brl(r.faturamento)}`} icone={<TrendingUp />} destaque />
          </div>

          <Cartao className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Faturamento e lucro bruto</h2>
                <p className="text-sm text-slate-500">por {agrup === 'dia' ? 'dia' : agrup === 'semana' ? 'semana' : 'mês'}</p>
              </div>
              <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
                {(['dia', 'semana', 'mes'] as Agrupamento[]).map((a) => (
                  <button key={a} onClick={() => setAgrupEscolhido(a)} className={cx('rounded-md px-3 py-1', agrup === a ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-500')}>
                    {a === 'dia' ? 'Dia' : a === 'semana' ? 'Semana' : 'Mês'}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={serie} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={GRADE} vertical={false} />
                  <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: GRADE }} minTickGap={16} />
                  <YAxis tick={EIXO} tickLine={false} axisLine={false} tickFormatter={brlCurto} width={78} />
                  <Tooltip content={<DicaSerie agrup={agrup} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                  <Legend verticalAlign="top" align="right" height={28} iconType="plainline" formatter={(v) => <span className="text-sm text-slate-600">{v}</span>} />
                  <Line name="Faturamento" dataKey="faturamento" stroke={COR.faturamento} strokeWidth={2} dot={serie.length <= 14 ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                  <Line name="Lucro bruto" dataKey="lucro" stroke={COR.lucro} strokeWidth={2} dot={serie.length <= 14 ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Cartao>

          <div className="grid gap-6 lg:grid-cols-2">
            <Cartao className="p-5">
              <h2 className="font-semibold text-slate-900">Produtos mais vendidos</h2>
              <p className="mb-4 text-sm text-slate-500">unidades vendidas</p>
              {top.length === 0 ? <SemDados /> : (
                <div style={{ height: Math.max(160, top.length * 32) }}>
                  <ResponsiveContainer>
                    <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={4}>
                      <CartesianGrid stroke={GRADE} horizontal={false} />
                      <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="nome" tick={{ ...EIXO, fill: '#334155' }} tickLine={false} axisLine={false} width={190} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} content={<DicaBarra campos={[['quantidade', 'Unidades', numero], ['faturamento', 'Faturamento', brl], ['lucro', 'Lucro bruto', brl]]} titulo="nome" />} />
                      <Bar dataKey="quantidade" fill={COR.barra} radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Cartao>

            <Cartao className="p-5">
              <h2 className="font-semibold text-slate-900">Categorias que mais faturam</h2>
              <p className="mb-4 text-sm text-slate-500">faturamento no período</p>
              {cats.length === 0 ? <SemDados /> : (
                <div style={{ height: Math.max(160, cats.length * 40) }}>
                  <ResponsiveContainer>
                    <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
                      <CartesianGrid stroke={GRADE} horizontal={false} />
                      <XAxis type="number" tick={EIXO} tickLine={false} axisLine={false} tickFormatter={brlCurto} />
                      <YAxis type="category" dataKey="categoria" tick={{ ...EIXO, fill: '#334155' }} tickLine={false} axisLine={false} width={100} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} content={<DicaBarra campos={[['faturamento', 'Faturamento', brl], ['lucro', 'Lucro bruto', brl], ['quantidade', 'Itens', numero]]} titulo="categoria" />} />
                      <Bar dataKey="faturamento" fill={COR.barra} radius={[0, 4, 4, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Cartao>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <Cartao className="p-5">
              <h2 className="font-semibold text-slate-900">PIX × cartão</h2>
              <p className="mb-2 text-sm text-slate-500">participação no faturamento</p>
              {totalMetodos === 0 ? <SemDados /> : (
                <div className="flex flex-wrap items-center gap-6">
                  <div className="relative size-48 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={metodos} dataKey="faturamento" nameKey="metodo" innerRadius={58} outerRadius={88} paddingAngle={1.5} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                          {metodos.map((m) => <Cell key={m.metodo} fill={COR[m.metodo]} />)}
                        </Pie>
                        <Tooltip content={<DicaMetodo total={totalMetodos} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div><p className="text-2xl font-semibold tabular-nums">{pct(fatPix / totalMetodos)}</p><p className="text-xs text-slate-500">via PIX</p></div>
                    </div>
                  </div>
                  <ul className="min-w-44 flex-1 space-y-3 text-sm">
                    {metodos.map((m) => (
                      <li key={m.metodo} className="flex items-center gap-3">
                        <span className="size-3 shrink-0 rounded-sm" style={{ background: COR[m.metodo] }} />
                        <span className="flex-1 text-slate-700">{m.metodo === 'pix' ? 'PIX' : `Cartão de ${m.metodo === 'cartao_debito' ? 'débito' : 'crédito'}`}</span>
                        <span className="text-right tabular-nums"><strong className="text-slate-900">{pct(m.faturamento / totalMetodos)}</strong><span className="block text-xs text-slate-500">{brl(m.faturamento)} · {m.vendas} vendas</span></span>
                      </li>
                    ))}
                    <li className="border-t border-slate-100 pt-2 text-slate-500">Cartão (total): <strong className="text-slate-800">{pct(1 - fatPix / totalMetodos)}</strong></li>
                  </ul>
                </div>
              )}
            </Cartao>

            <Cartao className="p-5">
              <h2 className="font-semibold text-slate-900">Quem compra</h2>
              <p className="mb-4 text-sm text-slate-500">faturamento por tipo de cliente</p>
              {(d.dados?.clientes ?? []).length === 0 ? <SemDados /> : (
                <ul className="space-y-4">
                  {(['morador_cadastrado', 'morador', 'visitante'] as const).map((t) => {
                    const c = d.dados!.clientes.find((x) => x.tipo_cliente === t)
                    const totalCli = d.dados!.clientes.reduce((s, x) => s + x.faturamento, 0) || 1
                    const parte = (c?.faturamento ?? 0) / totalCli
                    return (
                      <li key={t}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-slate-700">{ROTULO_CLIENTE[t]}</span>
                          <strong className="text-slate-900 tabular-nums">{pct(parte)}</strong>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full" style={{ width: `${parte * 100}%`, background: COR.barra }} />
                        </div>
                        <p className="mt-1 text-xs text-slate-500 tabular-nums">{brl(c?.faturamento ?? 0)} · {numero(c?.vendas ?? 0)} vendas</p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Cartao>

            <Cartao className="p-5 lg:col-span-2 2xl:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Atenção no estoque</h2>
                <Link to="/admin/produtos" className="text-sm text-emerald-700 hover:underline">Ver produtos</Link>
              </div>
              {alertas.estoque.length + alertas.validade.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Nenhum alerta. Tudo em ordem.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {alertas.estoque.map((p) => (
                    <li key={`e${p.id}`} className="flex items-center gap-3 py-2">
                      <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-label="Estoque baixo" />
                      <Link to={`/admin/produtos/${p.id}`} className="flex-1 truncate hover:underline">{p.nome}</Link>
                      <span className="text-slate-500 tabular-nums">estoque <strong className={p.estoque_atual <= 0 ? 'text-rose-600' : 'text-amber-700'}>{p.estoque_atual}</strong> / mín {p.estoque_minimo}</span>
                    </li>
                  ))}
                  {alertas.validade.map((p) => (
                    <li key={`v${p.id}`} className="flex items-center gap-3 py-2">
                      <CalendarClock className={cx('size-4 shrink-0', p.vencido ? 'text-rose-500' : 'text-amber-500')} aria-label="Validade" />
                      <Link to={`/admin/produtos/${p.id}`} className="flex-1 truncate hover:underline">{p.nome}</Link>
                      <span className={cx('tabular-nums', p.vencido ? 'text-rose-600' : 'text-slate-500')}>{p.vencido ? 'vencido em' : 'vence'} {dataBR(p.validade)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>
        </div>
      )}
    </>
  )
}

function Indicador({ rotulo, valor, detalhe, icone, destaque }: { rotulo: string; valor: string; detalhe?: string; icone: ReactNode; destaque?: boolean }) {
  return (
    <Cartao className={cx('p-4', destaque && 'col-span-2 border-emerald-200 bg-emerald-50/50 md:col-span-1')}>
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs font-medium tracking-wide uppercase">{rotulo}</p>
        <span className="[&>svg]:size-4">{icone}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{valor}</p>
      {detalhe && <p className="mt-0.5 truncate text-xs text-slate-500" title={detalhe}>{detalhe}</p>}
    </Cartao>
  )
}

function SemDados() {
  return <p className="py-12 text-center text-sm text-slate-500">Sem vendas no período.</p>
}

function CaixaDica({ titulo, linhas }: { titulo: string; linhas: { cor?: string; rotulo: string; valor: string }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-medium text-slate-900">{titulo}</p>
      {linhas.map((l) => (
        <p key={l.rotulo} className="flex items-center gap-2 text-slate-600">
          {l.cor && <span className="h-0.5 w-3 rounded" style={{ background: l.cor }} />}
          <span className="flex-1">{l.rotulo}</span>
          <span className="font-medium text-slate-900 tabular-nums">{l.valor}</span>
        </p>
      ))}
    </div>
  )
}

// Recharts injeta active/payload nos componentes de tooltip
interface PropsDica { active?: boolean; payload?: { payload: Record<string, unknown> }[] }

function DicaSerie({ active, payload, agrup }: PropsDica & { agrup: Agrupamento }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { periodo: string; faturamento: number; lucro: number; vendas: number }
  const titulo = agrup === 'semana' ? `Semana de ${dataBR(p.periodo)}` : agrup === 'mes' ? rotuloPeriodo(p.periodo, 'mes') : dataBR(p.periodo)
  return <CaixaDica titulo={titulo} linhas={[
    { cor: COR.faturamento, rotulo: 'Faturamento', valor: brl(p.faturamento) },
    { cor: COR.lucro, rotulo: 'Lucro bruto', valor: brl(p.lucro) },
    { rotulo: 'Vendas', valor: numero(p.vendas) },
  ]} />
}

function DicaBarra({ active, payload, campos, titulo }: PropsDica & { campos: [string, string, (n: number) => string][]; titulo: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return <CaixaDica titulo={String(p[titulo])} linhas={campos.map(([k, rotulo, f]) => ({ rotulo, valor: f(Number(p[k])) }))} />
}

function DicaMetodo({ active, payload, total }: PropsDica & { total: number }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload as { metodo: MetodoPagamento; faturamento: number; vendas: number }
  return <CaixaDica titulo={ROTULO_METODO[m.metodo]} linhas={[
    { cor: COR[m.metodo], rotulo: 'Faturamento', valor: brl(m.faturamento) },
    { rotulo: 'Participação', valor: pct(m.faturamento / total) },
    { rotulo: 'Vendas', valor: numero(m.vendas) },
  ]} />
}
