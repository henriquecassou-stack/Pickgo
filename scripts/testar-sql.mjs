// Valida a migração e o seed num Postgres embutido (PGlite), sem Docker.
// Simula o mínimo do Supabase (auth.users, auth.uid(), storage, papéis)
// e testa as regras de estoque e o fluxo de pagamento.
//   npm run test:sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'

const db = new PGlite()
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

await db.exec(ler('src/lib/demo/supabase-stubs.sql'))

const migracoes = readdirSync(new URL('../supabase/migrations', import.meta.url)).sort()
const rodar = async (arq) => {
  const sql = ler(arq)
  try { await db.exec(sql) } catch (e) {
    const pos = Number(e.position) || 0
    console.error(`✗ ${arq}: ${e.message}${pos ? `
  perto de: ${sql.slice(Math.max(0, pos - 120), pos + 60)}` : ""}${e.where ? `
  em: ${e.where}` : ""}`)
    process.exit(1)
  }
}
for (const m of migracoes) await rodar(`supabase/migrations/${m}`)
const t0 = Date.now()
await rodar("supabase/seed.sql")
console.log(`✓ migração + seed (${Date.now() - t0} ms)`)

let falhas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) falhas++ }
const um = async (sql, p) => (await db.query(sql, p)).rows[0]
const esperaErro = async (sql, trecho, msg) => {
  try { await db.exec(sql); ok(false, msg) } catch (e) { ok(String(e.message).includes(trecho), `${msg} (${e.message})`) }
}

// --- dados de exemplo ---
const r = await um(`select (select count(*) from produtos)::int produtos,
  (select count(*) from vendas where status='paga')::int vendas,
  (select count(distinct (pago_em at time zone 'America/Sao_Paulo')::date) from vendas where status='paga')::int dias,
  (select count(*) from movimentacoes_estoque)::int movs`)
console.log('  ', r)
ok(r.produtos === 20, '20 produtos')
ok(r.dias >= 59, '60 dias de vendas')

// saldo = soma das movimentações e trilha de saldos encadeada
const inconsist = await um(`select count(*)::int n from produtos p where p.estoque_atual <>
  coalesce((select sum(case when tipo='entrada' then quantidade else -quantidade end) from movimentacoes_estoque m where m.produto_id=p.id),0)`)
ok(inconsist.n === 0, 'estoque_atual = soma das movimentações')
const trilha = await um(`select count(*)::int n from (select saldo_anterior, lag(saldo_posterior) over (partition by produto_id order by id) ant from movimentacoes_estoque) s where ant is not null and ant <> saldo_anterior`)
ok(trilha.n === 0, 'saldo_anterior de cada movimentação = saldo_posterior da anterior')
const alertas = await um(`select count(*) filter (where estoque_baixo)::int baixo, count(*) filter (where perto_validade)::int validade from produtos_alertas`)
ok(alertas.baixo >= 1 && alertas.validade >= 2, `alertas presentes (${JSON.stringify(alertas)})`)

// --- regra: saldo não pode ser alterado na mão ---
await esperaErro(`update produtos set estoque_atual = 999 where nome like 'Água%'`, 'só pode ser alterado', 'bloqueia UPDATE direto de estoque_atual')
await esperaErro(`delete from movimentacoes_estoque where id = 1`, 'imutáveis', 'movimentação não pode ser apagada')
await esperaErro(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) select id, 'saida', 'perda', 100000 from produtos limit 1`, 'Estoque insuficiente', 'saída manual não deixa saldo negativo')
await esperaErro(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) select id, 'entrada', 'perda', 1 from produtos limit 1`, 'motivo_coerente', 'motivo precisa combinar com o tipo')

