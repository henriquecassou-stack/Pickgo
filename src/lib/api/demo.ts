// Modo demonstração: roda a MESMA migração e o MESMO seed do Supabase dentro
// do navegador (PGlite = PostgreSQL em WebAssembly, salvo no IndexedDB).
// Triggers de estoque, funções de pagamento e relatórios são os reais.
// O pagamento é sempre "simulado" (botões aprovar/recusar no totem).
import { PGlite, types } from '@electric-sql/pglite'
import type { Api } from './contrato'
import type { ConfigAvisos, ConfigPix, Pagamento, Usuario } from '../tipos'
import { fimDoDia, inicioDoDia } from '../formato'
import { resultadoIdentificacao } from './moradores'
import { online } from '../conexao'
import { cpfValido, somenteDigitos } from '../cpf'
import stubs from '../demo/supabase-stubs.sql?raw'
import seed from '../../../supabase/seed.sql?raw'

const migracoes = Object.entries(
  import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
).sort(([a], [b]) => a.localeCompare(b)).map(([, sql]) => sql)

const VERSAO = `v1-${migracoes.join('').length}-${seed.length}`
const USUARIOS_DEMO: Record<string, Usuario> = {
  'admin@demo.com': { id: '00000000-0000-4000-8000-00000000000a', nome: 'Administrador (demo)', email: 'admin@demo.com', perfil: 'admin' },
  'totem@demo.com': { id: '00000000-0000-4000-8000-00000000000b', nome: 'Totem da portaria (demo)', email: 'totem@demo.com', perfil: 'totem' },
}
const CHAVE_SESSAO = 'mercado-demo-sessao'

const iso = (v: string) => new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString()

