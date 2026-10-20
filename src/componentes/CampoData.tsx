// Campo de data no padrão brasileiro (dd/mm/aaaa) com calendário próprio.
// O calendário nativo do navegador segue o idioma do navegador (mm/dd/yyyy
// em inglês), por isso não é usado. O valor trafega como "aaaa-mm-dd".
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { hojeISO } from '../lib/formato'
import { cx } from './ui'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] // semana começa no domingo
const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

const pad = (n: number) => String(n).padStart(2, '0')
const paraISO = (a: number, m: number, d: number) => `${a}-${pad(m + 1)}-${pad(d)}`
const isoParaBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

/** "dd/mm/aaaa" → "aaaa-mm-dd" (ou null se inválida) */
function brParaISO(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const data = new Date(Date.UTC(a, mes - 1, d))
  if (data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== d || a < 1900) return null
  return paraISO(a, mes - 1, d)
}

/** aplica a máscara dd/mm/aaaa enquanto digita */
function mascararData(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

interface PropsData {
  valor: string // "aaaa-mm-dd" ou ""
  aoMudar: (iso: string) => void
  min?: string
  max?: string
  obrigatorio?: boolean
  ariaLabel?: string
  className?: string
}

export function CampoData({ valor, aoMudar, min, max, obrigatorio, ariaLabel, className }: PropsData) {
  const [texto, setTexto] = useState(isoParaBR(valor))
  const [aberto, setAberto] = useState(false)
  const [invalido, setInvalido] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // valor mudou por fora (ex.: preset do dashboard)
  useEffect(() => {
    setTexto(isoParaBR(valor))
    setInvalido(false)
  }, [valor])

  function digitar(v: string) {
    const t = mascararData(v)
    setTexto(t)
    if (t === '') {
      setInvalido(false)
      if (!obrigatorio) aoMudar('')
      return
    }
    if (t.length === 10) {
      const iso = brParaISO(t)
      const fora = iso && ((min && iso < min) || (max && iso > max))
      setInvalido(!iso || !!fora)
      if (iso && !fora) aoMudar(iso)
    }
  }

  function sair() {
    // texto incompleto/ inválido volta ao último valor válido
    if (texto && (texto.length < 10 || invalido)) {
      setTexto(isoParaBR(valor))
      setInvalido(false)
    }
  }

  return (
    <div ref={caixa} className={cx('relative', className)}>
      <input
        className={cx('campo pr-10 tabular-nums', invalido && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')}
        value={texto}
        onChange={(e) => digitar(e.target.value)}
        onBlur={sair}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        aria-label={ariaLabel}
        aria-invalid={invalido}
        required={obrigatorio}
      />
      <button type="button" onClick={() => setAberto((a) => !a)} aria-label="Abrir calendário"
        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <CalendarDays className="size-4" />
      </button>
      {aberto && (
        <Calendario
          ancora={caixa.current!}
          valor={valor}
          min={min}
          max={max}
          podeLimpar={!obrigatorio}
          aoEscolher={(iso) => { aoMudar(iso); setAberto(false) }}
          aoFechar={() => setAberto(false)}
        />
      )}
    </div>
  )
}

function Calendario({ ancora, valor, min, max, podeLimpar, aoEscolher, aoFechar }: {
  ancora: HTMLElement; valor: string; min?: string; max?: string; podeLimpar: boolean
  aoEscolher: (iso: string) => void; aoFechar: () => void
}) {
  const hoje = hojeISO()
  const base = valor || (max && hoje > max ? max : hoje)
  const [ano, setAno] = useState(Number(base.slice(0, 4)))
  const [mes, setMes] = useState(Number(base.slice(5, 7)) - 1)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const painel = useRef<HTMLDivElement>(null)

  // posiciona junto ao campo (fora de modais com rolagem, via portal)
  useLayoutEffect(() => {
    const r = ancora.getBoundingClientRect()
    const alt = painel.current?.offsetHeight ?? 340
    const larg = painel.current?.offsetWidth ?? 288
    const top = r.bottom + 6 + alt > window.innerHeight && r.top - 6 - alt > 0 ? r.top - 6 - alt : r.bottom + 6
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - larg - 8)) })
  }, [ancora])

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (!painel.current?.contains(e.target as Node) && !ancora.contains(e.target as Node)) aoFechar()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        aoFechar()
      }
    }
    const rolar = (e: Event) => { if (!painel.current?.contains(e.target as Node)) aoFechar() }
    document.addEventListener('mousedown', fora)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('scroll', rolar, true)
    window.addEventListener('resize', aoFechar)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('scroll', rolar, true)
      window.removeEventListener('resize', aoFechar)
    }
  }, [ancora, aoFechar])

  function navegar(delta: number) {
    const d = new Date(ano, mes + delta, 1)
    setAno(d.getFullYear())
    setMes(d.getMonth())
  }

  const primeiroDia = new Date(ano, mes, 1).getDay()
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const celulas: (number | null)[] = [...Array(primeiroDia).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)]
  const desabilitado = (iso: string) => (!!min && iso < min) || (!!max && iso > max)
  const anos = Array.from({ length: 12 }, (_, i) => Number(hoje.slice(0, 4)) - 8 + i)

  return createPortal(
    <div
      ref={painel}
      role="dialog"
      aria-label="Calendário"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed z-[70] w-72 animate-entrar rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={() => navegar(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Mês anterior">
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-800">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="rounded-md bg-transparent px-1 py-0.5 hover:bg-slate-100" aria-label="Mês">
            {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="rounded-md bg-transparent px-1 py-0.5 tabular-nums hover:bg-slate-100" aria-label="Ano">
            {(anos.includes(ano) ? anos : [...anos, ano].sort()).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => navegar(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Próximo mês">
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-400">
        {DIAS_SEMANA.map((d, i) => <span key={i} className="py-1" title={NOMES_DIAS[i]}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {celulas.map((dia, i) => {
          if (!dia) return <span key={`v${i}`} />
          const iso = paraISO(ano, mes, dia)
          const sel = iso === valor
          const ehHoje = iso === hoje
          const off = desabilitado(iso)
          return (
            <button
              key={iso}
              type="button"
              disabled={off}
              onClick={() => aoEscolher(iso)}
              aria-label={`${dia} de ${MESES[mes]} de ${ano}`}
              aria-pressed={sel}
              className={cx(
                'grid aspect-square place-items-center rounded-lg text-sm tabular-nums transition',
                off ? 'cursor-not-allowed text-slate-300'
                  : sel ? 'bg-emerald-600 font-semibold text-white'
                  : ehHoje ? 'font-semibold text-emerald-700 ring-1 ring-emerald-300 ring-inset hover:bg-slate-100'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {dia}
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm">
        <button type="button" disabled={desabilitado(hoje)} onClick={() => aoEscolher(hoje)}
          className="rounded-md px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50 disabled:text-slate-300">Hoje</button>
        {podeLimpar && <button type="button" onClick={() => aoEscolher('')} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">Limpar</button>}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Data + hora (24 h). Valor no formato "aaaa-mm-ddTHH:mm" (hora local).
// ---------------------------------------------------------------------------
function mascararHora(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

export function CampoDataHora({ valor, aoMudar, max, ariaLabel }: { valor: string; aoMudar: (v: string) => void; max?: string; ariaLabel?: string }) {
  const [data, hora] = [valor.slice(0, 10), valor.slice(11, 16)]
  const [textoHora, setTextoHora] = useState(hora)
  const [horaInvalida, setHoraInvalida] = useState(false)
  useEffect(() => setTextoHora(hora), [hora])

  function digitarHora(v: string) {
    const t = mascararHora(v)
    setTextoHora(t)
    if (t.length === 5) {
      const [h, m] = t.split(':').map(Number)
      const ok = h <= 23 && m <= 59
      setHoraInvalida(!ok)
      if (ok) aoMudar(`${data}T${t}`)
    }
  }

  return (
    <div className="flex gap-2">
      <CampoData valor={data} aoMudar={(d) => d && aoMudar(`${d}T${hora || '00:00'}`)} max={max?.slice(0, 10)} obrigatorio ariaLabel={ariaLabel} className="flex-1" />
      <div className="relative w-28">
        <Clock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          className={cx('campo pl-9 tabular-nums', horaInvalida && 'border-rose-400')}
          value={textoHora}
          onChange={(e) => digitarHora(e.target.value)}
          onBlur={() => { if (textoHora.length < 5 || horaInvalida) { setTextoHora(hora); setHoraInvalida(false) } }}
          inputMode="numeric"
          placeholder="hh:mm"
          aria-label="Hora"
        />
      </div>
    </div>
  )
}
