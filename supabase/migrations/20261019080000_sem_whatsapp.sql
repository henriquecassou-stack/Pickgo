-- =====================================================================
-- WhatsApp removido do sistema: comprovantes e avisos só por e-mail.
-- (moradores.telefone continua como contato opcional no painel)
-- =====================================================================

alter table public.config_avisos drop column if exists whatsapp;