// --- perfis e RLS ---
const admin = '00000000-0000-0000-0000-00000000000a'
const totem = '00000000-0000-0000-0000-00000000000b'
await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values
  ('${admin}', 'admin@mercado.local', '{"perfil":"admin"}'), ('${totem}', 'totem@mercado.local', '{"perfil":"totem"}'),
  ('00000000-0000-0000-0000-0000000000cc', 'curioso@x.com', '{}')`)
const perfis = (await db.query(`select email, perfil, ativo from usuarios order by email`)).rows
ok(perfis[0].perfil === 'admin' && perfis[2].perfil === 'totem' && perfis[0].ativo && perfis[2].ativo, 'perfis criados pelo trigger do auth')
ok(perfis[1].email === 'curioso@x.com' && perfis[1].ativo === false, 'conta sem perfil (cadastro público) nasce desativada')

await db.exec(`grant usage on schema public to authenticated; grant select, insert, update on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated; grant usage on schema auth to authenticated;`)
const como = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
await como(totem, async () => {
  const p = await um(`select count(*)::int n from produtos`)
  ok(p.n === 0, 'totem não lê a tabela produtos (custo protegido)')
  const c = await um(`select count(*)::int n from catalogo_totem`)
  ok(c.n === 20, 'totem lê o catálogo seguro')
  await esperaErro(`select dashboard_resumo(current_date, current_date)`, 'restrito', 'totem não acessa o dashboard')
  await esperaErro(`select finalizar_pagamento(gen_random_uuid())`, 'permission denied', 'totem não consegue aprovar pagamento')
})
await como(admin, async () => {
  const d = await um(`select dashboard_resumo(current_date - 29, current_date) r`)
  ok(Number(d.r.faturamento) > 0 && Number(d.r.lucro_bruto) > 0, `dashboard: ${JSON.stringify(d.r)}`)
  const s = await db.query(`select * from dashboard_serie(current_date - 59, current_date, 'semana')`)
  ok(s.rows.length >= 9, `série semanal com ${s.rows.length} pontos`)
  const top = await db.query(`select * from dashboard_top_produtos(current_date - 29, current_date, 5)`)
  ok(top.rows.length === 5, `top produto: ${top.rows[0].nome} (${top.rows[0].quantidade})`)
  const met = await db.query(`select * from dashboard_metodos(current_date - 29, current_date)`)
  ok(met.rows.length === 3, `métodos: ${met.rows.map((m) => m.metodo).join(', ')}`)
  const mov = await um(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, fornecedor_id)
    select id, 'entrada', 'reposicao', 10, 1.00, 1 from produtos where nome like 'Água%' returning usuario_id, saldo_anterior, saldo_posterior`)
  ok(mov.usuario_id === admin && mov.saldo_posterior === mov.saldo_anterior + 10, 'admin registra entrada e o saldo sobe')
  await esperaErro(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, venda_id)
    select p.id, 'saida', 'venda', 1, v.id from produtos p, vendas v limit 1`, 'row-level security', 'admin não cria saída de venda manualmente')
})

// --- moradores: identificação por apartamento + PIN ---
await como(totem, async () => {
  const okId = await um(`select identificar_morador(' 101 ', '1234') r`)
  ok(okId.r.nome === 'Ana' && okId.r.telefone_mascarado === '•••• 1010', `totem identifica morador (${JSON.stringify(okId.r)})`)
  ok((await um(`select identificar_morador('101', '0000') r`)).r.erro === 'credenciais', 'PIN errado é recusado')
  ok((await um(`select count(*)::int n from moradores`)).n === 0, 'totem não lê a tabela de moradores')
  await esperaErro(`select salvar_morador(null, 'X', '1', null, null, null, true, '1234', '86420975310')`, 'restrito', 'totem não cadastra morador')
  for (let i = 0; i < 5; i++) await um(`select identificar_morador('102', '9999')`)
  const bloq = await um(`select identificar_morador('102', '1234') r`)
  ok(bloq.r.erro === 'bloqueado', `5 erros bloqueiam o apartamento (${JSON.stringify(bloq.r)})`)
})
await como(admin, async () => {
  const id = (await um(`select salvar_morador(null, 'Zeca Teste', '909', 'C', null, 'zeca@ex.com', true, '4321', '864.209.753-10') id`)).id
  const hash = await um(`select pin_hash from moradores where id = $1`, [id])
  ok(hash.pin_hash && hash.pin_hash !== '4321', 'PIN guardado só como hash')
  await esperaErro(`select salvar_morador(null, 'Sem PIN', '1', null, null, null, true, null, '35792468109')`, 'Defina um PIN', 'cadastro novo exige PIN')
  await esperaErro(`select salvar_morador(null, 'PIN ruim', '1', null, null, null, true, '12a', '35792468109')`, '4 a 6', 'PIN precisa ser numérico de 4 a 6 dígitos')
  await um(`select desbloquear_morador(id) from moradores where apartamento = '102'`)
  const lista = await um(`select count(*)::int n, count(*) filter (where bloqueado)::int b from moradores_admin`)
  ok(lista.n === 9 && lista.b === 0, 'admin lista e desbloqueia moradores')
  const cli = await db.query(`select * from dashboard_clientes(current_date - 29, current_date)`)
  ok(cli.rows.length === 3, `vendas por tipo de cliente: ${cli.rows.map((c) => c.tipo_cliente).join(', ')}`)
})

// --- autocadastro no totem ---
await como(totem, async () => {
  const novo = await um(`select cadastrar_morador_totem('Nina Rocha', '605', 'b', '(11) 97777-6050', 'Nina@Ex.com', '2468', true, '935.411.347-80') r`)
  ok(novo.r.nome === 'Nina' && novo.r.apartamento === '605', `totem cadastra e já identifica (${JSON.stringify(novo.r)})`)
  const semAceite = await um(`select cadastrar_morador_totem('Sem Aceite', '606', null, null, null, '1357', false, '19283746546') r`)
  ok(semAceite.r.erro === 'dados', 'exige consentimento')
  const pinRuim = await um(`select cadastrar_morador_totem('Pin Ruim', '606', null, null, null, '12', true, '19283746546') r`)
  ok(pinRuim.r.erro === 'dados', 'valida PIN no autocadastro')
  // PIN já usado no apartamento 101 (Ana = 1234): recusado sem revelar de quem é, e conta como erro
  const repetido = await um(`select cadastrar_morador_totem('Intruso', '101', null, null, null, '1234', true, '71428793860') r`)
  ok(repetido.r.erro === 'pin_indisponivel' && !repetido.r.nome, 'PIN repetido no apartamento é recusado')
  for (const [pin, cpf] of [['1010', '27463185044'], ['1020', '61823947069'], ['1030', '84236175991']]) await um(`select cadastrar_morador_totem('Spam', '777', null, null, null, $1, true, $2)`, [pin, cpf])
  ok((await um(`select cadastrar_morador_totem('Spam 4', '777', null, null, null, '1040', true, '35792468109') r`)).r.erro === 'limite', 'limita autocadastros por hora')
})
await como(admin, async () => {
  const pend = await um(`select count(*)::int n from moradores_admin where not revisado and origem = 'totem'`)
  ok(pend.n === 4, `cadastros do totem aguardam revisão (${pend.n})`)
  await um(`select revisar_morador(id) from moradores where nome = 'Nina Rocha'`)
  ok((await um(`select revisado from moradores_admin where nome = 'Nina Rocha'`)).revisado === true, 'admin confirma cadastro do totem')
  ok((await um(`select tentativas_falhas from moradores where apartamento = '101'`)).tentativas_falhas === 2, 'tentativa com PIN repetido contou como erro (1 do teste anterior + 1)')
})

// --- avaliações ---
const vendaTotem = await um(`insert into vendas (metodo, total, custo_total, totem_id, tipo_cliente, status, pago_em)
  values ('pix', 5.5, 2.6, '${totem}', 'visitante', 'paga', now()) returning id`)
const vendaVelha = await um(`insert into vendas (metodo, total, custo_total, totem_id, tipo_cliente, status, pago_em)
  values ('pix', 5.5, 2.6, '${totem}', 'visitante', 'paga', now() - interval '2 hours') returning id`)
await como(totem, async () => {
  ok((await um(`select avaliar_venda($1, 4) r`, [vendaTotem.id])).r.ok === true, 'totem grava a nota ao tocar na estrela')
  ok((await um(`select avaliar_venda($1, 5, '  Adorei!  ') r`, [vendaTotem.id])).r.ok === true, 'totem completa com comentário (mesma avaliação)')
  ok((await um(`select avaliar_venda($1, 6) r`, [vendaTotem.id])).r.erro !== undefined, 'nota fora de 1 a 5 é recusada')
  ok((await um(`select avaliar_venda($1, 5, null, ' Frutas ') r`, [vendaTotem.id])).r.ok === true, 'totem grava sugestão de produto')
  ok((await um(`select avaliar_venda($1, 5) r`, [vendaVelha.id])).r.erro?.includes('prazo'), 'não avalia depois de 30 min')
  ok((await um(`select count(*)::int n from avaliacoes`)).n === 0, 'totem não lê as avaliações')
})
await como(admin, async () => {
  const a = await um(`select nota, comentario, sugestao from avaliacoes where venda_id = $1`, [vendaTotem.id])
  ok(a.nota === 5 && a.comentario === 'Adorei!' && a.sugestao === 'Frutas', `avaliação única por venda, observação mantida (${JSON.stringify(a)})`)
  const sug = await db.query(`select * from sugestoes_produtos(current_date - 59, current_date, 3)`)
  ok(sug.rows[0]?.pedidos > 1, `produtos mais pedidos agrupados: ${sug.rows.map((x) => `${x.sugestao} (${x.pedidos})`).join(', ')}`)
  const r = await um(`select dashboard_avaliacoes(current_date - 29, current_date) r`)
  ok(Number(r.r.total) > 50 && Number(r.r.media) >= 3.5 && r.r.distribuicao.length === 5, `resumo das avaliações: média ${r.r.media}, ${r.r.total} no período`)
})

// --- avisos ---
{
  const ini = await um(`select count(*) filter (where tipo in ('estoque_baixo','estoque_zerado'))::int estoque,
    count(*) filter (where tipo in ('validade_proxima','produto_vencido'))::int validade, count(*)::int total from avisos where not resolvido`)
  ok(ini.estoque >= 1 && ini.validade >= 2, `seed gera avisos da situação atual (${JSON.stringify(ini)})`)
  const sor = await um(`select id, estoque_atual, estoque_minimo from produtos where nome like 'Sorvete%'`)
  await db.query(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) values ($1, 'saida', 'perda', $2)`, [sor.id, sor.estoque_atual - sor.estoque_minimo + 1])
  ok((await um(`select count(*)::int n from avisos where referencia_id = $1 and tipo = 'estoque_baixo' and not resolvido`, [sor.id])).n === 1, 'saída que cruza o mínimo abre aviso de estoque baixo')
  await db.query(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) values ($1, 'saida', 'perda', $2)`, [sor.id, sor.estoque_minimo - 1])
  const z = await um(`select count(*) filter (where tipo = 'estoque_zerado' and not resolvido)::int zerado, count(*) filter (where tipo = 'estoque_baixo' and not resolvido)::int baixo from avisos where referencia_id = $1`, [sor.id])
  ok(z.zerado === 1 && z.baixo === 0, 'zerar troca o aviso para estoque zerado (crítico)')
  await db.query(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) values ($1, 'entrada', 'reposicao', 20)`, [sor.id])
  ok((await um(`select count(*)::int n from avisos where referencia_id = $1 and not resolvido and tipo in ('estoque_baixo','estoque_zerado')`, [sor.id])).n === 0, 'reposição resolve o aviso de estoque')
  await db.query(`insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade) values ($1, 'saida', 'perda', 17)`, [sor.id])
  ok((await um(`select count(*)::int n from avisos where referencia_id = $1 and tipo = 'estoque_baixo'`, [sor.id])).n === 2, 'novo aviso quando cruza o mínimo de novo (o anterior ficou no histórico)')
  await db.query(`update produtos set validade = current_date - 1 where id = $1`, [sor.id])
  ok((await um(`select gravidade from avisos where referencia_id = $1 and tipo = 'produto_vencido' and not resolvido`, [sor.id]))?.gravidade === 'critico', 'validade vencida com estoque gera aviso crítico')
  const n1 = await um(`select verificar_avisos() n`); const n2 = await um(`select verificar_avisos() n`)
  ok(n2.n === 0, `varredura é idempotente (1ª: ${n1.n}, 2ª: ${n2.n})`)
  const vb = await um(`insert into vendas (metodo, total, custo_total, totem_id, tipo_cliente, status, pago_em) values ('pix', 3, 1, '${totem}', 'visitante', 'paga', now()) returning id`)
  await como(totem, async () => {
    await um(`select avaliar_venda($1, 1, null, null)`, [vb.id])
    await um(`select avaliar_venda($1, 1, 'Leitor travou', 'Pilhas')`, [vb.id])
  })
  const av = await um(`select (select mensagem from avisos where tipo = 'avaliacao_baixa' order by id desc limit 1) baixa,
    (select titulo from avisos where tipo = 'sugestao_produto' order by id desc limit 1) sug`)
  ok(av.baixa.includes('Leitor travou') && av.sug.includes('Pilhas'), `avaliação ruim e sugestão viram avisos (${av.baixa} | ${av.sug})`)
  await como(totem, async () => ok((await um(`select count(*)::int n from avisos`)).n === 0, 'totem não lê avisos'))
}

