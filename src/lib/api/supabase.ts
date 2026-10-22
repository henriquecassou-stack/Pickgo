import { createClient, FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js'
import type { Api } from './contrato'
import type { Movimentacao, Pagamento, Usuario } from '../tipos'
import { fimDoDia, inicioDoDia } from '../formato'
import { resultadoIdentificacao } from './moradores'
import { ehErroDeRede } from '../offline'

export function criarApiSupabase(url: string, chaveAnon: string): Api {
  const sb = createClient(url, chaveAnon, { auth: { persistSession: true, autoRefreshToken: true } })

  // cada assinatura ganha um canal próprio: o Supabase devolve o canal já aberto
  // quando o nome se repete (ex.: sino + página de Avisos) e aí .on() dá erro
  let seqCanal = 0
  const canal = (nome: string) => sb.channel(`${nome}-${++seqCanal}`)

  const ok = <T>(r: { data: T | null; error: PostgrestError | null }): T => {
    if (r.error) throw new Error(traduzirErro(r.error.message))
    return r.data as T
  }

  async function funcao<T>(nome: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.functions.invoke(nome, { body })
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const corpo = await error.context.json().catch(() => null)
        throw new Error(corpo?.erro ?? 'Falha na comunicação com o servidor')
      }
      throw new Error('Sem conexão com o servidor')
    }
    return data as T
  }

  async function perfil(id: string): Promise<Usuario | null> {
    const chave = `mercado-perfil-${id}`
    const { data, error } = await sb.from('usuarios').select('id, nome, email, perfil, ativo').eq('id', id).maybeSingle()
    if (error && ehErroDeRede(error)) {
      // sem internet: usa o último perfil conhecido (o totem continua funcionando)
      try { return JSON.parse(localStorage.getItem(chave) ?? 'null') } catch { return null }
    }
    const u = data?.ativo ? { id: data.id, nome: data.nome, email: data.email, perfil: data.perfil as Usuario['perfil'] } : null
    try { localStorage.setItem(chave, JSON.stringify(u)) } catch { /* ignora */ }
    return u
  }

  return {
    modo: 'supabase',

    async sessaoAtual() {
      const { data } = await sb.auth.getSession()
      return data.session ? perfil(data.session.user.id) : null
    },
    async entrar(email, senha) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error(error.message.includes('Invalid login') ? 'E-mail ou senha incorretos' : error.message)
      const u = await perfil(data.user.id)
      if (!u) {
        await sb.auth.signOut()
        throw new Error('Usuário sem perfil ativo. Fale com o administrador.')
      }
      return u
    },
    async sair() {
      await sb.auth.signOut()
    },
    aoMudarSessao(cb) {
      const { data } = sb.auth.onAuthStateChange((evento, sessao) => {
        if (evento === 'SIGNED_OUT') cb(null)
        else if (evento === 'SIGNED_IN' && sessao) setTimeout(() => perfil(sessao.user.id).then(cb), 0)
      })
      return () => data.subscription.unsubscribe()
    },

    async listarCategorias() {
      return ok(await sb.from('categorias').select('*').order('ordem').order('nome'))
    },
    async salvarCategoria({ id, ...c }) {
      ok(id ? await sb.from('categorias').update(c).eq('id', id) : await sb.from('categorias').insert(c))
    },
    async listarPromocoes() {
      return ok(await sb.from('promocoes_detalhadas').select('*').order('criado_em', { ascending: false }))
    },
    async salvarPromocao({ id, ...p }) {
      const dados = { ...p, titulo: p.titulo?.trim() || null, fim: p.fim || null, atualizado_em: new Date().toISOString() }
      ok(id ? await sb.from('promocoes').update(dados).eq('id', id) : await sb.from('promocoes').insert(dados))
    },
    async alterarPromocaoAtiva(id, ativa) {
      ok(await sb.from('promocoes').update({ ativa, atualizado_em: new Date().toISOString() }).eq('id', id))
    },
    async listarFornecedores() {
      return ok(await sb.from('fornecedores').select('*').order('nome'))
    },
    async salvarFornecedor({ id, ...f }) {
      ok(id ? await sb.from('fornecedores').update(f).eq('id', id) : await sb.from('fornecedores').insert(f))
    },

    async listarProdutos() {
      return ok(await sb.from('produtos_alertas').select('*').order('nome'))
    },
    async salvarProduto(entrada) {
      // só os campos editáveis (estoque_atual nunca é enviado)
      const { id, nome, foto_url, categoria_id, codigo_barras, preco_custo, preco_venda, estoque_minimo, validade, ativo } = entrada
      const p = { nome, foto_url, categoria_id, codigo_barras: codigo_barras || null, preco_custo, preco_venda, estoque_minimo, validade: validade || null, ativo }
      if (id) {
        ok(await sb.from('produtos').update(p).eq('id', id))
        return id
      }
      return (ok(await sb.from("produtos").insert(p).select("id").single()) as { id: string }).id
    },
    async enviarFoto(arquivo) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() || 'jpg'
      const caminho = `${crypto.randomUUID()}.${ext}`
      const { error } = await sb.storage.from('produtos').upload(caminho, arquivo, { cacheControl: '31536000', contentType: arquivo.type })
      if (error) throw new Error(`Falha ao enviar a foto: ${error.message}`)
      return sb.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
    },

    async listarMovimentacoes(f) {
      let q = sb.from('movimentacoes_detalhadas').select('*')
      if (f.inicio) q = q.gte('data_movimentacao', inicioDoDia(f.inicio))
      if (f.fim) q = q.lte('data_movimentacao', fimDoDia(f.fim))
      if (f.produto_id) q = q.eq('produto_id', f.produto_id)
      if (f.categoria_id) q = q.eq('categoria_id', f.categoria_id)
      if (f.motivo === 'entrada' || f.motivo === 'saida') q = q.eq('tipo', f.motivo)
      else if (f.motivo) q = q.eq('motivo', f.motivo)
      return ok(await q.order('data_movimentacao', { ascending: false }).order('id', { ascending: false }).limit(f.limite ?? 500)) as Movimentacao[]
    },
    async registrarMovimentacao(m) {
      const { data } = await sb.auth.getUser()
      ok(await sb.from('movimentacoes_estoque').insert({ ...m, usuario_id: data.user?.id }))
    },

    async listarMoradores() {
      return ok(await sb.from('moradores_admin').select('*').order('apartamento').order('nome'))
    },
    async salvarMorador(m) {
      ok(await sb.rpc('salvar_morador', {
        p_id: m.id ?? null, p_nome: m.nome, p_apartamento: m.apartamento, p_bloco: m.bloco, p_telefone: m.telefone,
        p_email: m.email, p_ativo: m.ativo, p_pin: m.pin || null, p_cpf: m.cpf,
      }))
    },
    async desbloquearMorador(id) {
      ok(await sb.rpc('desbloquear_morador', { p_id: id }))
    },
    async revisarMorador(id) {
      ok(await sb.rpc('revisar_morador', { p_id: id }))
    },
    async cadastrarMoradorTotem(d) {
      return resultadoIdentificacao(ok(await sb.rpc('cadastrar_morador_totem', {
        p_nome: d.nome, p_apartamento: d.apartamento, p_bloco: d.bloco, p_telefone: d.telefone, p_email: d.email, p_pin: d.pin, p_aceite: d.aceite, p_cpf: d.cpf,
      })))
    },
    async identificarMorador(apartamento, pin) {
      return resultadoIdentificacao(ok(await sb.rpc('identificar_morador', { p_apartamento: apartamento, p_pin: pin })))
    },

    async listarVendas(f) {
      let q = sb.from('vendas').select('*, moradores(nome), itens_venda(produto_id, nome_produto, quantidade, preco_unitario, custo_unitario, subtotal)')
      if (f.inicio) q = q.gte('criado_em', inicioDoDia(f.inicio))
      if (f.fim) q = q.lte('criado_em', fimDoDia(f.fim))
      if (f.status) q = q.eq('status', f.status)
      if (f.apenasOffline) q = q.eq('offline', true)
      if (f.conferencia) q = q.eq('conferencia', f.conferencia)
      return ok(await q.order('criado_em', { ascending: false }).limit(f.limite ?? 300))
    },

    async configPixTotem() {
      return ok(await sb.rpc('config_pix_totem'))
    },
    async obterConfigPix() {
      return ok(await sb.from('config_pix').select('tipo_chave, chave, nome_recebedor, cidade, offline_ativo').eq('id', 1).single())
    },
    async salvarConfigPix(c) {
      ok(await sb.from('config_pix').update({ ...c, atualizado_em: new Date().toISOString() }).eq('id', 1))
    },
    async registrarVendaOffline(v) {
      return ok(await sb.rpc('registrar_venda_offline', { p: v }))
    },
    async conferirVendaOffline(vendaId, recebido) {
      ok(await sb.rpc('conferir_venda_offline', { p_venda_id: vendaId, p_recebido: recebido }))
    },

    async catalogo() {
      return ok(await sb.from('catalogo_totem').select('*').order('categoria_ordem').order('nome'))
    },
    criarPagamento(itens, metodo, cliente) {
      return funcao('criar-pagamento', { itens, metodo, cliente: cliente.tipo, morador_id: cliente.morador_id ?? null, apartamento: cliente.apartamento ?? null, cpf: cliente.cpf ?? null })
    },
    acompanharPagamento(id, cb) {
      let ultimo = ''
      const emitir = (p: Pagamento) => {
        if (p.status !== ultimo) {
          ultimo = p.status
          cb(p)
        }
      }
      const assinatura = canal(`pagamento-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos', filter: `id=eq.${id}` }, (ev) => emitir(ev.new as Pagamento))
        .subscribe()
      // rede de segurança caso o realtime caia: consulta a cada 4 s
      const timer = setInterval(async () => {
        const { data } = await sb.from('pagamentos').select('*').eq('id', id).maybeSingle()
        if (data) emitir(data as Pagamento)
      }, 4000)
      return () => {
        clearInterval(timer)
        sb.removeChannel(assinatura)
      }
    },
    async cancelarPagamento(id, motivo) {
      await funcao('cancelar-pagamento', { pagamento_id: id, motivo })
    },
    async simularPagamento(id, resultado) {
      await funcao('simular-pagamento', { pagamento_id: id, resultado })
    },
    async enviarComprovante(vendaId, canal, destino) {
      await funcao('enviar-comprovante', { venda_id: vendaId, canal, destino })
    },

    async avaliarVenda(vendaId, nota, comentario, sugestao) {
      const r = ok(await sb.rpc('avaliar_venda', { p_venda_id: vendaId, p_nota: nota, p_comentario: comentario ?? null, p_sugestao: sugestao ?? null })) as { erro?: string }
      if (r?.erro) throw new Error(r.erro)
    },
    async listarAvaliacoes(f) {
      let q = sb.from('avaliacoes_detalhadas').select('*')
      if (f.inicio) q = q.gte('criado_em', inicioDoDia(f.inicio))
      if (f.fim) q = q.lte('criado_em', fimDoDia(f.fim))
      if (f.nota) q = q.eq('nota', f.nota)
      if (f.comComentario) q = q.not('comentario', 'is', null)
      if (f.comSugestao) q = q.not('sugestao', 'is', null)
      return ok(await q.order('criado_em', { ascending: false }).limit(f.limite ?? 500))
    },
    async marcarAvaliacoesLidas(ids) {
      if (ids.length) ok(await sb.from('avaliacoes').update({ lida: true }).in('id', ids))
    },
    async sugestoesProdutos(inicio, fim, limite = 10) {
      return ok(await sb.rpc('sugestoes_produtos', { p_inicio: inicio, p_fim: fim, p_limite: limite }))
    },
    async resumoAvaliacoes(inicio, fim) {
      return ok(await sb.rpc('dashboard_avaliacoes', { p_inicio: inicio, p_fim: fim }))
    },

    async resumo(inicio, fim) {
      return ok(await sb.rpc('dashboard_resumo', { p_inicio: inicio, p_fim: fim }))
    },
    async serie(inicio, fim, agrupamento) {
      return ok(await sb.rpc('dashboard_serie', { p_inicio: inicio, p_fim: fim, p_agrupamento: agrupamento }))
    },
    async topProdutos(inicio, fim, limite = 10) {
      return ok(await sb.rpc('dashboard_top_produtos', { p_inicio: inicio, p_fim: fim, p_limite: limite }))
    },
    async porCategoria(inicio, fim) {
      return ok(await sb.rpc('dashboard_categorias', { p_inicio: inicio, p_fim: fim }))
    },
    async porMetodo(inicio, fim) {
      return ok(await sb.rpc('dashboard_metodos', { p_inicio: inicio, p_fim: fim }))
    },
    async porCliente(inicio, fim) {
      return ok(await sb.rpc('dashboard_clientes', { p_inicio: inicio, p_fim: fim }))
    },
    async listarAvisos(f) {
      let q = sb.from('avisos').select('*')
      if (f.apenasNaoLidos) q = q.eq('lido', false)
      if (!f.incluirResolvidos) q = q.eq('resolvido', false)
      if (f.grupo) q = q.in('tipo', GRUPOS_AVISO[f.grupo])
      return ok(await q.order('criado_em', { ascending: false }).limit(f.limite ?? 200))
    },
    async contarAvisosNaoLidos() {
      const { count, error } = await sb.from('avisos').select('id', { count: 'exact', head: true }).eq('lido', false).eq('resolvido', false)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    async marcarAvisosLidos(ids) {
      const q = sb.from('avisos').update({ lido: true })
      ok(ids === 'todos' ? await q.eq('lido', false) : await q.in('id', ids))
    },
    async verificarAvisos() {
      return ok(await sb.rpc('verificar_avisos')) as number
    },
    async obterConfigAvisos() {
      return ok(await sb.from('config_avisos').select('email, enviar_imediato, niveis_imediato, resumo_diario').eq('id', 1).single())
    },
    async salvarConfigAvisos(c) {
      ok(await sb.from('config_avisos').update({ ...c, atualizado_em: new Date().toISOString() }).eq('id', 1))
    },
    async testarEnvioAvisos() {
      await funcao('enviar-avisos', { modo: 'teste' })
    },
    aoNovoAviso(cb) {
      const assinatura = canal('avisos-painel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'avisos' }, () => cb())
        .subscribe()
      return () => {
        sb.removeChannel(assinatura)
      }
    },
    aoNovaVenda(cb) {
      const assinatura = canal('vendas-painel')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vendas', filter: 'status=eq.paga' }, () => cb())
        .subscribe()
      return () => {
        sb.removeChannel(assinatura)
      }
    },
  }
}

const GRUPOS_AVISO = { estoque: ['estoque_baixo', 'estoque_zerado', 'validade_proxima', 'produto_vencido'], avaliacoes: ['avaliacao_baixa', 'sugestao_produto'] }

/** Mensagens do banco em português amigável */
export function traduzirErro(msg: string) {
  if (msg.includes('duplicate key') && msg.includes('codigo_barras')) return 'Já existe um produto com este código de barras.'
  if (msg.includes('duplicate key') && msg.includes('categorias')) return 'Já existe uma categoria com este nome.'
  if (msg.includes('promocao_percentual')) return 'O desconto deve ser menor que 100%.'
  if (msg.includes('promocao_periodo')) return 'A data de fim não pode ser antes do início.'
  if (msg.includes('row-level security') || msg.includes('permission denied')) return 'Você não tem permissão para esta ação.'
  return msg
}
