import type { MoradorIdentificado } from '../tipos'

/** Converte o retorno de identificar_morador() em dado ou erro amigável */
export function resultadoIdentificacao(r: { erro?: string; minutos?: number; mensagem?: string } | MoradorIdentificado | null): MoradorIdentificado {
  if (r && 'erro' in r && r.erro === 'bloqueado') {
    throw new Error(`Muitas tentativas erradas. Tente de novo em ${r.minutos} min ou fale com a administração.`)
  }
  if (r && 'erro' in r && r.erro === 'dados') throw new Error(r.mensagem ?? 'Confira os dados.')
  if (r && 'erro' in r && r.erro === 'pin_indisponivel') throw new Error('Este PIN não pode ser usado. Escolha outro.')
  if (r && 'erro' in r && r.erro === 'limite') throw new Error('Muitos cadastros para este apartamento agora. Procure a administração.')
  if (!r || 'erro' in r) throw new Error('Apartamento ou PIN incorreto.')
  return r as MoradorIdentificado
}
