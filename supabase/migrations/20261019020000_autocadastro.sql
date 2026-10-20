-- =====================================================================
-- Autocadastro do morador no totem
--
-- O morador pode se cadastrar sozinho no totem e já comprar identificado.
-- O cadastro nasce marcado como "não revisado" para o administrador
-- conferir. Proteções:
--   * PIN único por apartamento; tentar um PIN já usado conta como
--     tentativa errada (mesmo bloqueio de 5 erros / 15 min), para que o
--     cadastro não sirva para descobrir o PIN de outra pessoa;
--   * no máximo 3 autocadastros por apartamento por hora;
--   * consentimento (LGPD) obrigatório e registrado.
-- =====================================================================

alter table public.moradores
  add column origem    text not null default 'admin' check (origem in ('admin', 'totem')),
  add column revisado  boolean not null default true,
  add column aceite_em timestamptz;

create or replace function public.cadastrar_morador_totem(
  p_nome text, p_apartamento text, p_bloco text, p_telefone text, p_email text, p_pin text, p_aceite boolean
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_apto     text := normalizar_apto(p_apartamento);
  v_tel      text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_email    text := lower(nullif(trim(p_email), ''));
  v_id       uuid;
  v_bloqueio timestamptz;
begin
  if not is_operador() then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;

  -- validações (erros devolvidos como JSON para a tela mostrar)
  if length(trim(coalesce(p_nome, ''))) < 3 then
    return json_build_object('erro', 'dados', 'mensagem', 'Informe seu nome.');
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

  select max(bloqueado_ate) into v_bloqueio
    from moradores where ativo and normalizar_apto(apartamento) = v_apto and bloqueado_ate > now();
  if v_bloqueio is not null then
    return json_build_object('erro', 'bloqueado', 'minutos', ceil(extract(epoch from v_bloqueio - now()) / 60));
  end if;

  if (select count(*) from moradores
       where origem = 'totem' and normalizar_apto(apartamento) = v_apto and criado_em > now() - interval '1 hour') >= 3 then
    return json_build_object('erro', 'limite');
  end if;

  -- PIN já usado por alguém do apartamento: recusa e conta como tentativa errada
  if exists (select 1 from moradores
              where ativo and pin_hash is not null and normalizar_apto(apartamento) = v_apto
                and pin_hash = hash_pin(id, p_pin)) then
    update moradores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '15 minutes' end
     where ativo and normalizar_apto(apartamento) = v_apto;
    return json_build_object('erro', 'pin_indisponivel');
  end if;

  insert into moradores (nome, apartamento, bloco, telefone, email, origem, revisado, aceite_em)
  values (trim(p_nome), upper(trim(p_apartamento)), nullif(upper(trim(p_bloco)), ''), nullif(trim(p_telefone), ''), v_email,
          'totem', false, now())
  returning id into v_id;
  update moradores set pin_hash = hash_pin(v_id, p_pin) where id = v_id;

  -- devolve os mesmos dados da identificação (já entra identificado)
  return identificar_morador(p_apartamento, p_pin);
end $$;

revoke all on function public.cadastrar_morador_totem(text, text, text, text, text, text, boolean) from anon;

-- Admin confirma o cadastro feito no totem
create or replace function public.revisar_morador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir_admin();
  update moradores set revisado = true where id = p_id;
end $$;

-- Salvar pelo painel também conta como revisado
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
           telefone = nullif(trim(p_telefone), ''), email = nullif(trim(p_email), ''), ativo = coalesce(p_ativo, true),
           revisado = true
     where id = v_id;
    if not found then raise exception 'Morador não encontrado'; end if;
  end if;
  if p_pin is not null then
    update moradores set pin_hash = hash_pin(v_id, p_pin), tentativas_falhas = 0, bloqueado_ate = null where id = v_id;
  end if;
  return v_id;
end $$;

create or replace view public.moradores_admin with (security_invoker = true) as
  select id, nome, apartamento, bloco, telefone, email, ativo, tentativas_falhas, bloqueado_ate, criado_em,
         (pin_hash is not null) as tem_pin,
         (bloqueado_ate is not null and bloqueado_ate > now()) as bloqueado,
         (select count(*) from vendas v where v.morador_id = m.id and v.status = 'paga') as compras,
         origem, revisado, aceite_em
    from public.moradores m;
