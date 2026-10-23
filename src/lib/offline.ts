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

const CHAVE_CORROMPIDA = 'mercado-offline-fila-corrompida'

/** grava e confere lendo de volta; lança erro se não conseguiu (sem espaço, navegação privada…) */
function gravarConferindo(chave: string, valor: unknown) {
  const texto = JSON.stringify(valor)
  try {
    localStorage.setItem(chave, texto)
  } catch (e) {
    throw new Error(`Não foi possível guardar no totem (${(e as Error)?.name ?? 'erro'})`)
  }
  if (localStorage.getItem(chave) !== texto) throw new Error('Não foi possível confirmar a gravação no totem')
}

/**
 * Vendas feitas sem internet, aguardando envio (sobrevive a recarregar a página).
 * Falhas não são silenciosas: adicionar() lança erro se a venda não ficou guardada, e uma
 * fila corrompida é copiada para uma área de recuperação (enviada ao admin quando houver
 * internet) em vez de ser apagada.
 */
export const filaOffline = {
  ler(): VendaOffline[] {
    let bruto: string | null = null
    try {
      bruto = localStorage.getItem(CHAVES.fila)
      const v = JSON.parse(bruto ?? '[]')
      if (!Array.isArray(v)) throw new Error('fila não é uma lista')
      return v
    } catch (e) {
      if (bruto) {
        console.error('Fila offline corrompida: copiada para recuperação', e)
        try {
          const antigas = ler<{ quando: string; bruto: string }[]>(CHAVE_CORROMPIDA) ?? []
          localStorage.setItem(CHAVE_CORROMPIDA, JSON.stringify([...antigas, { quando: new Date().toISOString(), bruto }]))
          localStorage.removeItem(CHAVES.fila)
        } catch { /* sem espaço: mantém a fila original como está */ }
      }
      return []
    }
  },
  adicionar(v: VendaOffline) {
    const nova = [...filaOffline.ler().filter((x) => x.txid !== v.txid), v]
    gravarConferindo(CHAVES.fila, nova)
    if (!filaOffline.ler().some((x) => x.txid === v.txid)) throw new Error('A compra não ficou guardada no totem')
  },
  remover(txid: string) {
    gravarConferindo(CHAVES.fila, filaOffline.ler().filter((x) => x.txid !== txid))
  },
  /** cópias de filas corrompidas aguardando envio ao administrador */
  corrompidas: () => ler<{ quando: string; bruto: string }[]>(CHAVE_CORROMPIDA) ?? [],
  removerCorrompida(quando: string) {
    gravarConferindo(CHAVE_CORROMPIDA, filaOffline.corrompidas().filter((c) => c.quando !== quando))
  },
}

// ---- compra em andamento (retomar depois de recarregar o totem) -------------
const CHAVE_COMPRA = 'pickgo-compra-pendente'

/** guarda a compra que está aguardando pagamento; sem CPF (privacidade no totem compartilhado) */
export const compraPendente = {
  ler<T>(): T | null {
    return ler<T>(CHAVE_COMPRA)
  },
  gravar(v: unknown) {
    gravar(CHAVE_COMPRA, v)
  },
  limpar() {
    try { localStorage.removeItem(CHAVE_COMPRA) } catch { /* ignora */ }
  },
}

/** O erro foi falta de conexão (e não uma recusa do servidor)? */
export function ehErroDeRede(e: unknown) {
  if (!online()) return true
  const msg = String((e as Error)?.message ?? e)
  return /failed to fetch|networkerror|load failed|network request failed|sem conexão|fetch/i.test(msg)
}
