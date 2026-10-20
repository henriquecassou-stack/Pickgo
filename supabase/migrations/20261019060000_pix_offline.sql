-- =====================================================================
-- PIX sem internet (modo offline do totem)
--
-- Sem internet o totem gera um PIX estático com a chave do mercado e o
-- valor exato da compra (BR Code, gerado no próprio aparelho). A venda fica
-- numa fila no totem e é enviada quando a conexão volta. Como o pagamento
-- não pôde ser confirmado pelo provedor, a venda entra como "a conferir":
-- o administrador confere no extrato (pelo identificador/txid) e marca
-- recebido ou não recebido.
-- =====================================================================

create table public.config_pix (
  id             smallint primary key default 1 check (id = 1),
  tipo_chave     text check (tipo_chave in ('cpf', 'cnpj', 'email', 'celular', 'aleatoria')),
  chave          text,                    -- já normalizada
  nome_recebedor text,
  cidade         text,
  offline_ativo  boolean not null default true,
  atualizado_em  timestamptz not null default now()
);
insert into public.config_pix (id) values (1);

alter table public.vendas
  add column offline     boolean not null default false,
  add column txid        text unique,
  add column conferencia text check (conferencia in ('pendente', 'recebido', 'nao_recebido'));
create index on public.vendas (conferencia) where conferencia = 'pendente';

alter type tipo_aviso add value if not exists 'venda_offline';

-- o totem lê a chave (não é segredo: vai impressa no QR) para usar sem internet
create or replace function public.config_pix_totem()
returns json language sql stable security definer set search_path = public as $$
  select case when is_operador() and c.offline_ativo and c.chave is not null
    then json_build_object('chave', c.chave, 'nome', c.nome_recebedor, 'cidade', c.cidade) end
    from config_pix c where id = 1
$$;

-- Recebe uma venda feita sem internet. Idempotente pelo txid (o totem
-- pode reenviar a mesma venda se a conexão cair no meio do envio).
create or replace function public.registrar_venda_offline(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_existente vendas%rowtype;
  v_venda     uuid;
  v_numero    bigint;
  v_pag       uuid;
  v_total     numeric := 0;
  v_custo     numeric := 0;
  v_item      jsonb;
  v_prod      produtos%rowtype;
  v_qtd       int;
  v_preco     numeric;
  v_quando    timestamptz := coalesce((p ->> 'criado_em')::timestamptz, now());
  v_tipo      tipo_cliente := coalesce((p ->> 'tipo_cliente')::tipo_cliente, 'morador');
  v_apto      text := case when v_tipo = 'visitante' then null else nullif(left(trim(p ->> 'apartamento'), 20), '') end;
begin
  if not is_operador() then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;
  if coalesce(p ->> 'txid', '') !~ '^[A-Za-z0-9]{6,25}$' then
    raise exception 'txid inválido';
  end if;

  select * into v_existente from vendas where txid = p ->> 'txid';
  if found then
    return json_build_object('numero', v_existente.numero, 'repetida', true);
  end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]')) = 0 then
    raise exception 'Venda offline sem itens';
  end if;

  -- o preço é o que o cliente viu e pagou (catálogo guardado no totem);
  -- o custo vem do banco para o lucro bruto
  for v_item in select * from jsonb_array_elements(p -> 'itens') loop
    select * into v_prod from produtos where id = (v_item ->> 'produto_id')::uuid;
    if not found then raise exception 'Produto % não encontrado', v_item ->> 'produto_id'; end if;
    v_qtd := (v_item ->> 'quantidade')::int;
    v_preco := round((v_item ->> 'preco_unitario')::numeric, 2);
    if v_qtd is null or v_qtd < 1 or v_preco is null or v_preco <= 0 then raise exception 'Item inválido'; end if;
    v_total := v_total + v_qtd * v_preco;
    v_custo := v_custo + v_qtd * v_prod.preco_custo;
  end loop;

  insert into vendas (metodo, apartamento, tipo_cliente, total, custo_total, totem_id, criado_em, offline, txid, conferencia)
  values ('pix', v_apto, v_tipo, v_total, v_custo, auth.uid(), v_quando, true, p ->> 'txid', 'pendente')
  returning id, numero into v_venda, v_numero;

  insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
  select v_venda, pr.id, pr.nome, (i ->> 'quantidade')::int, round((i ->> 'preco_unitario')::numeric, 2), pr.preco_custo
    from jsonb_array_elements(p -> 'itens') i join produtos pr on pr.id = (i ->> 'produto_id')::uuid;

  insert into pagamentos (venda_id, totem_id, provedor, metodo, valor, id_externo, expira_em, criado_em)
  values (v_venda, auth.uid(), 'pix_offline', 'pix', v_total, p ->> 'txid', v_quando + interval '1 day', v_quando)
  returning id into v_pag;

  -- baixa o estoque (o produto já saiu da loja) e marca a venda como paga
  perform finalizar_pagamento(v_pag, p ->> 'txid', jsonb_build_object('offline', true));
  update vendas set pago_em = v_quando where id = v_venda;

  if avisos_ligados() then
    perform abrir_aviso('venda_offline', 'atencao', 'PIX sem internet a conferir: compra #' || v_numero,
      'Compra de R$ ' || replace(trim(to_char(v_total, '99999990.00')), '.', ',') || ' paga por PIX enquanto o totem estava sem internet ('
      || to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '). Confira no extrato o identificador '
      || (p ->> 'txid') || '.', '/admin/pix', v_venda::text, false);
  end if;

  return json_build_object('numero', v_numero, 'repetida', false);
end $$;

-- Conferência pelo administrador. "Não recebido" tira a venda do faturamento
-- (status cancelada); o estoque não volta, porque o produto saiu da loja.
create or replace function public.conferir_venda_offline(p_venda_id uuid, p_recebido boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  update vendas
     set conferencia = case when p_recebido then 'recebido' else 'nao_recebido' end,
         status = case when p_recebido then 'paga'::status_venda else 'cancelada'::status_venda end
   where id = p_venda_id and offline;
  if not found then raise exception 'Venda offline não encontrada'; end if;
  update pagamentos
     set status = case when p_recebido then 'aprovado'::status_pagamento else 'cancelado'::status_pagamento end,
         motivo_recusa = case when p_recebido then null else 'PIX offline não encontrado no extrato' end,
         atualizado_em = now()
   where venda_id = p_venda_id;
  perform resolver_avisos(p_venda_id::text, '{venda_offline}');
end $$;

alter table public.config_pix enable row level security;
create policy config_pix_admin on public.config_pix for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.registrar_venda_offline(jsonb) from anon;
revoke all on function public.conferir_venda_offline(uuid, boolean) from anon;
revoke all on function public.config_pix_totem() from anon;
