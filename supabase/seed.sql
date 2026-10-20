-- =====================================================================
-- Dados de exemplo: 7 categorias, 4 fornecedores, 20 produtos e
-- 60 dias de vendas pagas (com as movimentações de estoque coerentes).
-- Tudo passa pelos mesmos triggers da aplicação: o saldo de cada produto
-- é resultado das movimentações, nunca definido diretamente.
-- =====================================================================

-- durante a carga em massa os avisos ficam desligados; no fim é feita uma varredura
select set_config('app.sem_avisos', 'on', false);

insert into public.categorias (nome, icone, cor, ordem) values
  ('Bebidas',     'cup-soda',   '#0ea5e9', 1),
  ('Snacks',      'cookie',     '#f59e0b', 2),
  ('Mercearia',   'wheat',      '#a16207', 3),
  ('Laticínios',  'milk',       '#6366f1', 4),
  ('Congelados',  'snowflake',  '#06b6d4', 5),
  ('Limpeza',     'spray-can',  '#10b981', 6),
  ('Higiene',     'bath',       '#ec4899', 7);

insert into public.fornecedores (nome, cnpj, telefone, email, contato) values
  ('Distribuidora Bom Preço',  '12.345.678/0001-90', '(11) 4000-1000', 'pedidos@bompreco.exemplo',  'Carla'),
  ('Atacadão do Bairro',       '23.456.789/0001-01', '(11) 4000-2000', 'vendas@atacadao.exemplo',   'Rogério'),
  ('Frios & Gelados Ltda',     '34.567.890/0001-12', '(11) 4000-3000', 'contato@friosgelados.exemplo', 'Patrícia'),
  ('Casa Limpa Distribuição',  '45.678.901/0001-23', '(11) 4000-4000', 'comercial@casalimpa.exemplo', 'Marcos');

-- validade relativa à data de hoje para que sempre existam alertas
insert into public.produtos (nome, categoria_id, codigo_barras, preco_custo, preco_venda, estoque_minimo, validade)
select x.nome, c.id, x.ean, x.custo, x.venda, x.minimo,
       case when x.dias_validade is null then null else current_date + x.dias_validade end
  from (values
    ('Água mineral 500 ml',            'Bebidas',    '7891000000017', 0.95, 3.00, 24, 300),
    ('Refrigerante cola lata 350 ml',  'Bebidas',    '7891000000024', 2.60, 5.50, 18, 180),
    ('Suco de uva integral 1 L',       'Bebidas',    '7891000000031', 7.90, 14.90, 6, 200),
    ('Cerveja pilsen lata 350 ml',     'Bebidas',    '7891000000048', 2.90, 5.90, 24, 150),
    ('Energético 250 ml',              'Bebidas',    '7891000000055', 5.20, 10.90, 8, 240),
    ('Batata chips 90 g',              'Snacks',     '7891000000062', 5.10, 9.90, 8, 120),
    ('Chocolate ao leite 90 g',        'Snacks',     '7891000000079', 4.30, 8.50, 10, 160),
    ('Biscoito recheado 130 g',        'Snacks',     '7891000000086', 2.10, 4.50, 10, 110),
    ('Barra de cereal',                'Snacks',     '7891000000093', 1.40, 3.50, 12, 90),
    ('Café torrado 500 g',             'Mercearia',  '7891000000109', 15.90, 27.90, 4, 250),
    ('Macarrão espaguete 500 g',       'Mercearia',  '7891000000116', 3.20, 6.90, 6, 365),
    ('Pão de forma 500 g',             'Mercearia',  '7891000000123', 5.90, 10.90, 5, 5),
    ('Leite integral 1 L',             'Laticínios', '7891000000130', 4.10, 6.90, 12, 60),
    ('Iogurte natural 170 g',          'Laticínios', '7891000000147', 2.20, 4.90, 8, 3),
    ('Pizza congelada muçarela',       'Congelados', '7891000000154', 12.50, 24.90, 4, 90),
    ('Sorvete pote 1,5 L',             'Congelados', '7891000000161', 14.00, 29.90, 3, 180),
    ('Detergente 500 ml',              'Limpeza',    '7891000000178', 1.90, 3.90, 6, null),
    ('Esponja multiuso (3 un.)',       'Limpeza',    '7891000000185', 2.80, 6.50, 4, null),
    ('Papel higiênico (4 rolos)',      'Higiene',    '7891000000192', 6.90, 13.90, 5, null),
    ('Creme dental 90 g',              'Higiene',    '7891000000208', 3.10, 6.90, 5, 400)
  ) as x(nome, categoria, ean, custo, venda, minimo, dias_validade)
  join public.categorias c on c.nome = x.categoria;

