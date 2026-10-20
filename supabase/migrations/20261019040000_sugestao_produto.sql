-- =====================================================================
-- Avaliação: segunda caixa "algum produto que você gostaria que tivéssemos?"
-- Fica separada da observação para o painel agrupar os produtos mais pedidos.
-- =====================================================================

alter table public.avaliacoes
  add column sugestao text check (length(sugestao) <= 200);

drop function if exists public.avaliar_venda(uuid, int, text);

create or replace function public.avaliar_venda(
  p_venda_id uuid, p_nota int, p_comentario text default null, p_sugestao text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_venda      vendas%rowtype;
  v_comentario text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
  v_sugestao   text := nullif(left(trim(coalesce(p_sugestao, '')), 200), '');
begin
  if not is_operador() then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;
  if p_nota is null or p_nota not between 1 and 5 then
    return json_build_object('erro', 'A nota deve ser de 1 a 5 estrelas.');
  end if;

  select * into v_venda from vendas where id = p_venda_id;
  if not found or v_venda.status <> 'paga' then
    return json_build_object('erro', 'Compra não encontrada.');
  end if;
  if not is_admin() and v_venda.totem_id is distinct from auth.uid() then
    return json_build_object('erro', 'Compra de outro totem.');
  end if;
  if v_venda.pago_em < now() - interval '30 minutes' then
    return json_build_object('erro', 'O prazo para avaliar esta compra terminou.');
  end if;

  insert into avaliacoes (venda_id, nota, comentario, sugestao, tipo_cliente, morador_id)
  values (p_venda_id, p_nota, v_comentario, v_sugestao, v_venda.tipo_cliente, v_venda.morador_id)
  on conflict (venda_id) do update
     set nota = excluded.nota,
         comentario = coalesce(excluded.comentario, avaliacoes.comentario),
         sugestao = coalesce(excluded.sugestao, avaliacoes.sugestao),
         atualizado_em = now();

  return json_build_object('ok', true);
end $$;

revoke all on function public.avaliar_venda(uuid, int, text, text) from anon;

-- a view usa a.*: precisa ser recriada para incluir a nova coluna
drop view public.avaliacoes_detalhadas;
create view public.avaliacoes_detalhadas with (security_invoker = true) as
  select a.*, v.numero as venda_numero, v.total as venda_total, m.nome as morador_nome
    from public.avaliacoes a
    join public.vendas v on v.id = a.venda_id
    left join public.moradores m on m.id = a.morador_id;
grant select on public.avaliacoes_detalhadas to authenticated;
revoke all on public.avaliacoes_detalhadas from anon;

-- produtos mais pedidos (agrupa ignorando maiúsculas, acentos de espaço e plural simples)
create or replace function public.sugestoes_produtos(p_inicio date, p_fim date, p_limite int default 10)
returns table (sugestao text, pedidos bigint, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform exigir_admin();
  return query
  select min(trim(a.sugestao)), count(*)::bigint, max(a.criado_em)
    from avaliacoes a
   where a.sugestao is not null
     and (a.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
   group by regexp_replace(lower(trim(a.sugestao)), '\s+', ' ', 'g')
   order by 2 desc, 3 desc
   limit p_limite;
end $$;

-- resumo do dashboard passa a contar as sugestões
create or replace function public.dashboard_avaliacoes(p_inicio date, p_fim date)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v json;
begin
  perform exigir_admin();
  with periodo as (
    select * from avaliacoes
     where (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  )
  select json_build_object(
    'media', coalesce((select round(avg(nota)::numeric, 2) from periodo), 0),
    'total', (select count(*) from periodo),
    'comentarios', (select count(*) from periodo where comentario is not null),
    'sugestoes', (select count(*) from periodo where sugestao is not null),
    'nao_lidas', (select count(*) from avaliacoes where not lida),
    'distribuicao', (select json_agg(json_build_object('nota', n, 'quantidade', (select count(*) from periodo where nota = n)) order by n desc)
                       from generate_series(1, 5) n)
  ) into v;
  return v;
end $$;