// --- PIX sem internet ---
{
  const agua = await um(`select id, estoque_atual, preco_venda from produtos where nome like 'Água%'`)
  const venda = { txid: 'MAOFFTESTE123', tipo_cliente: 'visitante', apartamento: '999', cpf: '529.982.247-25', criado_em: new Date(Date.now() - 3600_000).toISOString(),
    itens: [{ produto_id: agua.id, quantidade: 2, preco_unitario: agua.preco_venda }] }
  await como(totem, async () => {
    const cfg = await um(`select config_pix_totem() c`)
    ok(cfg.c?.chave === 'pix@mercado-autonomo.exemplo', 'totem lê a chave PIX para usar sem internet')
    const r1 = await um(`select registrar_venda_offline($1::jsonb) r`, [JSON.stringify(venda)])
    const r2 = await um(`select registrar_venda_offline($1::jsonb) r`, [JSON.stringify(venda)])
    ok(r1.r.numero && r2.r.repetida === true && r2.r.numero === r1.r.numero, 'venda offline registrada uma vez (reenvio é ignorado)')
  })
  const v = await um(`select id, status, total, apartamento, offline, conferencia, pago_em from vendas where txid = 'MAOFFTESTE123'`)
  ok(v.status === 'paga' && v.conferencia === 'pendente' && v.apartamento === null && Math.abs(Number(v.total) - 2 * agua.preco_venda) < 0.01,
    `venda offline entra paga e a conferir (${JSON.stringify({ ...v, id: undefined })})`)
  ok((await um(`select estoque_atual from produtos where id = $1`, [agua.id])).estoque_atual === agua.estoque_atual - 2, 'venda offline baixa o estoque')
  ok((await um(`select count(*)::int n from avisos where tipo = 'venda_offline' and referencia_id = $1 and not resolvido`, [v.id])).n === 1, 'venda offline gera aviso para conferir')
  await como(admin, async () => {
    await um(`select conferir_venda_offline($1, false)`, [v.id])
  })
  const c = await um(`select status, conferencia from vendas where id = $1`, [v.id])
  ok(c.status === 'cancelada' && c.conferencia === 'nao_recebido', 'não recebido tira a venda do faturamento')
  ok((await um(`select count(*)::int n from avisos where tipo = 'venda_offline' and referencia_id = $1 and not resolvido`, [v.id])).n === 0, 'conferência resolve o aviso')
  await como(totem, async () => esperaErro(`select conferir_venda_offline(gen_random_uuid(), true)`, 'restrito', 'totem não confere venda offline'))
}

