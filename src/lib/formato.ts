import type { MetodoPagamento, MotivoMovimentacao, StatusVenda, TipoCliente, Venda } from './tipos'
import { mascararCpf } from './cpf'

const TZ = 'America/Sao_Paulo'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (v: number | null | undefined) => moeda.format(Number(v ?? 0))
export const brlCurto = (v: number) =>
  Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(v)

export const numero = (v: number | null | undefined, casas = 0) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export const pct = (v: number) => `${numero(v * 100, 1)}%`

/** "aaaa-mm-dd" (data pura, sem fuso) → "dd/mm/aaaa" */
export function dataBR(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** timestamp → "dd/mm/aaaa hh:mm" no horário de Brasília */
export function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function horaBR(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

/** Data de hoje em São Paulo como "aaaa-mm-dd" */
export function hojeISO(desloc = 0) {
  const d = new Date(Date.now() + desloc * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

export function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasAte(iso: string | null) {
  if (!iso) return null
  return Math.round((new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${hojeISO()}T12:00:00Z`).getTime()) / 86_400_000)
}

/** "aaaa-mm-dd" → início do dia em Brasília (ISO com fuso) */
export const inicioDoDia = (iso: string) => `${iso}T00:00:00-03:00`
export const fimDoDia = (iso: string) => `${iso}T23:59:59.999-03:00`

/** Rótulos curtos para o eixo dos gráficos */
export function rotuloPeriodo(iso: string, agrup: 'dia' | 'semana' | 'mes') {
  const [a, m, d] = iso.slice(0, 10).split('-')
  if (agrup === 'mes') return `${MESES[Number(m) - 1]}/${a.slice(2)}`
  return `${d}/${m}`
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const ROTULO_METODO: Record<MetodoPagamento, string> = {
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
}

export const ROTULO_MOTIVO: Record<MotivoMovimentacao, string> = {
  reposicao: 'Reposição',
  ajuste_entrada: 'Ajuste (entrada)',
  venda: 'Venda',
  vencido: 'Vencido',
  avariado: 'Avariado',
  perda: 'Perda',
  consumo_interno: 'Consumo interno',
  ajuste_saida: 'Ajuste (saída)',
}

export const ROTULO_STATUS_VENDA: Record<StatusVenda, string> = {
  aguardando_pagamento: 'Aguardando',
  paga: 'Paga',
  recusada: 'Recusada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
}

/** Converte "12,50" ou "12.50" em número */
export function lerDecimal(v: string) {
  const limpo = v.trim().replace(/^R\$\s*/, '')
  const n = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo)
  return Number.isFinite(n) ? n : NaN
}
export const decimalParaCampo = (v: number | null | undefined) =>
  v == null ? '' : Number(v).toFixed(2).replace('.', ',')

export const ROTULO_CLIENTE: Record<TipoCliente, string> = {
  morador_cadastrado: 'Morador cadastrado',
  morador: 'Morador sem cadastro',
  visitante: 'Visitante',
}

export const rotuloCliente = (v: Pick<Venda, 'tipo_cliente' | 'moradores' | 'cpf_cliente'>) =>
  v.tipo_cliente === 'morador_cadastrado' && v.moradores ? v.moradores.nome
    : v.tipo_cliente !== 'morador_cadastrado' && v.cpf_cliente ? `${ROTULO_CLIENTE[v.tipo_cliente]} · CPF ${mascararCpf(v.cpf_cliente)}`
    : ROTULO_CLIENTE[v.tipo_cliente]

/** "11977774020" → "(11) 97777-4020" (mantém como veio se não reconhecer) */
export function telefoneBR(v: string | null | undefined) {
  if (!v) return null
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return v
}

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias" ou a data */
export function tempoRelativo(iso: string) {
  const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seg < 60) return 'agora'
  const min = Math.round(seg / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const dias = Math.round(h / 24)
  if (dias === 1) return 'ontem'
  if (dias < 7) return `há ${dias} dias`
  return dataHoraBR(iso).slice(0, 10)
}
