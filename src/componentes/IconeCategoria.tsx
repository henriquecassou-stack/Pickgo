import {
  Apple, Baby, Bath, Beef, Beer, Candy, Coffee, Cookie, Croissant, CupSoda, Dog, IceCreamCone, Milk, Package, Pill,
  Sandwich, Snowflake, SprayCan, Wheat, Wine, type LucideIcon,
} from 'lucide-react'

export const ICONES: Record<string, LucideIcon> = {
  'cup-soda': CupSoda, cookie: Cookie, wheat: Wheat, milk: Milk, snowflake: Snowflake, 'spray-can': SprayCan, bath: Bath,
  package: Package, apple: Apple, beef: Beef, baby: Baby, dog: Dog, pill: Pill, candy: Candy, coffee: Coffee, wine: Wine,
  beer: Beer, sandwich: Sandwich, 'ice-cream': IceCreamCone, croissant: Croissant,
}

export function IconeCategoria({ icone, cor, tamanho = 'md' }: { icone?: string | null; cor?: string | null; tamanho?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const Icone = ICONES[icone ?? ''] ?? Package
  const caixa = { sm: 'size-7 rounded-md', md: 'size-9 rounded-lg', lg: 'size-12 rounded-xl', xl: 'size-full rounded-2xl' }[tamanho]
  const svg = { sm: 'size-4', md: 'size-5', lg: 'size-6', xl: 'size-1/3' }[tamanho]
  const c = cor ?? '#64748b'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${caixa}`} style={{ backgroundColor: `${c}1a`, color: c }}>
      <Icone className={svg} strokeWidth={1.75} />
    </span>
  )
}

/** Foto do produto ou, na falta dela, o ícone da categoria */
export function FotoProduto({ url, nome, icone, cor, className = 'size-10' }: { url?: string | null; nome: string; icone?: string | null; cor?: string | null; className?: string }) {
  if (url) return <img src={url} alt={nome} loading="lazy" className={`${className} shrink-0 rounded-lg bg-white object-cover`} />
  return (
    <span className={`${className} inline-flex shrink-0`}>
      <IconeCategoria icone={icone} cor={cor} tamanho="xl" />
    </span>
  )
}
