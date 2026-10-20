-- =====================================================================
-- Kit inicial para testar o totem num banco novo: 7 categorias e os 20
-- produtos de exemplo com estoque inicial. Sem vendas, moradores ou
-- avaliações fictícias, então o dashboard mostra só as vendas reais.
-- Os códigos de barras são fictícios: troque pelos dos seus produtos
-- (Painel → Produtos) ou desative os que não usar.
--   npx supabase db query --linked -f supabase/produtos-iniciais.sql
-- =====================================================================
select set_config('app.sem_avisos', 'on', false);

insert into public.categorias (nome, icone, cor, ordem) values
  ('Bebidas',     'cup-soda',   '#0ea5e9', 1),
  ('Snacks',      'cookie',     '#f59e0b', 2),
  ('Mercearia',   'wheat',      '#a16207', 3),
  ('Laticínios',  'milk',       '#6366f1', 4),
  ('Congelados',  'snowflake',  '#06b6d4', 5),
  ('Limpeza',     'spray-can',  '#10b981', 6),
  ('Higiene',     'bath',       '#ec4899', 7);

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
    ('Pão de forma 500 g',             'Mercearia',  '7891000000123', 5.90, 10.90, 5, 30),
    ('Leite integral 1 L',             'Laticínios', '7891000000130', 4.10, 6.90, 12, 60),
    ('Iogurte natural 170 g',          'Laticínios', '7891000000147', 2.20, 4.90, 8, 30),
    ('Pizza congelada muçarela',       'Congelados', '7891000000154', 12.50, 24.90, 4, 90),
    ('Sorvete pote 1,5 L',             'Congelados', '7891000000161', 14.00, 29.90, 3, 180),
    ('Detergente 500 ml',              'Limpeza',    '7891000000178', 1.90, 3.90, 6, null),
    ('Esponja multiuso (3 un.)',       'Limpeza',    '7891000000185', 2.80, 6.50, 4, null),
    ('Papel higiênico (4 rolos)',      'Higiene',    '7891000000192', 6.90, 13.90, 5, null),
    ('Creme dental 90 g',              'Higiene',    '7891000000208', 3.10, 6.90, 5, 400)
  ) as x(nome, categoria, ean, custo, venda, minimo, dias_validade)
  join public.categorias c on c.nome = x.categoria;

-- estoque inicial: sempre por movimentação (o saldo nunca é definido direto)
insert into public.movimentacoes_estoque (produto_id, tipo, motivo, quantidade, custo_unitario, observacao)
select id, 'entrada', 'ajuste_entrada', estoque_minimo * 3, preco_custo, 'Estoque inicial de teste'
  from public.produtos;

select set_config('app.sem_avisos', 'off', false);
select public.verificar_avisos();
