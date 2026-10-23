export type Perfil = 'admin' | 'totem'

export interface Usuario {
  id: string
  nome: string
  email: string | null
  perfil: Perfil
}

export interface Categoria {
  id: number
  nome: string
  icone: string
  cor: string
  ordem: number
  ativo: boolean
}

export interface Fornecedor {
  id: number
  nome: string
  cnpj: string | null
  telefone: string | null
  email: string | null
  contato: string | null
  ativo: boolean
}

export interface Produto {
  id: string
  nome: string
  foto_url: string | null
  categoria_id: number | null
  codigo_barras: string | null
  preco_custo: number
  preco_venda: number
  estoque_atual: number
  estoque_minimo: number
  validade: string | null // aaaa-mm-dd
  ativo: boolean
  criado_em: string
  atualizado_em: string
  // calculados na view produtos_alertas
  estoque_baixo: boolean
  perto_validade: boolean
  vencido: boolean
}

export type ProdutoEditavel = Pick<
  Produto,
  'nome' | 'foto_url' | 'categoria_id' | 'codigo_barras' | 'preco_custo' | 'preco_venda' | 'estoque_minimo' | 'validade' | 'ativo'
> & { id?: string }

export type TipoMovimentacao = 'entrada' | 'saida'
export type MotivoMovimentacao =
  | 'reposicao'
  | 'ajuste_entrada'
  | 'venda'
  | 'vencido'
  | 'avariado'
  | 'perda'
  | 'consumo_interno'
  | 'ajuste_saida'

export interface Movimentacao {
  id: number
  produto_id: string
  tipo: TipoMovimentacao
  motivo: MotivoMovimentacao
  quantidade: number
  custo_unitario: number | null
  fornecedor_id: number | null
  venda_id: string | null
  observacao: string | null
  data_movimentacao: string
  usuario_id: string | null
  saldo_anterior: number
  saldo_posterior: number
  produto_nome: string
  codigo_barras: string | null
  categoria_id: number | null
  categoria_nome: string | null
  fornecedor_nome: string | null
  usuario_nome: string | null
  venda_numero: number | null
}

export interface NovaMovimentacao {
  produto_id: string
  tipo: TipoMovimentacao
  motivo: Exclude<MotivoMovimentacao, 'venda'>
  quantidade: number
  custo_unitario?: number | null
  fornecedor_id?: number | null
  data_movimentacao?: string
  observacao?: string | null
}

export interface FiltroMovimentacoes {
  inicio?: string // aaaa-mm-dd
  fim?: string
  produto_id?: string
  categoria_id?: number
  motivo?: MotivoMovimentacao | 'entrada' | 'saida'
  limite?: number
}

export type MetodoPagamento = 'pix' | 'cartao_credito' | 'cartao_debito'
export type StatusVenda = 'aguardando_pagamento' | 'paga' | 'recusada' | 'expirada' | 'cancelada' | 'estornada'
export type StatusPagamento = 'pendente' | 'aprovado' | 'recusado' | 'expirado' | 'cancelado' | 'estornado' | 'contestado'

export interface ItemVenda {
  produto_id: string
  nome_produto: string
  quantidade: number
  preco_unitario: number
  custo_unitario: number
  subtotal: number
}

export type TipoCliente = 'visitante' | 'morador' | 'morador_cadastrado'

export interface Morador {
  id: string
  nome: string
  apartamento: string
  bloco: string | null
  telefone: string | null
  email: string | null
  ativo: boolean
  tentativas_falhas: number
  bloqueado_ate: string | null
  criado_em: string
  tem_pin: boolean
  bloqueado: boolean
  compras: number
  origem: 'admin' | 'totem'
  revisado: boolean
  aceite_em: string | null
  cpf: string | null
}

/** Autocadastro feito pelo próprio morador no totem */
export interface NovoCadastroTotem {
  nome: string
  cpf: string
  apartamento: string
  bloco: string | null
  telefone: string | null
  email: string | null
  pin: string
  aceite: boolean
}

export type MoradorEditavel = Pick<Morador, 'nome' | 'apartamento' | 'bloco' | 'telefone' | 'email' | 'ativo' | 'cpf'> & {
  id?: string
  /** null/vazio na edição = mantém o PIN atual */
  pin?: string | null
}

/** O que o totem recebe ao identificar o morador (contatos mascarados) */
export interface MoradorIdentificado {
  id: string
  nome: string
  apartamento: string
  bloco: string | null
  telefone_mascarado: string | null
  email_mascarado: string | null
}

export interface ClienteVenda {
  tipo: TipoCliente
  morador_id?: string | null
  apartamento?: string | null
  /** obrigatório para visitante */
  cpf?: string | null
}

export interface Venda {
  id: string
  numero: number
  status: StatusVenda
  metodo: MetodoPagamento
  tipo_cliente: TipoCliente
  morador_id: string | null
  moradores: { nome: string } | null
  cpf_cliente: string | null
  offline: boolean
  txid: string | null
  conferencia: 'pendente' | 'recebido' | 'nao_recebido' | null
  apartamento: string | null
  total: number
  custo_total: number
  criado_em: string
  pago_em: string | null
  itens_venda: ItemVenda[]
}

