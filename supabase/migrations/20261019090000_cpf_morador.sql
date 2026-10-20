-- =====================================================================
-- CPF obrigatório também para o morador SEM cadastro (além do visitante).
-- O morador cadastrado já é identificado pelo apartamento + PIN.
-- =====================================================================

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
  v_cpf       text := so_digitos(p ->> 'cpf');
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
  if v_cpf is not null and not cpf_valido(v_cpf) then v_cpf := null; end if;
  -- visitante e morador sem cadastro informam o CPF (o cadastrado já é identificado)
  if v_tipo in ('visitante', 'morador') and v_cpf is null then
    raise exception 'CPF do cliente inválido';
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'itens') loop
    select * into v_prod from produtos where id = (v_item ->> 'produto_id')::uuid;
    if not found then raise exception 'Produto % não encontrado', v_item ->> 'produto_id'; end if;
    v_qtd := (v_item ->> 'quantidade')::int;
    v_preco := round((v_item ->> 'preco_unitario')::numeric, 2);
    if v_qtd is null or v_qtd < 1 or v_preco is null or v_preco <= 0 then raise exception 'Item inválido'; end if;
    v_total := v_total + v_qtd * v_preco;
    v_custo := v_custo + v_qtd * v_prod.preco_custo;
  end loop;

  insert into vendas (metodo, apartamento, tipo_cliente, cpf_cliente, total, custo_total, totem_id, criado_em, offline, txid, conferencia)
  values ('pix', v_apto, v_tipo, v_cpf, v_total, v_custo, auth.uid(), v_quando, true, p ->> 'txid', 'pendente')
  returning id, numero into v_venda, v_numero;

  insert into itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, custo_unitario)
  select v_venda, pr.id, pr.nome, (i ->> 'quantidade')::int, round((i ->> 'preco_unitario')::numeric, 2), pr.preco_custo
    from jsonb_array_elements(p -> 'itens') i join produtos pr on pr.id = (i ->> 'produto_id')::uuid;

  insert into pagamentos (venda_id, totem_id, provedor, metodo, valor, id_externo, expira_em, criado_em)
  values (v_venda, auth.uid(), 'pix_offline', 'pix', v_total, p ->> 'txid', v_quando + interval '1 day', v_quando)
  returning id into v_pag;

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

