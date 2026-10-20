-- =====================================================================
-- CPF obrigatório: no cadastro do morador (painel e totem) e para o
-- visitante. Validado pelos dígitos verificadores.
-- Visitante: o CPF fica na venda (vendas.cpf_cliente).
-- =====================================================================

create or replace function public.cpf_valido(p text)
returns boolean language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  soma int;
  dv1 int;
  dv2 int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  soma := 0;
  for i in 1..9 loop soma := soma + substr(d, i, 1)::int * (11 - i); end loop;
  dv1 := (soma * 10) % 11; if dv1 = 10 then dv1 := 0; end if;
  soma := 0;
  for i in 1..10 loop soma := soma + substr(d, i, 1)::int * (12 - i); end loop;
  dv2 := (soma * 10) % 11; if dv2 = 10 then dv2 := 0; end if;
  return dv1 = substr(d, 10, 1)::int and dv2 = substr(d, 11, 1)::int;
end $$;

create or replace function public.so_digitos(p text)
returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

alter table public.moradores add column cpf text check (cpf is null or (cpf ~ '^\d{11}$' and cpf_valido(cpf)));
create unique index moradores_cpf_unico on public.moradores (cpf) where cpf is not null;

alter table public.vendas add column cpf_cliente text check (cpf_cliente is null or (cpf_cliente ~ '^\d{11}$' and cpf_valido(cpf_cliente)));
create index on public.vendas (cpf_cliente) where cpf_cliente is not null;

-- ---------------------------------------------------------------------
-- Cadastro pelo painel: agora com CPF (obrigatório)
-- ---------------------------------------------------------------------
drop function if exists public.salvar_morador(uuid, text, text, text, text, text, boolean, text);