// --- CPF ---
{
  const v = await um(`select cpf_valido('529.982.247-25') a, cpf_valido('52998224724') b, cpf_valido('11111111111') c, cpf_valido('123') d`)
  ok(v.a && !v.b && !v.c && !v.d, 'valida CPF pelos dígitos verificadores')
  await como(totem, async () => {
    const r = await um(`select cadastrar_morador_totem('Sem CPF', '808', null, null, null, '2580', true, '123.456.789-00') r`)
    ok(r.r.erro === 'dados' && /CPF/.test(r.r.mensagem), 'autocadastro exige CPF válido')
    const rep = await um(`select cadastrar_morador_totem('Ana de Novo', '808', null, null, null, '2580', true, '52998224725') r`)
    ok(rep.r.erro === 'dados' && /já tem cadastro/.test(rep.r.mensagem), 'CPF repetido no autocadastro é recusado')
    const off = { txid: 'MAOFFSEMCPF01', tipo_cliente: 'visitante', itens: [{ produto_id: (await um(`select id from catalogo_totem limit 1`)).id, quantidade: 1, preco_unitario: 3 }] }
    await esperaErro(`select registrar_venda_offline('${JSON.stringify(off)}'::jsonb)`, 'CPF', 'venda offline de visitante sem CPF é recusada')
    const offMorador = { ...off, txid: 'MAOFFSEMCPF02', tipo_cliente: 'morador' }
    await esperaErro(`select registrar_venda_offline('${JSON.stringify(offMorador)}'::jsonb)`, 'CPF', 'venda offline de morador sem cadastro sem CPF é recusada')
  })
  await como(admin, async () => {
    await esperaErro(`select salvar_morador(null, 'Sem CPF', '1', null, null, null, true, '1234', null)`, 'CPF inválido', 'cadastro no painel exige CPF')
    await esperaErro(`select salvar_morador(null, 'Repetido', '1', null, null, null, true, '1234', '52998224725')`, 'Já existe', 'cadastro no painel não aceita CPF repetido')
  })
  const vis = await um(`select count(*) filter (where cpf_cliente is not null)::int com, count(*)::int total from vendas where tipo_cliente in ('visitante', 'morador') and status = 'paga' and not offline`)
  ok(vis.com > 0, `vendas de visitante e morador sem cadastro do seed com CPF (${vis.com} de ${vis.total})`)
}

