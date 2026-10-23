// Sino de avisos do painel: contador, lista rápida e alerta na tela
// quando chega algo urgente. Atualiza em tempo real e a cada minuto.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { BadgeAlert, Bell, CalendarClock, CalendarX, CheckCheck, CircleDollarSign, PackagePlus, PackageX, StarOff, TriangleAlert, Undo2, WifiOff, type LucideIcon } from 'lucide-react'
import { useApi } from '../lib/sessao'
import type { Aviso, GravidadeAviso, TipoAviso } from '../lib/tipos'
import { tempoRelativo } from '../lib/formato'
import { cx, useAviso } from './ui'

export const VISUAL_AVISO: Record<TipoAviso, { icone: LucideIcon; rotulo: string }> = {
  estoque_baixo: { icone: TriangleAlert, rotulo: 'Estoque baixo' },
  estoque_zerado: { icone: PackageX, rotulo: 'Estoque zerado' },
  validade_proxima: { icone: CalendarClock, rotulo: 'Validade próxima' },
  produto_vencido: { icone: CalendarX, rotulo: 'Produto vencido' },
  avaliacao_baixa: { icone: StarOff, rotulo: 'Avaliação ruim' },
  sugestao_produto: { icone: PackagePlus, rotulo: 'Sugestão de produto' },
  venda_offline: { icone: WifiOff, rotulo: 'PIX sem internet a conferir' },
  venda_offline_rejeitada: { icone: BadgeAlert, rotulo: 'Compra sem internet não registrada' },
  preco_divergente: { icone: CircleDollarSign, rotulo: 'Preço diferente do catálogo' },
  estorno: { icone: Undo2, rotulo: 'Estorno / contestação' },
}

export const COR_GRAVIDADE: Record<GravidadeAviso, string> = {
  critico: 'bg-rose-50 text-rose-600 ring-rose-200',
  atencao: 'bg-amber-50 text-amber-600 ring-amber-200',
  info: 'bg-sky-50 text-sky-600 ring-sky-200',
}
export const ROTULO_GRAVIDADE: Record<GravidadeAviso, string> = { critico: 'Urgente', atencao: 'Atenção', info: 'Informativo' }