-- moradores cadastrados (PIN de exemplo: 1234 para todos)
insert into public.moradores (nome, apartamento, bloco, telefone, email) values
  ('Ana Ribeiro',      '101', 'A', '(11) 98888-1010', 'ana.ribeiro@exemplo.com'),
  ('Bruno Carvalho',   '102', 'A', '(11) 98888-1020', null),
  ('Carla Mendes',     '204', 'A', null,              'carla.mendes@exemplo.com'),
  ('Diego Fernandes',  '301', 'B', '(11) 98888-3010', 'diego.f@exemplo.com'),
  ('Elisa Martins',    '302', 'B', '(11) 98888-3020', null),
  ('Fábio Souza',      '503', 'B', '(11) 98888-5030', 'fabio.souza@exemplo.com'),
  ('Gabriela Lima',    '702', 'A', null,              'gabi.lima@exemplo.com'),
  ('Henrique Alves',   '1104', 'B', '(11) 98888-1104', null);
update public.moradores set pin_hash = public.hash_pin(id, '1234');

do $$
declare
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dia       date;
  v_idx       int := 0;
  v_n         int;
  v_hora      timestamptz;
  v_venda     uuid;
  v_metodo    metodo_pagamento;
  v_total     numeric;
  v_custo     numeric;
  v_qtd_itens int;
  v_item      record;
  v_prod      record;
  v_alvo      int;
  v_r         float8;
  v_tipo      tipo_cliente;
  v_morador   uuid;
  v_apto      text;