export function criarApiDemo(aoProgresso?: (msg: string) => void): Api {
  let db: PGlite | null = null
  let pronto: Promise<PGlite> | null = null
  let usuario: Usuario | null = lerSessao()
  const ouvintesSessao = new Set<(u: Usuario | null) => void>()
  const ouvintesPagamento = new Map<string, Set<(p: Pagamento) => void>>()
  const ouvintesVenda = new Set<() => void>()
  const ouvintesAviso = new Set<() => void>()
  // os avisos nascem de triggers do banco: depois de qualquer alteração, avisa o sino
  let timerAviso: number | undefined
  const notificarAvisos = () => {
    clearTimeout(timerAviso)
    timerAviso = window.setTimeout(() => ouvintesAviso.forEach((cb) => cb()), 300)
  }

  // Login por aba (sessionStorage): dá para ter o totem numa aba e o painel em outra.
  function lerSessao(): Usuario | null {
    try {
      const daAba = sessionStorage.getItem(CHAVE_SESSAO)
      if (daAba !== null) return JSON.parse(daAba)
      // versões anteriores guardavam no localStorage: migra uma vez
      const antigo = localStorage.getItem(CHAVE_SESSAO)
      if (antigo) {
        sessionStorage.setItem(CHAVE_SESSAO, antigo)
        localStorage.removeItem(CHAVE_SESSAO)
      }
      return JSON.parse(antigo ?? 'null')
    } catch {
      return null
    }
  }
  function gravarSessao(u: Usuario | null) {
    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(u))
    } catch {
      /* navegação privada: a sessão fica só na memória */
    }
  }

  // Sincroniza as abas: quando uma grava o snapshot, as outras recarregam
  // o banco dele na próxima consulta e o painel se atualiza sozinho.
  const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mercado-autonomo-demo') : null
  let recarregarDoSnapshot = false
  canal?.addEventListener('message', (ev) => {
    if (ev.data?.tipo !== 'snapshot' || timerSalvar) return // alteração local pendente tem prioridade
    recarregarDoSnapshot = true
    ouvintesVenda.forEach((cb) => cb())
    notificarAvisos()
  })

  // O banco roda em memória; uma cópia (snapshot) fica no IndexedDB e é
  // regravada logo após cada alteração. Abrir o snapshot leva ~0,3 s.
  let timerSalvar: number | undefined
  function salvarDepois() {
    clearTimeout(timerSalvar)
    timerSalvar = window.setTimeout(async () => {
      if (!db) return
      const arquivo = await db.dumpDataDir('none')
      timerSalvar = undefined
      await gravarSnapshot({ versao: VERSAO, arquivo })
        .then(() => canal?.postMessage({ tipo: 'snapshot' }))
        .catch((e) => console.warn('Snapshot do demo não salvo', e))
    }, 600)
  }

  async function iniciar() {
    aoProgresso?.('Abrindo banco local…')
    const parsers = {
      [types.NUMERIC]: (v: string) => Number(v),
      [types.INT8]: (v: string) => Number(v),
      [types.DATE]: (v: string) => v,
      [types.TIMESTAMPTZ]: iso,
    }
    const snap = await lerSnapshot().catch(() => null)
    const valido = snap?.versao === VERSAO
    const pg = await PGlite.create(valido ? { loadDataDir: snap!.arquivo, parsers } : { parsers })
    await pg.exec(`set timezone = 'UTC'`)
    if (!valido) {
      aoProgresso?.('Criando banco de dados de exemplo (só na primeira vez)…')
      await pg.exec(stubs)
      for (const m of migracoes) await pg.exec(m)
      aoProgresso?.('Gerando 60 dias de vendas…')
      await pg.exec(seed)
      for (const u of Object.values(USUARIOS_DEMO)) {
        await pg.query(`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3, $4)`, [
          u.id, u.email, JSON.stringify({ perfil: u.perfil }), JSON.stringify({ nome: u.nome }),
        ])
      }
    }
    if (usuario) await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario.id])
    db = pg
    if (!valido) salvarDepois()
    return pg
  }

  const banco = () => {
    if (recarregarDoSnapshot && db) {
      recarregarDoSnapshot = false
      const antigo = db
      db = null
      pronto = iniciar().finally(() => antigo.close().catch(() => {}))
    }
    return db ? Promise.resolve(db) : (pronto ??= iniciar())
  }
  // o "servidor" do demo roda no navegador; sem internet ele finge estar
  // inacessível, como o Supabase estaria (permite testar o modo offline)
  const exigirRede = () => {
    if (!online()) throw new TypeError('Failed to fetch (modo demonstração sem internet)')
  }
  const linhas = async <T>(sql: string, params: unknown[] = []) => {
    exigirRede()
    return (await (await banco()).query<T>(sql, params)).rows
  }
  /** comandos que alteram dados: depois deles o snapshot é regravado */
  const exec = async (sql: string, params: unknown[] = []) => {
    exigirRede()
    try {
      return await (await banco()).query(sql, params)
    } catch (e) {
      throw new Error((e as Error).message)
    } finally {
      salvarDepois()
      notificarAvisos()
    }
  }

  async function lerPagamento(id: string) {
    return (await linhas<Pagamento>(`select * from pagamentos where id = $1`, [id]))[0]
  }
  async function notificarPagamento(id: string) {
    const p = await lerPagamento(id)
    ouvintesPagamento.get(id)?.forEach((cb) => cb(p))
    if (p.status === 'aprovado') ouvintesVenda.forEach((cb) => cb())
  }

  return {
    modo: 'demo',

    async sessaoAtual() {
      await banco()
      return usuario
    },
    async entrar(email) {
      const u = USUARIOS_DEMO[email.trim().toLowerCase()]
      if (!u) throw new Error('No modo demonstração use admin@demo.com ou totem@demo.com (qualquer senha).')
      await (await banco()).query(`select set_config('request.jwt.claim.sub', $1, false)`, [u.id])
      usuario = u
      gravarSessao(u)
      ouvintesSessao.forEach((cb) => cb(u))
      return u
    },
    async sair() {
      usuario = null
      gravarSessao(null)
      await (await banco()).query(`select set_config('request.jwt.claim.sub', '', false)`)
      ouvintesSessao.forEach((cb) => cb(null))
    },
    aoMudarSessao(cb) {
      ouvintesSessao.add(cb)
      return () => ouvintesSessao.delete(cb)
    },

    listarCategorias: () => linhas(`select * from categorias order by ordem, nome`),
    async salvarCategoria(c) {
      if (c.id) await exec(`update categorias set nome=$2, icone=$3, cor=$4, ordem=$5, ativo=$6 where id=$1`, [c.id, c.nome, c.icone, c.cor, c.ordem ?? 0, c.ativo ?? true])
      else await exec(`insert into categorias (nome, icone, cor, ordem) values ($1, $2, $3, $4)`, [c.nome, c.icone ?? 'package', c.cor ?? '#64748b', c.ordem ?? 0])
    },
    listarFornecedores: () => linhas(`select * from fornecedores order by nome`),
    async salvarFornecedor(f) {
      const v = [f.nome, f.cnpj ?? null, f.telefone ?? null, f.email ?? null, f.contato ?? null, f.ativo ?? true]
      if (f.id) await exec(`update fornecedores set nome=$2, cnpj=$3, telefone=$4, email=$5, contato=$6, ativo=$7 where id=$1`, [f.id, ...v])
      else await exec(`insert into fornecedores (nome, cnpj, telefone, email, contato, ativo) values ($1,$2,$3,$4,$5,$6)`, v)
    },

    listarProdutos: () => linhas(`select * from produtos_alertas order by nome`),
    async salvarProduto(p) {
      const v = [p.nome, p.foto_url, p.categoria_id, p.codigo_barras || null, p.preco_custo, p.preco_venda, p.estoque_minimo, p.validade || null, p.ativo]
      if (p.id) {
        await exec(`update produtos set nome=$2, foto_url=$3, categoria_id=$4, codigo_barras=$5, preco_custo=$6, preco_venda=$7,
          estoque_minimo=$8, validade=$9, ativo=$10 where id=$1`, [p.id, ...v])
        return p.id
      }
      const r = await exec(`insert into produtos (nome, foto_url, categoria_id, codigo_barras, preco_custo, preco_venda, estoque_minimo, validade, ativo)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, v)
      return (r.rows[0] as { id: string }).id
    },
    enviarFoto: (arquivo) => reduzirImagem(arquivo),

    async listarMovimentacoes(f) {
      const cond: string[] = []
      const p: unknown[] = []
      const add = (sql: string, v: unknown) => { p.push(v); cond.push(sql.replace('?', `$${p.length}`)) }
      if (f.inicio) add('data_movimentacao >= ?', inicioDoDia(f.inicio))
      if (f.fim) add('data_movimentacao <= ?', fimDoDia(f.fim))
      if (f.produto_id) add('produto_id = ?', f.produto_id)
      if (f.categoria_id) add('categoria_id = ?', f.categoria_id)
      if (f.motivo === 'entrada' || f.motivo === 'saida') add('tipo = ?', f.motivo)
      else if (f.motivo) add('motivo = ?', f.motivo)
      return linhas(`select * from movimentacoes_detalhadas ${cond.length ? 'where ' + cond.join(' and ') : ''}
        order by data_movimentacao desc, id desc limit ${Number(f.limite ?? 500)}`, p)
    },
    async registrarMovimentacao(m) {
      await exec(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, fornecedor_id, data_movimentacao, observacao, usuario_id)
        values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()),$8,$9)`,
        [m.produto_id, m.tipo, m.motivo, m.quantidade, m.custo_unitario ?? null, m.fornecedor_id ?? null, m.data_movimentacao ?? null, m.observacao ?? null, usuario?.id ?? null])
    },

    listarMoradores: () => linhas(`select * from moradores_admin order by apartamento, nome`),
    async salvarMorador(m) {
      await exec(`select salvar_morador($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [m.id ?? null, m.nome, m.apartamento, m.bloco, m.telefone, m.email, m.ativo, m.pin || null, m.cpf])
    },
    async desbloquearMorador(id) {
      await exec(`select desbloquear_morador($1)`, [id])
    },
    async revisarMorador(id) {
      await exec(`select revisar_morador($1)`, [id])
    },
    async cadastrarMoradorTotem(d) {
      const r = (await exec(`select cadastrar_morador_totem($1, $2, $3, $4, $5, $6, $7, $8) as r`,
        [d.nome, d.apartamento, d.bloco, d.telefone, d.email, d.pin, d.aceite, d.cpf])).rows[0] as { r: never }
      return resultadoIdentificacao(r.r)
    },
    async identificarMorador(apartamento, pin) {
      const r = (await exec(`select identificar_morador($1, $2) as r`, [apartamento, pin])).rows[0] as { r: never }
      return resultadoIdentificacao(r.r)
    },

    async listarVendas(f) {
      const cond: string[] = []
      const p: unknown[] = []
      if (f.inicio) { p.push(inicioDoDia(f.inicio)); cond.push(`criado_em >= $${p.length}`) }
      if (f.fim) { p.push(fimDoDia(f.fim)); cond.push(`criado_em <= $${p.length}`) }
      if (f.status) { p.push(f.status); cond.push(`status = $${p.length}`) }
      if (f.apenasOffline) cond.push('offline')
      if (f.conferencia) { p.push(f.conferencia); cond.push(`conferencia = $${p.length}`) }
      return linhas(`select v.*, coalesce((select json_agg(json_build_object('produto_id', i.produto_id, 'nome_produto', i.nome_produto,
          'quantidade', i.quantidade, 'preco_unitario', i.preco_unitario, 'custo_unitario', i.custo_unitario, 'subtotal', i.subtotal))
          from itens_venda i where i.venda_id = v.id), '[]') as itens_venda,
          (select json_build_object('nome', m.nome) from moradores m where m.id = v.morador_id) as moradores
        from vendas v ${cond.length ? 'where ' + cond.join(' and ') : ''} order by criado_em desc limit ${Number(f.limite ?? 300)}`, p)
    },

    configPixTotem: async () => (await linhas<{ c: never }>(`select config_pix_totem() as c`))[0].c,
    obterConfigPix: async () =>
      (await linhas<ConfigPix>(`select tipo_chave, chave, nome_recebedor, cidade, offline_ativo from config_pix where id = 1`))[0],
    async salvarConfigPix(c) {
      await exec(`update config_pix set tipo_chave = $1, chave = $2, nome_recebedor = $3, cidade = $4, offline_ativo = $5, atualizado_em = now() where id = 1`,
        [c.tipo_chave, c.chave, c.nome_recebedor, c.cidade, c.offline_ativo])
    },
    async registrarVendaOffline(v) {
      return ((await exec(`select registrar_venda_offline($1::jsonb) as r`, [JSON.stringify(v)])).rows[0] as { r: never }).r
    },
    async conferirVendaOffline(vendaId, recebido) {
      await exec(`select conferir_venda_offline($1, $2)`, [vendaId, recebido])
    },

    catalogo: () => linhas(`select * from catalogo_totem order by categoria_ordem, nome`),
    async criarPagamento(itens, metodo, cliente) {
      exigirRede()
      const pg = await banco()
      const r = await pg.transaction(async (tx) => {
        await tx.query(`select expirar_pagamentos_vencidos()`)
        const ids = itens.map((i) => i.produto_id)
        const prods = (await tx.query<{ id: string; nome: string; preco_venda: number; preco_custo: number }>(
          `select id, nome, preco_venda, preco_custo from produtos where ativo and id = any($1::uuid[])`, [ids])).rows
        if (prods.length !== new Set(ids).size) throw new Error('Algum produto do carrinho não está mais disponível')
        const qtd = (id: string) => itens.filter((i) => i.produto_id === id).reduce((s, i) => s + i.quantidade, 0)
        const total = prods.reduce((s, p) => s + Math.round(p.preco_venda * 100) * qtd(p.id), 0) / 100
        const custo = prods.reduce((s, p) => s + Math.round(p.preco_custo * 100) * qtd(p.id), 0) / 100
        // mesma regra da Edge Function: visitante e morador sem cadastro informam CPF;
        // visitante não tem apto; cadastrado usa o apto do cadastro
        const cpfCliente = cliente.tipo === 'morador_cadastrado' ? null : somenteDigitos(cliente.cpf ?? '')
        if (cliente.tipo !== 'morador_cadastrado' && !cpfValido(cpfCliente ?? '')) throw new Error('Informe um CPF válido para continuar a compra')
        let apartamento = cliente.tipo === 'visitante' ? null : cliente.apartamento?.trim().slice(0, 20) || null
        if (cliente.tipo === 'morador_cadastrado') {
          const m = (await tx.query<{ apartamento: string; bloco: string | null }>(
            `select apartamento, bloco from moradores where ativo and id = $1`, [cliente.morador_id])).rows[0]
          if (!m) throw new Error('Cadastro do morador não encontrado')
          apartamento = m.bloco ? `${m.apartamento} ${m.bloco}` : m.apartamento
        }
        const venda = (await tx.query<{ id: string; numero: number; total: number }>(
          `insert into vendas (metodo, apartamento, tipo_cliente, morador_id, total, custo_total, totem_id, cpf_cliente)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, numero, total`,
          [metodo, apartamento, cliente.tipo, cliente.tipo === 'morador_cadastrado' ? cliente.morador_id : null, total, custo, usuario?.id, cpfCliente])).rows[0]
        for (const p of prods) {
          await tx.query(`insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario) values ($1,$2,$3,$4,$5,$6)`,
            [venda.id, p.id, p.nome, qtd(p.id), p.preco_venda, p.preco_custo])
        }
        const pagamento = (await tx.query<Pagamento>(
          `insert into pagamentos (venda_id, totem_id, provedor, metodo, valor, expira_em, id_externo)
           values ($1, $2, 'simulado', $3, $4, now() + interval '5 minutes', 'SIM-' || substr(md5(random()::text), 1, 8)) returning *`,
          [venda.id, usuario?.id, metodo, total])).rows[0]
        if (metodo === 'pix') {
          pagamento.qr_code = `SANDBOX-PIX|${pagamento.id}|R$ ${total.toFixed(2)}`
          await tx.query(`update pagamentos set qr_code = $2 where id = $1`, [pagamento.id, pagamento.qr_code])
        }
        return { venda, pagamento: { ...pagamento, modo: metodo === 'pix' ? 'pix' : 'maquininha' } as Pagamento }
      })
      salvarDepois()
      return r
    },
    acompanharPagamento(id, cb) {
      if (!ouvintesPagamento.has(id)) ouvintesPagamento.set(id, new Set())
      ouvintesPagamento.get(id)!.add(cb)
      return () => ouvintesPagamento.get(id)?.delete(cb)
    },
    async cancelarPagamento(id, motivo) {
      await exec(`select encerrar_pagamento($1, $2::status_pagamento, $3)`, [id, motivo, motivo === 'expirado' ? 'QR Code expirado' : 'Cancelado pelo morador'])
      await notificarPagamento(id)
    },
    async simularPagamento(id, resultado) {
      await new Promise((r) => setTimeout(r, 1200))
      if (resultado === 'aprovado') await exec(`select finalizar_pagamento($1, null, '{"simulado": true}'::jsonb)`, [id])
      else await exec(`select encerrar_pagamento($1, 'recusado', 'Recusado (simulação)')`, [id])
      await notificarPagamento(id)
    },
    async enviarComprovante() {
      await new Promise((r) => setTimeout(r, 700))
    },

    async avaliarVenda(vendaId, nota, comentario, sugestao) {
      const r = (await exec(`select avaliar_venda($1, $2, $3, $4) as r`, [vendaId, nota, comentario ?? null, sugestao ?? null])).rows[0] as { r: { erro?: string } }
      if (r.r?.erro) throw new Error(r.r.erro)
    },
    async listarAvaliacoes(f) {
      const cond: string[] = []
      const p: unknown[] = []
      const add = (sql: string, v: unknown) => { p.push(v); cond.push(sql.replace('?', `$${p.length}`)) }
      if (f.inicio) add('criado_em >= ?', inicioDoDia(f.inicio))
      if (f.fim) add('criado_em <= ?', fimDoDia(f.fim))
      if (f.nota) add('nota = ?', f.nota)
      if (f.comComentario) cond.push('comentario is not null')
      if (f.comSugestao) cond.push('sugestao is not null')
      return linhas(`select * from avaliacoes_detalhadas ${cond.length ? 'where ' + cond.join(' and ') : ''}
        order by criado_em desc limit ${Number(f.limite ?? 500)}`, p)
    },
    async marcarAvaliacoesLidas(ids) {
      if (ids.length) await exec(`update avaliacoes set lida = true where id = any($1::bigint[])`, [ids])
    },
    sugestoesProdutos: (inicio, fim, limite = 10) => linhas(`select * from sugestoes_produtos($1, $2, $3)`, [inicio, fim, limite]),
    async resumoAvaliacoes(inicio, fim) {
      return (await linhas<{ r: never }>(`select dashboard_avaliacoes($1, $2) as r`, [inicio, fim]))[0].r
    },

    async resumo(inicio, fim) {
      return (await linhas<{ r: never }>(`select dashboard_resumo($1, $2) as r`, [inicio, fim]))[0].r
    },
    serie: (inicio, fim, agrup) => linhas(`select * from dashboard_serie($1, $2, $3)`, [inicio, fim, agrup]),
    topProdutos: (inicio, fim, limite = 10) => linhas(`select * from dashboard_top_produtos($1, $2, $3)`, [inicio, fim, limite]),
    porCategoria: (inicio, fim) => linhas(`select * from dashboard_categorias($1, $2)`, [inicio, fim]),
    porMetodo: (inicio, fim) => linhas(`select * from dashboard_metodos($1, $2)`, [inicio, fim]),
    porCliente: (inicio, fim) => linhas(`select * from dashboard_clientes($1, $2)`, [inicio, fim]),
    aoNovaVenda(cb) {
      ouvintesVenda.add(cb)
      return () => ouvintesVenda.delete(cb)
    },

    async listarAvisos(f) {
      const cond: string[] = []
      if (f.apenasNaoLidos) cond.push('not lido')
      if (!f.incluirResolvidos) cond.push('not resolvido')
      if (f.grupo === 'estoque') cond.push(`tipo in ('estoque_baixo', 'estoque_zerado', 'validade_proxima', 'produto_vencido')`)
      if (f.grupo === 'avaliacoes') cond.push(`tipo in ('avaliacao_baixa', 'sugestao_produto')`)
      return linhas(`select * from avisos ${cond.length ? 'where ' + cond.join(' and ') : ''}
        order by criado_em desc limit ${Number(f.limite ?? 200)}`)
    },
    async contarAvisosNaoLidos() {
      return (await linhas<{ n: number }>(`select count(*)::int as n from avisos where not lido and not resolvido`))[0].n
    },
    async marcarAvisosLidos(ids) {
      if (ids === 'todos') await exec(`update avisos set lido = true where not lido`)
      else if (ids.length) await exec(`update avisos set lido = true where id = any($1::bigint[])`, [ids])
    },
    async verificarAvisos() {
      return ((await exec(`select verificar_avisos() as n`)).rows[0] as { n: number }).n
    },
    obterConfigAvisos: async () =>
      (await linhas<ConfigAvisos>(`select email, enviar_imediato, niveis_imediato::text[] as niveis_imediato, resumo_diario from config_avisos where id = 1`))[0],
    async salvarConfigAvisos(c) {
      await exec(`update config_avisos set email = $1, enviar_imediato = $2, niveis_imediato = $3::gravidade_aviso[],
        resumo_diario = $4, atualizado_em = now() where id = 1`, [c.email, c.enviar_imediato, c.niveis_imediato, c.resumo_diario])
    },
    async testarEnvioAvisos() {
      throw new Error('No modo demonstração não há envio de e-mail. Configure o Supabase e a chave do Resend.')
    },
    aoNovoAviso(cb) {
      ouvintesAviso.add(cb)
      return () => ouvintesAviso.delete(cb)
    },
  }
}

// --- snapshot no IndexedDB -------------------------------------------------
interface Snapshot { versao: string; arquivo: File | Blob }
function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open('mercado-autonomo-demo-snapshot', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('snap')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => falha(r.error)
  })
}
async function lerSnapshot(): Promise<Snapshot | null> {
  const idb = await abrirIdb()
  return new Promise((ok, falha) => {
    const r = idb.transaction('snap').objectStore('snap').get('atual')
    r.onsuccess = () => ok((r.result as Snapshot) ?? null)
    r.onerror = () => falha(r.error)
  })
}
async function gravarSnapshot(s: Snapshot) {
  const idb = await abrirIdb()
  return new Promise<void>((ok, falha) => {
    const t = idb.transaction('snap', 'readwrite')
    t.objectStore('snap').put(s, 'atual')
    t.oncomplete = () => ok()
    t.onerror = () => falha(t.error)
  })
}

/** Reduz a foto para no máx. 480 px e devolve como data URL (sem storage no demo). */
function reduzirImagem(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const escala = Math.min(1, 480 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * escala)
      c.height = Math.round(img.height * escala)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/webp', 0.85))
    }
    img.onerror = () => reject(new Error('Imagem inválida'))
    img.src = URL.createObjectURL(arquivo)
  })
}
