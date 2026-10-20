// Envia os avisos do administrador por e-mail.
//   { "modo": "pendentes" } -> avisos novos (nível configurado) ainda não enviados
//   { "modo": "resumo" }    -> resumo do que está aberto + avisos das últimas 24 h
//   { "modo": "teste" }     -> mensagem de teste para o e-mail configurado
// Chamada pelo pg_cron (cabeçalho x-cron-secret) ou pelo admin no painel (JWT).
// Publicar com: supabase functions deploy enviar-avisos --no-verify-jwt
import { clienteServico, cors, erro, json, usuarioDaRequisicao } from '../_shared/comum.ts'
import { enviarEmail } from '../_shared/mensageria.ts'

interface Aviso { id: number; tipo: string; gravidade: 'info' | 'atencao' | 'critico'; titulo: string; mensagem: string; link: string | null; criado_em: string }

const ICONE = { critico: '🔴', atencao: '🟡', info: '🔵' } as const
const ROTULO = { critico: 'Urgente', atencao: 'Atenção', info: 'Informativo' } as const

function montar(titulo: string, avisos: Aviso[]) {
  const urlApp = Deno.env.get('APP_URL') ?? ''
  const ordem = [...avisos].sort((a, b) => ['critico', 'atencao', 'info'].indexOf(a.gravidade) - ['critico', 'atencao', 'info'].indexOf(b.gravidade))
  const texto = [`🛒 pickgo — ${titulo}`, '', ...ordem.map((a) => `${ICONE[a.gravidade]} ${a.titulo}\n${a.mensagem}`), '', urlApp ? `Abrir painel: ${urlApp}/admin/avisos` : '']
    .join('\n').trim()
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
    <h2 style="margin:0 0 12px">pickgo — ${titulo}</h2>
    ${ordem.map((a) => `<div style="border-left:4px solid ${a.gravidade === 'critico' ? '#e11d48' : a.gravidade === 'atencao' ? '#f59e0b' : '#0ea5e9'};padding:8px 12px;margin:8px 0;background:#f8fafc">
      <div style="font-size:12px;color:#64748b">${ROTULO[a.gravidade]}</div>
      <div style="font-weight:600">${a.titulo}</div><div style="color:#334155">${a.mensagem}</div>
      ${urlApp && a.link ? `<a href="${urlApp}${a.link}" style="font-size:13px">Ver no painel</a>` : ''}</div>`).join('')}
  </div>`
  return { texto, html }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = clienteServico()

  // autorização: segredo do cron ou admin logado
  const segredo = Deno.env.get('AVISOS_CRON_SECRET')
  const viaCron = !!segredo && req.headers.get('x-cron-secret') === segredo
  if (!viaCron) {
    const usuario = await usuarioDaRequisicao(req, db)
    if (usuario?.perfil !== 'admin') return erro('Não autorizado', 401)
  }

  const { modo = 'pendentes' } = await req.json().catch(() => ({}))
  const { data: cfg } = await db.from('config_avisos').select('*').eq('id', 1).single()
  if (!cfg?.email) return json({ enviados: 0, motivo: 'Nenhum e-mail configurado' })

  await db.rpc('verificar_avisos')

  let avisos: Aviso[] = []
  let titulo = ''
  if (modo === 'teste') {
    titulo = 'mensagem de teste'
    avisos = [{ id: 0, tipo: 'teste', gravidade: 'info', titulo: 'Avisos configurados', mensagem: 'Você vai receber os avisos do mercado por aqui.', link: '/admin/avisos', criado_em: new Date().toISOString() }]
  } else if (modo === 'resumo') {
    if (!cfg.resumo_diario) return json({ enviados: 0, motivo: 'Resumo diário desligado' })
    const ontem = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data } = await db.from('avisos').select('*').or(`resolvido.eq.false,criado_em.gte.${ontem}`).order('criado_em', { ascending: false }).limit(40)
    avisos = data ?? []
    titulo = `resumo do dia (${avisos.length} aviso${avisos.length === 1 ? '' : 's'})`
    if (!avisos.length) return json({ enviados: 0, motivo: 'Nada a relatar' })
  } else {
    if (!cfg.enviar_imediato) return json({ enviados: 0, motivo: 'Envio imediato desligado' })
    const { data } = await db.from('avisos').select('*')
      .is('enviado_em', null).eq('resolvido', false).in('gravidade', cfg.niveis_imediato)
      .gte('criado_em', new Date(Date.now() - 24 * 3600_000).toISOString())
      .order('criado_em').limit(30)
    avisos = data ?? []
    if (!avisos.length) return json({ enviados: 0 })
    titulo = avisos.length === 1 ? avisos[0].titulo : `${avisos.length} novos avisos`
  }

  const { texto, html } = montar(titulo, avisos)
  try {
    await enviarEmail(cfg.email, `pickgo — ${titulo}`, html, texto)
  } catch (e) {
    return erro(`Falha no envio do e-mail — ${(e as Error).message}`, 502)
  }

  if (modo === 'pendentes') {
    await db.from('avisos').update({ enviado_em: new Date().toISOString() }).in('id', avisos.map((a) => a.id))
  }
  return json({ enviados: avisos.length })
})
