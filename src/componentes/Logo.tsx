// Marca pickgo: carrinho com linhas de velocidade + "pick" verde-escuro e
// "go" verde-folha, com o "o" em forma de pino de localização.
// Geometria do carrinho medida na arte de referência (proporções 188 × 122).
// Escala pelo font-size (classe text-*) do elemento.
import { cx } from './ui'

const ESCURO = '#062a1f'
const FOLHA = '#79ad48'

/** Só o símbolo (carrinho) */
export function SimboloPickgo({ className, cor = ESCURO }: { className?: string; cor?: string }) {
  return (
    <svg viewBox="6 12 186 126" className={className} aria-hidden="true">
      {/* linhas de velocidade (meio do carrinho) */}
      <path d="M17 52 H64" stroke={FOLHA} strokeWidth="16" strokeLinecap="round" />
      <path d="M48 81 H72" stroke={FOLHA} strokeWidth="18" strokeLinecap="round" />
      {/* cesto: topo e lado direito em verde-folha (a base passa por cima da ponta) */}
      <path d="M122 40 H178 L168 86" fill="none" stroke={FOLHA} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
      {/* alça "¬" descendo até a base grossa */}
      <path d="M54 24 H90 L104 90 H168" fill="none" stroke={cor} strokeWidth="19" strokeLinecap="round" strokeLinejoin="round" />
      {/* rodas */}
      <circle cx="112.5" cy="121.5" r="15" fill={cor} />
      <circle cx="165" cy="121.5" r="15" fill={cor} />
    </svg>
  )
}

/** "o" em forma de pino de localização */
function Pino({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 52" className={className} aria-hidden="true">
      <path d="M20 2C10 2 2 10 2 20c0 13 18 30 18 30s18-17 18-30C38 10 30 2 20 2z" fill={FOLHA} />
      <circle cx="20" cy="20" r="7.5" fill="#fff" />
    </svg>
  )
}

/** Logo completo. Use text-* para o tamanho, ex.: <LogoPickgo className="text-6xl" /> */
export function LogoPickgo({ className, claro = false, semSimbolo = false }: { className?: string; claro?: boolean; semSimbolo?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-[0.14em] leading-none select-none', className)} role="img" aria-label="pickgo">
      {!semSimbolo && <SimboloPickgo className="h-[1.05em] w-auto shrink-0" cor={claro ? '#ffffff' : ESCURO} />}
      <span className="inline-flex items-baseline font-logo font-bold tracking-[-0.02em]" style={{ fontVariationSettings: '"wght" 700' }}>
        <span style={{ color: claro ? '#ffffff' : ESCURO }}>pick</span>
        <span style={{ color: FOLHA }}>g</span>
        <Pino className="ml-[0.02em] h-[0.66em] w-auto translate-y-[0.12em] self-baseline" />
      </span>
    </span>
  )
}
