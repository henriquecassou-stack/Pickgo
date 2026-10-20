import { CalendarClock, TriangleAlert } from 'lucide-react'
import type { Produto } from '../lib/tipos'
import { dataBR, diasAte } from '../lib/formato'
import { Etiqueta, cx } from './ui'

export function SaldoEstoque({ p }: { p: Pick<Produto, 'estoque_atual' | 'estoque_minimo' | 'estoque_baixo'> }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cx('font-semibold tabular-nums', p.estoque_atual <= 0 ? 'text-rose-600' : p.estoque_baixo ? 'text-amber-600' : 'text-slate-800')}>
        {p.estoque_atual}
      </span>
      <span className="text-xs text-slate-400">/ mín {p.estoque_minimo}</span>
      {p.estoque_baixo && <TriangleAlert className={cx('size-4', p.estoque_atual <= 0 ? 'text-rose-500' : 'text-amber-500')} aria-label="Estoque baixo" />}
    </span>
  )
}

export function Validade({ p }: { p: Pick<Produto, 'validade' | 'perto_validade' | 'vencido'> }) {
  if (!p.validade) return <span className="text-slate-400">—</span>
  const dias = diasAte(p.validade)!
  if (p.vencido) return <Etiqueta tom="vermelho" icone={<CalendarClock className="size-3" />}>Vencido · {dataBR(p.validade)}</Etiqueta>
  if (p.perto_validade) {
    return <Etiqueta tom="amarelo" icone={<CalendarClock className="size-3" />}>{dias === 0 ? 'Vence hoje' : `${dias} dia${dias > 1 ? 's' : ''}`} · {dataBR(p.validade)}</Etiqueta>
  }
  return <span className="tabular-nums text-slate-600">{dataBR(p.validade)}</span>
}
