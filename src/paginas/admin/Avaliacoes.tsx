import { useMemo, useState } from 'react'
import { CheckCheck, MessageSquareText, PackagePlus, Star } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Avaliacao } from '../../lib/tipos'
import { dataHoraBR, hojeISO, numero, ROTULO_CLIENTE } from '../../lib/formato'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Rotulo, useAviso, Vazio } from '../../componentes/ui'
import { CampoData } from '../../componentes/CampoData'

export function Estrelas({ nota, tamanho = 'size-4' }: { nota: number; tamanho?: string }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${numero(nota, Number.isInteger(nota) ? 0 : 1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx(tamanho, n <= Math.round(nota) ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} strokeWidth={1.5} />
      ))}
    </span>
  )
}

export default function Avaliacoes() {
  const api = useApi()
  const avisar = useAviso()
  const [inicio, setInicio] = useState(hojeISO(-30))
  const [fim, setFim] = useState(hojeISO())
  const [nota, setNota] = useState<number | null>(null)
  const [soComentario, setSoComentario] = useState(false)
  const [soSugestao, setSoSugestao] = useState(false)

  const resumo = useCarregar(() => api.resumoAvaliacoes(inicio, fim), [inicio, fim])
  const pedidos = useCarregar(() => api.sugestoesProdutos(inicio, fim, 8), [inicio, fim])
  const lista = useCarregar(
    () => api.listarAvaliacoes({ inicio, fim, nota: nota ?? undefined, comComentario: soComentario, comSugestao: soSugestao, limite: 1000 }),
    [inicio, fim, nota, soComentario, soSugestao],
  )
  const naoLidas = useMemo(() => (lista.dados ?? []).filter((a) => !a.lida), [lista.dados])

  async function marcarLidas() {
    try {
      await api.marcarAvaliacoesLidas(naoLidas.map((a) => a.id))
      avisar('sucesso', 'Avaliações marcadas como lidas')
      lista.recarregar()
      resumo.recarregar()
      pedidos.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    }
  }

  const r = resumo.dados
  const maiorFaixa = Math.max(1, ...(r?.distribuicao ?? []).map((d) => d.quantidade))

  return (
    <>
      <CabecalhoPagina
        titulo="Avaliações"
        descricao="Notas e observações deixadas pelos clientes no totem depois do pagamento."
        acoes={naoLidas.length > 0 && (
          <Botao variante="secundario" icone={<CheckCheck className="size-4" />} onClick={marcarLidas}>
            Marcar {naoLidas.length} como lida{naoLidas.length > 1 ? 's' : ''}
          </Botao>
        )}
      />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Rotulo texto="De"><CampoData valor={inicio} max={fim} obrigatorio aoMudar={setInicio} className="w-40" /></Rotulo>
        <Rotulo texto="Até"><CampoData valor={fim} min={inicio} obrigatorio aoMudar={setFim} className="w-40" /></Rotulo>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)]">
        <Cartao className="flex flex-col items-center justify-center p-6 text-center">
          {!r ? <Carregando /> : (
            <>
              <p className="text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">{r.total ? numero(r.media, 1) : '—'}</p>
              <div className="mt-2"><Estrelas nota={r.media} tamanho="size-6" /></div>
              <p className="mt-2 text-sm text-slate-500">{numero(r.total)} avaliações · {numero(r.comentarios)} com observação</p>
              <p className="text-sm text-slate-500">{numero(r.sugestoes)} sugestões de produto</p>
            </>
          )}
        </Cartao>
        <Cartao className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Distribuição das notas</h2>
          <ul className="space-y-2">
            {(r?.distribuicao ?? []).map((d) => (
              <li key={d.nota}>
                <button onClick={() => setNota(nota === d.nota ? null : d.nota)} className={cx('flex w-full items-center gap-3 rounded-lg px-2 py-1 text-sm transition', nota === d.nota ? 'bg-amber-50' : 'hover:bg-slate-50')}>
                  <span className="flex w-10 items-center gap-1 text-slate-700">{d.nota} <Star className="size-3.5 fill-amber-400 text-amber-400" /></span>
                  <span className="h-2.5 flex-1 rounded-full bg-slate-100">
                    <span className="block h-2.5 rounded-full bg-amber-400" style={{ width: `${(d.quantidade / maiorFaixa) * 100}%` }} />
                  </span>
                  <span className="w-20 text-right text-slate-600 tabular-nums">
                    {numero(d.quantidade)} <span className="text-slate-400">({r?.total ? Math.round((d.quantidade / r.total) * 100) : 0}%)</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Toque numa nota para filtrar a lista.</p>
        </Cartao>
        <Cartao className="p-5 md:col-span-2 xl:col-span-1">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><PackagePlus className="size-4 text-slate-400" /> Produtos mais pedidos</h2>
          <p className="mb-3 text-xs text-slate-500">O que os clientes gostariam de encontrar no mercado</p>
          {!pedidos.dados ? <Carregando /> : pedidos.dados.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nenhuma sugestão no período.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {pedidos.dados.map((x, i) => (
                <li key={x.sugestao} className="flex items-center gap-3">
                  <span className="w-5 text-right text-xs text-slate-400 tabular-nums">{i + 1}.</span>
                  <span className="flex-1 truncate text-slate-800 first-letter:uppercase">{x.sugestao}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 tabular-nums">
                    {numero(x.pedidos)} pedido{x.pedidos > 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Cartao>
      </div>

      <Cartao>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Filtro ativo={nota === null} onClick={() => setNota(null)}>Todas</Filtro>
          {[5, 4, 3, 2, 1].map((n) => (
            <Filtro key={n} ativo={nota === n} onClick={() => setNota(n)}>{n} <Star className="size-3.5 fill-amber-400 text-amber-400" /></Filtro>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Filtro ativo={soComentario} onClick={() => setSoComentario(!soComentario)}><MessageSquareText className="size-3.5" /> Só com observação</Filtro>
          <Filtro ativo={soSugestao} onClick={() => setSoSugestao(!soSugestao)}><PackagePlus className="size-3.5" /> Só com sugestão de produto</Filtro>
        </div>
        {lista.carregando && !lista.dados ? <Carregando /> : !lista.dados?.length ? (
          <Vazio icone={<Star className="size-6" />} titulo="Nenhuma avaliação no filtro" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.dados.map((a) => <ItemAvaliacao key={a.id} a={a} />)}
          </ul>
        )}
      </Cartao>
    </>
  )
}

function ItemAvaliacao({ a }: { a: Avaliacao }) {
  const cliente = a.tipo_cliente === 'morador_cadastrado' && a.morador_nome ? a.morador_nome : ROTULO_CLIENTE[a.tipo_cliente]
  return (
    <li className={cx('flex flex-wrap items-start gap-x-6 gap-y-1 px-4 py-3', !a.lida && 'bg-amber-50/40')}>
      <div className="w-28 shrink-0 pt-0.5"><Estrelas nota={a.nota} /></div>
      <div className="min-w-0 flex-1">
        {a.comentario ? <p className="text-slate-800">“{a.comentario}”</p> : !a.sugestao && <p className="text-slate-400 italic">Sem observação</p>}
        {a.sugestao && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-emerald-800">
            <PackagePlus className="size-4 shrink-0" /> Gostaria de encontrar: <strong className="font-medium">{a.sugestao}</strong>
          </p>
        )}
        <p className="mt-0.5 text-xs text-slate-500">{cliente} · compra #{a.venda_numero} · {dataHoraBR(a.criado_em)}</p>
      </div>
      {!a.lida && <Etiqueta tom="amarelo">Nova</Etiqueta>}
    </li>
  )
}

function Filtro({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx(
      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition',
      ativo ? 'border-marca bg-marca text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
    )}>
      {children}
    </button>
  )
}
