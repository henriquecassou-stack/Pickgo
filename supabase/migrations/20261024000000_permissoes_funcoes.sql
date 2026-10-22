-- Endurece permissões das funções: por padrão o Supabase deixa qualquer um
-- (inclusive visitante não logado, papel anon) EXECUTAR toda função do schema
-- public. Cada função já confere o perfil por dentro, mas o certo é nem deixar
-- chamar. Aqui:
--   * ninguém além de logados e do backend executa funções;
--   * o usuário logado (admin/totem) só executa as RPCs que o app usa e as
--     funções auxiliares que aparecem em políticas, views e restrições;
--   * funções futuras já nascem sem acesso para anon.
-- O backend (service_role) e o pg_cron (dono) continuam com acesso total.
-- Funções de trigger não precisam de EXECUTE para disparar.

revoke execute on all functions in schema public from public, anon, authenticated;

-- RPCs chamadas pelo app (supabase.ts)
grant execute on function
  public.avaliar_venda(uuid, integer, text, text),
  public.cadastrar_morador_totem(text, text, text, text, text, text, boolean, text),
  public.conferir_venda_offline(uuid, boolean),
  public.config_pix_totem(),
  public.dashboard_avaliacoes(date, date),
  public.dashboard_categorias(date, date),
  public.dashboard_clientes(date, date),
  public.dashboard_metodos(date, date),
  public.dashboard_resumo(date, date),
  public.dashboard_serie(date, date, text),
  public.dashboard_top_produtos(date, date, integer),
  public.desbloquear_morador(uuid),
  public.identificar_morador(text, text),
  public.registrar_venda_offline(jsonb),
  public.revisar_morador(uuid),
  public.salvar_morador(uuid, text, text, text, text, text, boolean, text, text),
  public.sugestoes_produtos(date, date, integer),
  public.verificar_avisos()
to authenticated;

-- auxiliares usadas em políticas RLS, views security_invoker e CHECKs
grant execute on function
  public.is_admin(),
  public.is_operador(),
  public.perfil_atual(),
  public.exigir_admin(),
  public.preco_com_promocao(numeric, tipo_promocao, numeric),
  public.cpf_valido(text),
  public.so_digitos(text),
  public.normalizar_apto(text),
  public.avisos_ligados()
to authenticated;

grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke execute on functions from public, anon;