begin
  perform setseed(0.42);

  -- popularidade de cada produto (peso do sorteio)
  create temp table seed_peso on commit drop as
  select id as produto_id,
         case
           when nome like 'Água%'        then 10
           when nome like 'Refrigerante%' then 8
           when nome like 'Cerveja%'     then 7
           when nome like 'Chocolate%'   then 6
           when nome like 'Leite%'       then 6
           when nome like 'Batata%'      then 5
           when nome like 'Biscoito%'    then 5
           when nome like 'Barra%'       then 4
           when nome like 'Pão%'         then 4
           when nome like 'Energético%'  then 4
           when nome like 'Iogurte%'     then 4
           when nome like 'Pizza%'       then 3
           when nome like 'Café%'        then 3
           when nome like 'Sorvete%'     then 2
           else 1.5
         end::numeric as peso,
         -- dois produtos ficam sem reposição na última semana (alerta de estoque baixo)
         (nome like 'Chocolate%' or nome like 'Batata%') as sem_reposicao_final
    from produtos;

  -- estoque inicial (61 dias atrás)
  for v_prod in select p.*, (select id from fornecedores order by id limit 1 offset (abs(hashtext(p.nome)) % 4)) as forn from produtos p loop
    insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, fornecedor_id, data_movimentacao, observacao, usuario_id)
    values (v_prod.id, 'entrada', 'reposicao', v_prod.estoque_minimo * 4 + 20, v_prod.preco_custo, v_prod.forn,
            ((v_hoje - 61) + time '09:00') at time zone 'America/Sao_Paulo', 'Estoque inicial', null);
  end loop;

  for v_dia in select generate_series(v_hoje - 59, v_hoje, interval '1 day')::date loop
    v_idx := v_idx + 1;

    -- reposição da manhã: quem está perto do mínimo volta ao nível alvo
    for v_prod in
      select p.*, sp.sem_reposicao_final,
             (select id from fornecedores order by id limit 1 offset (abs(hashtext(p.nome)) % 4)) as forn
        from produtos p join seed_peso sp on sp.produto_id = p.id
    loop
      continue when v_prod.sem_reposicao_final and v_dia > v_hoje - 7;
      if v_prod.estoque_atual <= ceil(v_prod.estoque_minimo * 1.6) then
        v_alvo := v_prod.estoque_minimo * 4 + 20;
        insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, fornecedor_id, data_movimentacao, observacao, usuario_id)
        values (v_prod.id, 'entrada', 'reposicao', v_alvo - greatest(v_prod.estoque_atual, 0),
                round(v_prod.preco_custo * (0.97 + random() * 0.06)::numeric, 2), v_prod.forn,
                (v_dia + time '08:00' + make_interval(mins => floor(random() * 50)::int)) at time zone 'America/Sao_Paulo',
                'Reposição semanal', null);
      end if;
    end loop;

    -- número de vendas: cresce ao longo do período, mais no fim de semana
    v_n := 7 + floor(random() * 8)::int + (v_idx / 8)
           + case when extract(isodow from v_dia) in (5, 6, 7) then 6 else 0 end;

    for v_hora in
      select h from (
        select ((v_dia + time '07:00') + make_interval(mins => floor(random() * 16 * 60)::int)) at time zone 'America/Sao_Paulo' as h
          from generate_series(1, v_n)
      ) s where h < now() order by h
    loop
      v_metodo := case when random() < 0.62 then 'pix'
                       when random() < 0.55 then 'cartao_debito'
                       else 'cartao_credito' end::metodo_pagamento;
      v_qtd_itens := 1 + floor(random() * random() * 4)::int;

      create temp table if not exists seed_carrinho (produto_id uuid, nome text, qtd int, preco numeric, custo numeric) on commit drop;
      truncate seed_carrinho;
      insert into seed_carrinho
      select p.id, p.nome, case when random() < 0.18 then 2 else 1 end, p.preco_venda, p.preco_custo
        from produtos p join seed_peso sp on sp.produto_id = p.id
       order by -ln(random()) / sp.peso
       limit v_qtd_itens;

      select sum(qtd * preco), sum(qtd * custo) into v_total, v_custo from seed_carrinho;

      -- quem comprou: morador cadastrado, morador sem cadastro ou visitante
      v_r := random();
      v_morador := null;
      v_apto := null;
      if v_r < 0.40 then
        v_tipo := 'morador_cadastrado';
        select id, apartamento into v_morador, v_apto from moradores order by random() limit 1;
      elsif v_r < 0.78 then
        v_tipo := 'morador';
        if random() < 0.5 then v_apto := (1 + floor(random() * 12))::int || lpad((1 + floor(random() * 4))::int::text, 2, '0'); end if;
      else
        v_tipo := 'visitante';
      end if;

      insert into vendas (status, metodo, tipo_cliente, morador_id, apartamento, total, custo_total, criado_em, pago_em)
      values ('paga', v_metodo, v_tipo, v_morador, v_apto, v_total, v_custo, v_hora, v_hora + interval '35 seconds')
      returning id into v_venda;

      insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
      select v_venda, produto_id, nome, qtd, preco, custo from seed_carrinho;

      insert into pagamentos (venda_id, provedor, metodo, status, valor, id_externo, expira_em, criado_em, atualizado_em, aprovado_em)
      values (v_venda, 'simulado', v_metodo, 'aprovado', v_total, 'SEED-' || substr(v_venda::text, 1, 8),
              v_hora + interval '5 minutes', v_hora, v_hora + interval '35 seconds', v_hora + interval '35 seconds');

      for v_item in select * from seed_carrinho loop
        insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, venda_id, data_movimentacao, observacao, usuario_id)
        values (v_item.produto_id, 'saida', 'venda', v_item.qtd, v_item.custo, v_venda, v_hora + interval '35 seconds',
                'Venda #' || (select numero from vendas where id = v_venda), null);
      end loop;
    end loop;

    -- algumas saídas manuais para o histórico
    if v_idx % 9 = 0 then
      select p.* into v_prod from produtos p where p.estoque_atual > 2 order by random() limit 1;
      insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, data_movimentacao, observacao, usuario_id)
      values (v_prod.id, 'saida',
              (array['avariado', 'perda', 'consumo_interno', 'vencido'])[1 + (v_idx / 9) % 4]::motivo_movimentacao,
              1, (v_dia + time '21:30') at time zone 'America/Sao_Paulo', 'Conferência de prateleira', null);
    end if;
  end loop;

  -- os dois produtos sem reposição recente terminam abaixo do mínimo
  -- (descarte registrado como saída, mantendo o saldo coerente)
  for v_prod in
    select p.* from produtos p join seed_peso sp on sp.produto_id = p.id
     where sp.sem_reposicao_final and p.estoque_atual > ceil(p.estoque_minimo / 2.0)
  loop
    insert into movimentacoes_estoque (produto_id, tipo, motivo, quantidade, data_movimentacao, observacao, usuario_id)
    values (v_prod.id, 'saida', 'avariado', v_prod.estoque_atual - ceil(v_prod.estoque_minimo / 2.0)::int, now(),
            'Lote danificado no transporte — descartado', null);
  end loop;

  -- uma venda recusada e uma expirada recentes (aparecem no histórico de vendas)
  insert into vendas (status, metodo, total, custo_total, criado_em)
  select 'recusada', 'cartao_credito', preco_venda, preco_custo, now() - interval '3 hours' from produtos where nome like 'Sorvete%'
  returning id into v_venda;
  insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
  select v_venda, id, nome, 1, preco_venda, preco_custo from produtos where nome like 'Sorvete%';
  insert into pagamentos (venda_id, provedor, metodo, status, valor, motivo_recusa, expira_em, criado_em)
  select v_venda, 'simulado', 'cartao_credito', 'recusado', total, 'Saldo insuficiente', criado_em + interval '5 minutes', criado_em from vendas where id = v_venda;

  insert into vendas (status, metodo, total, custo_total, criado_em)
  select 'expirada', 'pix', preco_venda * 2, preco_custo * 2, now() - interval '90 minutes' from produtos where nome like 'Cerveja%'
  returning id into v_venda;
  insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
  select v_venda, id, nome, 2, preco_venda, preco_custo from produtos where nome like 'Cerveja%';
  insert into pagamentos (venda_id, provedor, metodo, status, valor, motivo_recusa, expira_em, criado_em)
  select v_venda, 'simulado', 'pix', 'expirado', total, 'QR Code expirado', criado_em + interval '5 minutes', criado_em from vendas where id = v_venda;