create or replace function public.salvar_morador(
  p_id uuid, p_nome text, p_apartamento text, p_bloco text,
  p_telefone text, p_email text, p_ativo boolean, p_pin text, p_cpf text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid := p_id;
  v_cpf text := so_digitos(p_cpf);
begin
  perform exigir_admin();
  if v_cpf is null or not cpf_valido(v_cpf) then
    raise exception 'CPF inválido' using errcode = 'P0001';
  end if;
  if exists (select 1 from moradores where cpf = v_cpf and id is distinct from v_id) then
    raise exception 'Já existe um morador cadastrado com este CPF' using errcode = 'P0001';
  end if;
  if p_pin is not null and p_pin !~ '^\d{4,6}$' then
    raise exception 'O PIN deve ter de 4 a 6 números' using errcode = 'P0001';
  end if;
  if v_id is null then
    if p_pin is null then
      raise exception 'Defina um PIN para o morador' using errcode = 'P0001';
    end if;
    insert into moradores (nome, apartamento, bloco, telefone, email, ativo, cpf)
    values (trim(p_nome), trim(p_apartamento), nullif(trim(p_bloco), ''), nullif(trim(p_telefone), ''), nullif(trim(p_email), ''), coalesce(p_ativo, true), v_cpf)
    returning id into v_id;
  else
    update moradores
       set nome = trim(p_nome), apartamento = trim(p_apartamento), bloco = nullif(trim(p_bloco), ''),
           telefone = nullif(trim(p_telefone), ''), email = nullif(trim(p_email), ''), ativo = coalesce(p_ativo, true),
           cpf = v_cpf, revisado = true
     where id = v_id;
    if not found then raise exception 'Morador não encontrado'; end if;
  end if;
  if p_pin is not null then
    update moradores set pin_hash = hash_pin(v_id, p_pin), tentativas_falhas = 0, bloqueado_ate = null where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.salvar_morador(uuid, text, text, text, text, text, boolean, text, text) from anon;

-- ---------------------------------------------------------------------
-- Autocadastro no totem: agora com CPF (obrigatório)
-- ---------------------------------------------------------------------
drop function if exists public.cadastrar_morador_totem(text, text, text, text, text, text, boolean);

create or replace function public.cadastrar_morador_totem(
  p_nome text, p_apartamento text, p_bloco text, p_telefone text, p_email text, p_pin text, p_aceite boolean, p_cpf text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_apto     text := normalizar_apto(p_apartamento);
  v_tel      text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_email    text := lower(nullif(trim(p_email), ''));
  v_cpf      text := so_digitos(p_cpf);
  v_id       uuid;
  v_bloqueio timestamptz;
begin
  if not is_operador() then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_nome, ''))) < 3 then
    return json_build_object('erro', 'dados', 'mensagem', 'Informe seu nome.');
  end if;
  if v_cpf is null or not cpf_valido(v_cpf) then
    return json_build_object('erro', 'dados', 'mensagem', 'CPF inválido. Confira os números.');
  end if;
  if v_apto = '' or length(v_apto) > 10 then
    return json_build_object('erro', 'dados', 'mensagem', 'Informe o número do apartamento.');
  end if;
  if v_tel <> '' and length(v_tel) not between 10 and 13 then
    return json_build_object('erro', 'dados', 'mensagem', 'WhatsApp inválido. Use DDD + número.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('erro', 'dados', 'mensagem', 'E-mail inválido.');
  end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then
    return json_build_object('erro', 'dados', 'mensagem', 'O PIN deve ter de 4 a 6 números.');
  end if;
  if not coalesce(p_aceite, false) then
    return json_build_object('erro', 'dados', 'mensagem', 'É preciso autorizar o uso dos dados para concluir o cadastro.');
  end if;
  if exists (select 1 from moradores where cpf = v_cpf) then
    return json_build_object('erro', 'dados', 'mensagem', 'Este CPF já tem cadastro. Use "Usar meu cadastro" ou fale com a administração.');
  end if;

  select max(bloqueado_ate) into v_bloqueio
    from moradores where ativo and normalizar_apto(apartamento) = v_apto and bloqueado_ate > now();
  if v_bloqueio is not null then
    return json_build_object('erro', 'bloqueado', 'minutos', ceil(extract(epoch from v_bloqueio - now()) / 60));
  end if;

  if (select count(*) from moradores
       where origem = 'totem' and normalizar_apto(apartamento) = v_apto and criado_em > now() - interval '1 hour') >= 3 then
    return json_build_object('erro', 'limite');
  end if;

  if exists (select 1 from moradores
              where ativo and pin_hash is not null and normalizar_apto(apartamento) = v_apto
                and pin_hash = hash_pin(id, p_pin)) then
    update moradores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '15 minutes' end
     where ativo and normalizar_apto(apartamento) = v_apto;
    return json_build_object('erro', 'pin_indisponivel');
  end if;

  insert into moradores (nome, apartamento, bloco, telefone, email, cpf, origem, revisado, aceite_em)
  values (trim(p_nome), upper(trim(p_apartamento)), nullif(upper(trim(p_bloco)), ''), nullif(trim(p_telefone), ''), v_email,
          v_cpf, 'totem', false, now())
  returning id into v_id;
  update moradores set pin_hash = hash_pin(v_id, p_pin) where id = v_id;

  return identificar_morador(p_apartamento, p_pin);
end $$;
revoke all on function public.cadastrar_morador_totem(text, text, text, text, text, text, boolean, text) from anon;

-- lista do painel com o CPF (coluna nova no fim)
create or replace view public.moradores_admin with (security_invoker = true) as
  select id, nome, apartamento, bloco, telefone, email, ativo, tentativas_falhas, bloqueado_ate, criado_em,
         (pin_hash is not null) as tem_pin,
         (bloqueado_ate is not null and bloqueado_ate > now()) as bloqueado,
         (select count(*) from vendas v where v.morador_id = m.id and v.status = 'paga') as compras,
         origem, revisado, aceite_em, cpf
    from public.moradores m;

-- ---------------------------------------------------------------------
-- Venda feita sem internet: guarda o CPF do visitante (obrigatório)
-- ---------------------------------------------------------------------
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
  if v_tipo = 'visitante' and v_cpf is null then
    raise exception 'CPF do visitante inválido';
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
