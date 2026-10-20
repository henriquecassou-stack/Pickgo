-- Contas criadas fora do script do administrador (ex.: cadastro público do
-- Supabase Auth, se alguém esquecer de desligar) nascem desativadas:
-- sem perfil em app_metadata (que só o service role define), não há acesso.
create or replace function public.criar_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, nome, email, perfil, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_app_meta_data ->> 'perfil')::perfil_usuario, 'totem'),
    new.raw_app_meta_data ? 'perfil'
  )
  on conflict (id) do nothing;
  return new;
end $$;