end $$;

-- avaliações de exemplo (cerca de 30% das compras pagas, maioria positiva)
select setseed(0.7);
insert into public.avaliacoes (venda_id, nota, comentario, tipo_cliente, morador_id, lida, criado_em, atualizado_em)
select id, nota,
       case when random() < 0.4 then
         case nota
           when 5 then (array['Muito prático, adorei!', 'Rápido e fácil de pagar.', 'Ótimo ter isso no prédio.', 'Salvou minha noite!'])[1 + floor(random() * 4)::int]
           when 4 then (array['Bom, mas poderia ter mais opções de congelados.', 'Gostei, só o PIX demorou um pouco.', 'Muito bom, sentiria falta de frutas.'])[1 + floor(random() * 3)::int]
           when 3 then (array['Faltou o produto que eu queria.', 'Preços um pouco altos.', 'Ok, mas a geladeira poderia estar mais cheia.'])[1 + floor(random() * 3)::int]
           when 2 then (array['A geladeira estava desorganizada.', 'O leitor demorou para ler o código.'])[1 + floor(random() * 2)::int]
           else (array['Produto vencido na prateleira.', 'Não consegui pagar com cartão.'])[1 + floor(random() * 2)::int]
         end
       end,
       tipo_cliente, morador_id, pago_em < now() - interval '2 days', pago_em + interval '20 seconds', pago_em + interval '20 seconds'
  from (
    select v.*, case when r < 0.55 then 5 when r < 0.82 then 4 when r < 0.92 then 3 when r < 0.97 then 2 else 1 end as nota
      from (select *, random() as r, random() as sorteio from public.vendas where status = 'paga') v
     where sorteio < 0.3
  ) s;