export function IconeAviso({ a, tamanho = 'size-9' }: { a: Pick<Aviso, 'tipo' | 'gravidade'>; tamanho?: string }) {
  const Icone = VISUAL_AVISO[a.tipo].icone
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg ring-1 ring-inset', tamanho, COR_GRAVIDADE[a.gravidade])} title={ROTULO_GRAVIDADE[a.gravidade]}>
      <Icone className="size-4.5" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Estado compartilhado (sino da barra lateral, do topo no celular e a página)
// ---------------------------------------------------------------------------
interface EstadoAvisos {
  naoLidos: number
  recentes: Aviso[]
  recarregar: () => void
  marcarLidos: (ids: number[] | 'todos') => Promise<void>
}
const Ctx = createContext<EstadoAvisos>({ naoLidos: 0, recentes: [], recarregar: () => {}, marcarLidos: async () => {} })
export const useAvisosAdmin = () => useContext(Ctx)

export function ProvedorAvisosAdmin({ children }: { children: ReactNode }) {
  const api = useApi()
  const alertar = useAviso()
  const [naoLidos, setNaoLidos] = useState(0)
  const [recentes, setRecentes] = useState<Aviso[]>([])
  const vistos = useRef<Set<number> | null>(null)

  const recarregar = useCallback(async () => {
    try {
      const [n, lista] = await Promise.all([api.contarAvisosNaoLidos(), api.listarAvisos({ limite: 12 })])
      setNaoLidos(n)
      setRecentes(lista)
      // alerta na tela só para urgentes que chegaram com o painel aberto
      if (vistos.current) {
        for (const a of lista) if (!vistos.current.has(a.id) && a.gravidade === 'critico' && !a.lido) alertar('erro', a.titulo)
      }
      vistos.current = new Set(lista.map((a) => a.id))
    } catch {
      /* sem conexão: tenta de novo no próximo ciclo */
    }
  }, [api, alertar])

  useEffect(() => {
    // varredura de validade ao abrir o painel (além do pg_cron diário)
    api.verificarAvisos().catch(() => {}).finally(recarregar)
    const off = api.aoNovoAviso(recarregar)
    const t = setInterval(recarregar, 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [api, recarregar])

  const marcarLidos = useCallback(async (ids: number[] | 'todos') => {
    await api.marcarAvisosLidos(ids)
    await recarregar()
  }, [api, recarregar])

  return <Ctx.Provider value={{ naoLidos, recentes, recarregar, marcarLidos }}>{children}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Sino com painel suspenso
// ---------------------------------------------------------------------------
export function SinoAvisos({ className }: { className?: string }) {
  const { naoLidos, recentes, marcarLidos } = useAvisosAdmin()
  const [aberto, setAberto] = useState(false)
  const botao = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={botao} onClick={() => setAberto((a) => !a)} aria-label={`Avisos${naoLidos ? ` (${naoLidos} não lidos)` : ''}`}
        className={cx('relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800', className)}>
        <Bell className="size-5" />
        {naoLidos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white tabular-nums">
            {naoLidos > 99 ? '99+' : naoLidos}
          </span>
        )}
      </button>
      {aberto && <PainelAvisos ancora={botao.current!} recentes={recentes} naoLidos={naoLidos} marcarLidos={marcarLidos} aoFechar={() => setAberto(false)} />}
    </>
  )
}

function PainelAvisos({ ancora, recentes, naoLidos, marcarLidos, aoFechar }: {
  ancora: HTMLElement; recentes: Aviso[]; naoLidos: number; marcarLidos: (ids: number[] | 'todos') => Promise<void>; aoFechar: () => void
}) {
  const painel = useRef<HTMLDivElement>(null)
  const navegar = useNavigate()
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const r = ancora.getBoundingClientRect()
    const largura = Math.min(380, window.innerWidth - 16)
    // na barra lateral abre para a direita; no topo (celular) abre para baixo
    setPos(r.left < 300 && window.innerWidth >= 1024
      ? { top: Math.max(8, r.top), left: r.right + 8, width: largura }
      : { top: r.bottom + 8, left: Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8)), width: largura })
  }, [ancora])

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!painel.current?.contains(e.target as Node) && !ancora.contains(e.target as Node)) aoFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    document.addEventListener('mousedown', fora)
    window.addEventListener('keydown', esc)
    window.addEventListener('resize', aoFechar)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('resize', aoFechar)
    }
  }, [ancora, aoFechar])

  async function abrir(a: Aviso) {
    if (!a.lido) await marcarLidos([a.id]).catch(() => {})
    aoFechar()
    if (a.link) navegar(a.link)
  }

  return createPortal(
    <div ref={painel} role="dialog" aria-label="Avisos" style={pos}
      className="fixed z-[60] flex max-h-[min(560px,80vh)] animate-entrar flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <p className="font-semibold text-slate-900">Avisos {naoLidos > 0 && <span className="text-sm font-normal text-slate-500">· {naoLidos} não lidos</span>}</p>
        {naoLidos > 0 && (
          <button onClick={() => marcarLidos('todos')} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
            <CheckCheck className="size-3.5" /> Marcar todos como lidos
          </button>
        )}
      </div>
      <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
        {recentes.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Nenhum aviso em aberto. Tudo em ordem.</li>}
        {recentes.map((a) => (
          <li key={a.id}>
            <button onClick={() => abrir(a)} className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !a.lido && 'bg-emerald-50/30')}>
              <IconeAviso a={a} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className={cx('text-sm text-slate-900', !a.lido && 'font-semibold')}>{a.titulo}</span>
                  {!a.lido && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" aria-label="Não lido" />}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{a.mensagem}</span>
                <span className="mt-1 block text-[11px] text-slate-400">{tempoRelativo(a.criado_em)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Link to="/admin/avisos" onClick={aoFechar} className="border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-emerald-700 hover:bg-emerald-50">
        Ver todos e configurar envio
      </Link>
    </div>,
    document.body,
  )
}