export interface FiltroVendas {
  inicio?: string
  fim?: string
  status?: StatusVenda
  apenasOffline?: boolean
  conferencia?: 'pendente' | 'recebido' | 'nao_recebido'
  limite?: number
}

export interface ItemCatalogo {
  id: string
  nome: string
  foto_url: string | null
  codigo_barras: string | null
  preco_venda: number
  estoque_atual: number
  categoria_id: number | null
  categoria: string | null
  categoria_icone: string | null
  categoria_cor: string | null
  categoria_ordem: number | null
  /** preço sem promoção (igual a preco_venda quando não há promoção) */
  preco_original: number
  /** título da promoção vigente, ou null */
  promocao: string | null
}

export type TipoPromocao = 'percentual' | 'preco_fixo'
export type SituacaoPromocao = 'ativa' | 'agendada' | 'encerrada'

export interface Promocao {
  id: number
  produto_id: string
  produto_nome: string
  titulo: string | null
  tipo: TipoPromocao
  /** % de desconto ou preço promocional, conforme o tipo */
  valor: number
  /** aaaa-mm-dd */
  inicio: string
  fim: string | null
  ativa: boolean
  preco_normal: number
  preco_promocional: number
  situacao: SituacaoPromocao
}

export type PromocaoEditavel = Pick<Promocao, 'produto_id' | 'titulo' | 'tipo' | 'valor' | 'inicio' | 'fim'> & { id?: number }

export interface Pagamento {
  id: string
  status: StatusPagamento
  provedor: 'mercadopago' | 'simulado'
  metodo: MetodoPagamento
  valor: number
  qr_code: string | null
  qr_code_base64: string | null
  checkout_url: string | null
  expira_em: string
  motivo_recusa?: string | null
  modo?: 'pix' | 'maquininha' | 'checkout'
}

export interface ResultadoCriarPagamento {
  venda: { id: string; numero: number; total: number }
  pagamento: Pagamento
}

export interface ResumoDashboard {
  faturamento_hoje: number
  faturamento_mes: number
  faturamento: number
  custo: number
  lucro_bruto: number
  num_vendas: number
  ticket_medio: number
  itens_vendidos: number
}

export type Agrupamento = 'dia' | 'semana' | 'mes'
export interface PontoSerie { periodo: string; faturamento: number; lucro: number; vendas: number }
export interface TopProduto { produto_id: string; nome: string; quantidade: number; faturamento: number; lucro: number }
export interface FaturamentoCategoria { categoria: string; cor: string; quantidade: number; faturamento: number; lucro: number }
export interface FaturamentoMetodo { metodo: MetodoPagamento; vendas: number; faturamento: number }
export interface FaturamentoCliente { tipo_cliente: TipoCliente; vendas: number; faturamento: number }

export interface Avaliacao {
  id: number
  venda_id: string
  nota: number
  comentario: string | null
  sugestao: string | null
  tipo_cliente: TipoCliente
  morador_id: string | null
  lida: boolean
  criado_em: string
  venda_numero: number
  venda_total: number
  morador_nome: string | null
}

export interface FiltroAvaliacoes {
  inicio?: string
  fim?: string
  nota?: number
  comComentario?: boolean
  comSugestao?: boolean
  limite?: number
}

export interface ResumoAvaliacoes {
  media: number
  total: number
  comentarios: number
  sugestoes: number
  nao_lidas: number
  distribuicao: { nota: number; quantidade: number }[]
}

export interface SugestaoProduto { sugestao: string; pedidos: number; ultima: string }

export type TipoAviso = 'estoque_baixo' | 'estoque_zerado' | 'validade_proxima' | 'produto_vencido' | 'avaliacao_baixa' | 'sugestao_produto'
  | 'venda_offline' | 'estorno' | 'venda_offline_rejeitada' | 'preco_divergente'
export type GravidadeAviso = 'info' | 'atencao' | 'critico'

export interface Aviso {
  id: number
  tipo: TipoAviso
  gravidade: GravidadeAviso
  titulo: string
  mensagem: string
  link: string | null
  referencia_id: string
  lido: boolean
  resolvido: boolean
  resolvido_em: string | null
  enviado_em: string | null
  criado_em: string
}

export interface FiltroAvisos {
  apenasNaoLidos?: boolean
  grupo?: 'estoque' | 'avaliacoes'
  incluirResolvidos?: boolean
  limite?: number
}

export interface ConfigAvisos {
  email: string | null
  enviar_imediato: boolean
  niveis_imediato: GravidadeAviso[]
  resumo_diario: boolean
}

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'celular' | 'aleatoria'

export interface ConfigPix {
  tipo_chave: TipoChavePix | null
  chave: string | null
  nome_recebedor: string | null
  cidade: string | null
  offline_ativo: boolean
}

/** O que o totem guarda para gerar o PIX sem internet */
export interface PixTotem { chave: string; nome: string; cidade: string }

/** Venda feita sem internet, guardada no totem até ser enviada */
export interface VendaOffline {
  txid: string
  tipo_cliente: TipoCliente
  /** morador identificado (apartamento + PIN) antes da queda da internet */
  morador_id?: string | null
  apartamento: string | null
  cpf: string | null
  criado_em: string
  total: number
  itens: { produto_id: string; nome: string; quantidade: number; preco_unitario: number }[]
}