-- sugestões de produtos em parte das avaliações de exemplo
select setseed(0.9);
update public.avaliacoes
   set sugestao = (array['Frutas', 'Pão de queijo congelado', 'Água com gás', 'Pilhas AA', 'Ração para gato', 'Café em cápsula', 'frutas', 'Água com gás', 'Gelo'])[1 + floor(random() * 9)::int]
 where random() < 0.18;

-- religa os avisos e gera os da situação atual (estoque, validade, avaliações recentes)
select set_config('app.sem_avisos', 'off', false);
select public.verificar_avisos();
update public.avaliacoes set nota = nota where nota <= 2 and criado_em > now() - interval '3 days';
select public.abrir_aviso('sugestao_produto', 'info', 'Sugestão de produto: ' || a.sugestao,
       coalesce(m.nome, case a.tipo_cliente when 'visitante' then 'Visitante' else 'Morador' end) || ' gostaria de encontrar “' || a.sugestao || '” no mercado.',
       '/admin/avaliacoes', a.id::text, true)
  from public.avaliacoes a left join public.moradores m on m.id = a.morador_id
 where a.sugestao is not null and a.criado_em > now() - interval '3 days';
update public.avisos av set criado_em = a.criado_em
  from public.avaliacoes a where av.referencia_id = a.id::text and av.tipo in ('avaliacao_baixa', 'sugestao_produto');

-- chave PIX de EXEMPLO para o modo sem internet (troque em Painel → PIX sem internet)
update public.config_pix
   set tipo_chave = 'email', chave = 'pix@mercado-autonomo.exemplo', nome_recebedor = 'Mercado Autonomo', cidade = 'Sao Paulo'
 where id = 1;

-- CPFs de EXEMPLO (válidos só no cálculo; não pertencem a ninguém)
update public.moradores m set cpf = x.cpf
  from (values ('Ana Ribeiro', '52998224725'), ('Bruno Carvalho', '11144477735'), ('Carla Mendes', '39053344705'),
               ('Diego Fernandes', '12345678909'), ('Elisa Martins', '98765432100'), ('Fábio Souza', '45317828791'),
               ('Gabriela Lima', '24681357928'), ('Henrique Alves', '13579246828')) as x(nome, cpf)
 where m.nome = x.nome;

-- visitantes e moradores sem cadastro das vendas de exemplo recebem CPFs gerados (dígitos verificadores válidos)
create or replace function pg_temp.cpf_exemplo(n int) returns text language plpgsql as $$
declare
  base text := lpad(((n * 7919 + 104729) % 999999999)::text, 9, '1');
  s int; d1 int; d2 int;
begin
  s := 0; for i in 1..9 loop s := s + substr(base, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  base := base || d1; s := 0;
  for i in 1..10 loop s := s + substr(base, i, 1)::int * (12 - i); end loop;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return base || d2;
end $$;
update public.vendas set cpf_cliente = pg_temp.cpf_exemplo(numero::int % 40)
 where tipo_cliente in ('visitante', 'morador') and public.cpf_valido(pg_temp.cpf_exemplo(numero::int % 40));
