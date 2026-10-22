import type {
  ConfigPix, PixTotem, VendaOffline,
  Aviso, ConfigAvisos, FiltroAvisos,
  Avaliacao, FiltroAvaliacoes, ResumoAvaliacoes, SugestaoProduto, ClienteVenda, FaturamentoCliente, Morador, MoradorEditavel, MoradorIdentificado, NovoCadastroTotem,
  Agrupamento, Categoria, FaturamentoCategoria, FaturamentoMetodo, FiltroMovimentacoes, FiltroVendas, Fornecedor,
  ItemCatalogo, MetodoPagamento, Movimentacao, NovaMovimentacao, Pagamento, PontoSerie, Produto, ProdutoEditavel, Promocao, PromocaoEditavel,
  ResultadoCriarPagamento, ResumoDashboard, TopProduto, Usuario, Venda,
} from '../tipos'

/**
 * Tudo que as telas precisam do backend. Há duas implementações:
 *  - supabase.ts: produção (PostgREST, RPC, Edge Functions, Realtime)
 *  - demo.ts:     modo demonstração (mesmo SQL rodando no navegador via PGlite)
 */
export interface Api {
  modo: 'supabase' | 'demo'

  // autenticação
  sessaoAtual(): Promise<Usuario | null>
  entrar(email: string, senha: string): Promise<Usuario>
  sair(): Promise<void>
  aoMudarSessao(cb: (u: Usuario | null) => void): () => void

  // cadastros
  listarCategorias(): Promise<Categoria[]>
  salvarCategoria(c: Partial<Categoria> & { nome: string }): Promise<void>
  listarFornecedores(): Promise<Fornecedor[]>
  salvarFornecedor(f: Partial<Fornecedor> & { nome: string }): Promise<void>

  // produtos
  listarProdutos(): Promise<Produto[]>
  salvarProduto(p: ProdutoEditavel): Promise<string>
  enviarFoto(arquivo: File): Promise<string>

  // promoções
  listarPromocoes(): Promise<Promocao[]>
  salvarPromocao(p: PromocaoEditavel): Promise<void>
  /** liga (reativa) ou desliga (encerra) uma promoção */
  alterarPromocaoAtiva(id: number, ativa: boolean): Promise<void>

  // estoque
  listarMovimentacoes(f: FiltroMovimentacoes): Promise<Movimentacao[]>
  registrarMovimentacao(m: NovaMovimentacao): Promise<void>

  // moradores
  listarMoradores(): Promise<Morador[]>
  salvarMorador(m: MoradorEditavel): Promise<void>
  desbloquearMorador(id: string): Promise<void>
  /** admin confirma um cadastro feito no totem */
  revisarMorador(id: string): Promise<void>
  /** autocadastro no totem; devolve o morador já identificado */
  cadastrarMoradorTotem(dados: NovoCadastroTotem): Promise<MoradorIdentificado>
  /** lança erro com mensagem amigável se apartamento/PIN não conferem */
  identificarMorador(apartamento: string, pin: string): Promise<MoradorIdentificado>

  // vendas
  listarVendas(f: FiltroVendas): Promise<Venda[]>

  // PIX sem internet
  /** chave PIX que o totem guarda para gerar o QR estático (null se desligado) */
  configPixTotem(): Promise<PixTotem | null>
  obterConfigPix(): Promise<ConfigPix>
  salvarConfigPix(c: ConfigPix): Promise<void>
  /** envia uma venda feita offline (idempotente pelo txid) */
  registrarVendaOffline(v: VendaOffline): Promise<{ numero: number; repetida: boolean }>
  conferirVendaOffline(vendaId: string, recebido: boolean): Promise<void>

  // totem
  catalogo(): Promise<ItemCatalogo[]>
  criarPagamento(itens: { produto_id: string; quantidade: number }[], metodo: MetodoPagamento, cliente: ClienteVenda): Promise<ResultadoCriarPagamento>
  acompanharPagamento(id: string, cb: (p: Pagamento) => void): () => void
  cancelarPagamento(id: string, motivo: 'cancelado' | 'expirado'): Promise<void>
  simularPagamento(id: string, resultado: 'aprovado' | 'recusado'): Promise<void>
  /** destino null = usa o contato do cadastro do morador */
  enviarComprovante(vendaId: string, canal: 'email', destino: string | null): Promise<void>
  /** grava/atualiza a avaliação da compra (1 a 5 estrelas + observação opcional) */
  avaliarVenda(vendaId: string, nota: number, comentario?: string | null, sugestao?: string | null): Promise<void>

  // avaliações (painel)
  listarAvaliacoes(f: FiltroAvaliacoes): Promise<Avaliacao[]>
  marcarAvaliacoesLidas(ids: number[]): Promise<void>
  resumoAvaliacoes(inicio: string, fim: string): Promise<ResumoAvaliacoes>
  /** produtos que os clientes pediram, agrupados e ordenados por pedidos */
  sugestoesProdutos(inicio: string, fim: string, limite?: number): Promise<SugestaoProduto[]>

  // dashboard (datas aaaa-mm-dd)
  resumo(inicio: string, fim: string): Promise<ResumoDashboard>
  serie(inicio: string, fim: string, agrupamento: Agrupamento): Promise<PontoSerie[]>
  topProdutos(inicio: string, fim: string, limite?: number): Promise<TopProduto[]>
  porCategoria(inicio: string, fim: string): Promise<FaturamentoCategoria[]>
  porMetodo(inicio: string, fim: string): Promise<FaturamentoMetodo[]>
  porCliente(inicio: string, fim: string): Promise<FaturamentoCliente[]>
  aoNovaVenda(cb: () => void): () => void

  // avisos do administrador
  listarAvisos(f: FiltroAvisos): Promise<Aviso[]>
  contarAvisosNaoLidos(): Promise<number>
  marcarAvisosLidos(ids: number[] | 'todos'): Promise<void>
  /** varre estoque/validade e abre ou resolve avisos; devolve quantos surgiram */
  verificarAvisos(): Promise<number>
  obterConfigAvisos(): Promise<ConfigAvisos>
  salvarConfigAvisos(c: ConfigAvisos): Promise<void>
  /** manda uma mensagem de teste para os contatos configurados */
  testarEnvioAvisos(): Promise<void>
  aoNovoAviso(cb: () => void): () => void
}
