import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { CircleCheck, CircleX, Loader, X } from 'lucide-react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo'
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
  secundario: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs',
  fantasma: 'text-slate-600 hover:bg-slate-100',
  perigo: 'bg-rose-600 text-white hover:bg-rose-700',
}

export function Botao({
  variante = 'primario', tamanho = 'md', carregando, icone, className, children, disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamanho?: 'sm' | 'md' | 'lg'; carregando?: boolean; icone?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={disabled || carregando}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tamanho === 'sm' && 'h-8 px-3 text-sm',
        tamanho === 'md' && 'h-10 px-4 text-sm',
        tamanho === 'lg' && 'h-12 px-6 text-base',
        VARIANTES[variante],
        className,
      )}
    >
      {carregando ? <Loader className="size-4 animate-spin" /> : icone}
      {children}
    </button>
  )
}

export function Rotulo({ texto, dica, children, className }: { texto: string; dica?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{texto}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-slate-500">{dica}</span>}
    </label>
  )
}

export function Modal({ aberto, aoFechar, titulo, children, largura = 'max-w-lg', rodape }: {
  aberto: boolean; aoFechar: () => void; titulo: ReactNode; children: ReactNode; largura?: string; rodape?: ReactNode
}) {
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto, aoFechar])
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('flex max-h-[92vh] w-full animate-entrar flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', largura)}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          <button onClick={aoFechar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{rodape}</div>}
      </div>
    </div>
  )
}

type Tom = 'neutro' | 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'roxo'
const TONS: Record<Tom, string> = {
  neutro: 'bg-slate-100 text-slate-700 ring-slate-200',
  verde: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amarelo: 'bg-amber-50 text-amber-800 ring-amber-200',
  vermelho: 'bg-rose-50 text-rose-700 ring-rose-200',
  azul: 'bg-sky-50 text-sky-700 ring-sky-200',
  roxo: 'bg-violet-50 text-violet-700 ring-violet-200',
}
export function Etiqueta({ tom = 'neutro', children, icone }: { tom?: Tom; children: ReactNode; icone?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONS[tom])}>
      {icone}
      {children}
    </span>
  )
}

export function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white shadow-xs', className)}>{children}</div>
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader className="size-4 animate-spin" /> {texto}
    </div>
  )
}

export function Vazio({ icone, titulo, texto, acao }: { icone: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icone}</div>
      <p className="font-medium text-slate-700">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-sm text-slate-500">{texto}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}

export function CabecalhoPagina({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-slate-500">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Avisos (toast)
// ---------------------------------------------------------------------------
interface Aviso { id: number; tipo: 'sucesso' | 'erro'; texto: string }
const AvisoCtx = createContext<(tipo: Aviso['tipo'], texto: string) => void>(() => {})
export const useAviso = () => useContext(AvisoCtx)

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const avisar = useCallback((tipo: Aviso['tipo'], texto: string) => {
    const id = Date.now() + Math.random()
    setAvisos((a) => [...a, { id, tipo, texto }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 6000 : 3500)
  }, [])
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={cx(
            'pointer-events-auto flex max-w-sm animate-entrar items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
            a.tipo === 'sucesso' ? 'bg-marca-escura text-white' : 'bg-rose-600 text-white',
          )}>
            {a.tipo === 'sucesso' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" /> : <CircleX className="mt-0.5 size-4 shrink-0" />}
            {a.texto}
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}
