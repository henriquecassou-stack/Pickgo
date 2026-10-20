// Gera o "PIX copia e cola" estático (BR Code / EMV-MPM do Banco Central)
// localmente, sem internet. Com valor e identificador (txid), serve para o
// modo sem internet do totem; sem valor, para o cartaz impresso.
import type { TipoChavePix } from './tipos'

export interface DadosPix {
  chave: string
  nome: string // nome do recebedor (até 25 caracteres)
  cidade: string // cidade do recebedor (até 15 caracteres)
  valor?: number
  txid?: string // até 25 letras/números; '***' = sem identificador
  descricao?: string
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`

/** remove acentos e caracteres fora do padrão, em maiúsculas */
function normalizar(texto: string, max: number) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().toUpperCase().slice(0, max)
}

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), exigido pelo BR Code */
export function crc16(texto: string) {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Normaliza a chave conforme o tipo: celular vira +55DDDNÚMERO; CPF/CNPJ só números */
export function normalizarChave(chave: string, tipo: TipoChavePix) {
  const c = chave.trim()
  const digitos = c.replace(/\D/g, '')
  switch (tipo) {
    case 'email': return c.toLowerCase()
    case 'aleatoria': return c.toLowerCase()
    case 'celular': return `+${digitos.startsWith('55') && digitos.length > 11 ? digitos : `55${digitos}`}`
    default: return digitos
  }
}

export function chavePixValida(chave: string, tipo: TipoChavePix) {
  const c = normalizarChave(chave, tipo)
  switch (tipo) {
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)
    case 'celular': return /^\+55\d{10,11}$/.test(c)
    case 'cpf': return /^\d{11}$/.test(c)
    case 'cnpj': return /^\d{14}$/.test(c)
    case 'aleatoria': return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c)
  }
}

/** chave já normalizada (como fica salva no banco) */
export function gerarPixEstatico(d: DadosPix) {
  const contaPix = campo('00', 'BR.GOV.BCB.PIX') + campo('01', d.chave.trim())
    + (d.descricao ? campo('02', normalizar(d.descricao, 40)) : '')
  const txid = (d.txid ?? '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***'
  const semCrc = campo('00', '01')
    + campo('26', contaPix)
    + campo('52', '0000')
    + campo('53', '986')
    + (d.valor && d.valor > 0 ? campo('54', d.valor.toFixed(2)) : '')
    + campo('58', 'BR')
    + campo('59', normalizar(d.nome, 25) || 'RECEBEDOR')
    + campo('60', normalizar(d.cidade, 15) || 'BRASIL')
    + campo('62', campo('05', txid))
    + '6304'
  return semCrc + crc16(semCrc)
}

/** Identificador único da venda offline (vai no PIX e aparece no extrato) */
export function novoTxidOffline() {
  const tempo = Date.now().toString(36).toUpperCase()
  const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join('').toUpperCase()
  return `MAOFF${tempo}${aleatorio}`.slice(0, 25)
}
