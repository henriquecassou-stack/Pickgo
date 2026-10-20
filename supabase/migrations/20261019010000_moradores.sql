-- =====================================================================
-- Moradores cadastrados e tipo de cliente da venda
--
-- No totem, o cliente escolhe: visitante, morador sem cadastro ou morador
-- com cadastro (identificado por apartamento + PIN de 4 a 6 dígitos).
-- O PIN nunca é guardado em texto: só o hash. Após 5 erros seguidos o
-- apartamento fica bloqueado por 15 minutos.
-- =====================================================================

create type tipo_cliente as enum ('visitante', 'morador', 'morador_cadastrado');

create table public.moradores (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null check (length(trim(nome)) > 0),
  apartamento        text not null check (length(trim(apartamento)) > 0),
  bloco              text,
  telefone           text,
  email              text,
  pin_hash           text,
  ativo              boolean not null default true,
  tentativas_falhas  integer not null default 0,
  bloqueado_ate      timestamptz,
  criado_em          timestamptz not null default now()
);
create index on public.moradores (upper(apartamento));

alter table public.vendas
  add column tipo_cliente tipo_cliente not null default 'morador',
  add column morador_id   uuid references public.moradores (id);
create index on public.vendas (morador_id);

create or replace function public.normalizar_apto(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s\-/.]', '', 'g'))
$$;

create or replace function public.hash_pin(p_id uuid, p_pin text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_id::text || ':' || p_pin, 'UTF8')), 'hex')
$$;

-- Cadastro/edição pelo administrador. p_pin nulo na edição = mantém o atual.
create or replace function public.salvar_morador(
  p_id uuid, p_nome text, p_apartamento text, p_bloco text,
  p_telefone text, p_email text, p_ativo boolean, p_pin text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  perform exigir_admin();
  if p_pin is not null and p_pin !~ '^\d{4,6}$' then
    raise exception 'O PIN deve ter de 4 a 6 números' using errcode = 'P0001';
  end if;
  if v_id is null then
    if p_pin is null then
      raise exception 'Defina um PIN para o morador' using errcode = 'P0001';
    end if;
    insert into moradores (nome, apartamento, bloco, telefone, email, ativo)
    values (trim(p_nome), trim(p_apartamento), nullif(trim(p_bloco), ''), nullif(trim(p_telefone), ''), nullif(trim(p_email), ''), coalesce(p_ativo, true))
    returning id into v_id;
  else
    update moradores
       set nome = trim(p_nome), apartamento = trim(p_apartamento), bloco = nullif(trim(p_bloco), ''),
           telefone = nullif(trim(p_telefone), ''), email = nullif(trim(p_email), ''), ativo = coalesce(p_ativo, true)
     where id = v_id;
    if not found then raise exception 'Morador não encontrado'; end if;
  end if;
  if p_pin is not null then
    update moradores set pin_hash = hash_pin(v_id, p_pin), tentativas_falhas = 0, bloqueado_ate = null where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.desbloquear_morador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  update moradores set tentativas_falhas = 0, bloqueado_ate = null where id = p_id;
end $$;

-- Identificação no totem. Devolve JSON com "erro" em vez de lançar exceção,
-- para que o contador de tentativas erradas não seja desfeito (rollback).
create or replace function public.identificar_morador(p_apartamento text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_apto      text := normalizar_apto(p_apartamento);
  v_m         moradores%rowtype;
  v_bloqueio  timestamptz;
  v_digitos   text;
begin
  if not is_operador() then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  select max(bloqueado_ate) into v_bloqueio
    from moradores where ativo and normalizar_apto(apartamento) = v_apto and bloqueado_ate > now();
  if v_bloqueio is not null then
    return json_build_object('erro', 'bloqueado', 'minutos', ceil(extract(epoch from v_bloqueio - now()) / 60));
  end if;

  select * into v_m from moradores
   where ativo and pin_hash is not null and normalizar_apto(apartamento) = v_apto
     and pin_hash = hash_pin(id, coalesce(p_pin, ''))
   limit 1;

  if not found then
    update moradores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '15 minutes' end
     where ativo and normalizar_apto(apartamento) = v_apto;
    return json_build_object('erro', 'credenciais');
  end if;

  update moradores set tentativas_falhas = 0, bloqueado_ate = null where id = v_m.id;
  v_digitos := regexp_replace(coalesce(v_m.telefone, ''), '\D', '', 'g');
  return json_build_object(
    'id', v_m.id,
    'nome', split_part(v_m.nome, ' ', 1),
    'apartamento', v_m.apartamento,
    'bloco', v_m.bloco,
    'telefone_mascarado', case when length(v_digitos) >= 8 then '•••• ' || right(v_digitos, 4) end,
    'email_mascarado', case when v_m.email like '%@%' then left(v_m.email, 1) || '•••@' || split_part(v_m.email, '@', 2) end
  );
end $$;

revoke all on function public.salvar_morador(uuid, text, text, text, text, text, boolean, text) from anon;
revoke all on function public.desbloquear_morador(uuid) from anon;
revoke all on function public.identificar_morador(text, text) from anon;

-- Lista do painel (sem o hash do PIN)
create view public.moradores_admin with (security_invoker = true) as
  select id, nome, apartamento, bloco, telefone, email, ativo, tentativas_falhas, bloqueado_ate, criado_em,
         (pin_hash is not null) as tem_pin,
         (bloqueado_ate is not null and bloqueado_ate > now()) as bloqueado,
         (select count(*) from vendas v where v.morador_id = m.id and v.status = 'paga') as compras
    from public.moradores m;

alter table public.moradores enable row level security;
create policy moradores_admin_ler on public.moradores for select to authenticated using (public.is_admin());
create policy moradores_admin_editar on public.moradores for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.moradores_admin to authenticated;
revoke all on public.moradores_admin from anon;

-- Dashboard: faturamento por tipo de cliente
create or replace function public.dashboard_clientes(p_inicio date, p_fim date)
returns table (tipo_cliente tipo_cliente, vendas bigint, faturamento numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform exigir_admin();
  return query
  select v.tipo_cliente, count(*)::bigint, sum(v.total)
    from vendas v
   where v.status = 'paga'
     and (v.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
   group by v.tipo_cliente
   order by 3 desc;
end $$;
