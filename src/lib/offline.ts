// Apoio ao modo sem internet do totem: cópia local do catálogo e da chave
// PIX, e a fila de vendas feitas offline (enviada quando a conexão volta).
import type { ItemCatalogo, PixTotem, VendaOffline } from './tipos'
import { online } from './conexao'

const CHAVES = {
  catalogo: 'mercado-offline-catalogo',
  pix: 'mercado-offline-pix',
  fila: 'mercado-offline-fila',
} as const

function ler<T>(chave: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(chave) ?? 'null')
  } catch {
    return null
  }
}
function gravar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    /* sem espaço ou navegação privada */
  }
}

export const catalogoLocal = {
  ler: () => ler<ItemCatalogo[]>(CHAVES.catalogo) ?? [],
  gravar: (c: ItemCatalogo[]) => gravar(CHAVES.catalogo, c),
}

export const pixLocal = {
  ler: () => ler<PixTotem>(CHAVES.pix),
  gravar: (p: PixTotem | null) => gravar(CHAVES.pix, p),
}

/** Vendas feitas sem internet, aguardando envio (sobrevive a recarregar a página) */
export const filaOffline = {
  ler: () => ler<VendaOffline[]>(CHAVES.fila) ?? [],
  adicionar(v: VendaOffline) {
    gravar(CHAVES.fila, [...filaOffline.ler().filter((x) => x.txid !== v.txid), v])
  },
  remover(txid: string) {
    gravar(CHAVES.fila, filaOffline.ler().filter((x) => x.txid !== txid))
  },
}

/** O erro foi falta de conexão (e não uma recusa do servidor)? */
export function ehErroDeRede(e: unknown) {
  if (!online()) return true
  const msg = String((e as Error)?.message ?? e)
  return /failed to fetch|networkerror|load failed|network request failed|sem conexão|fetch/i.test(msg)
}