// --- fluxo de pagamento (como o backend faria) ---
const venda = await um(`insert into vendas (metodo, total, custo_total, totem_id) values ('pix', 11.00, 5.20, '${totem}') returning id`)
await db.exec(`insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
  select '${venda.id}', id, nome, 2, preco_venda, preco_custo from produtos where nome like 'Refrigerante%'`)
const pag = await um(`insert into pagamentos (venda_id, totem_id, metodo, valor) values ('${venda.id}', '${totem}', 'pix', 11.00) returning id`)
const antes = await um(`select estoque_atual from produtos where nome like 'Refrigerante%'`)
ok((await um(`select finalizar_pagamento('${pag.id}', 'MP-1') r`)).r === true, 'pagamento aprovado')
ok((await um(`select finalizar_pagamento('${pag.id}', 'MP-1') r`)).r === false, 'webhook repetido é ignorado (idempotente)')
const depois = await um(`select estoque_atual from produtos where nome like 'Refrigerante%'`)
ok(depois.estoque_atual === antes.estoque_atual - 2, 'estoque baixado uma única vez após a confirmação')
ok((await um(`select status from vendas where id='${venda.id}'`)).status === 'paga', 'venda marcada como paga')
ok((await um(`select encerrar_pagamento('${pag.id}', 'expirado') r`)).r === false, 'pagamento aprovado não pode ser expirado')

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
