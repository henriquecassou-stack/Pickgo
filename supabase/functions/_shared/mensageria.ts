// Envio de e-mail por API HTTPS (as Edge Functions não abrem SMTP nas portas 25/587).
// - Brevo (BREVO_API_KEY): envia de um e-mail verificado, inclusive Gmail,
//   sem precisar de domínio próprio.
// - Resend (RESEND_API_KEY): exige domínio verificado no EMAIL_FROM.
// Remetente: EMAIL_FROM, no formato "Nome <email@exemplo.com>".

/** Escapa texto para HTML: sugestões e comentários de clientes entram nos e-mails
 *  e não podem virar link, imagem ou formatação (ex.: link falso para o admin). */
export const escaparHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const emailConfigurado = () => !!(Deno.env.get('BREVO_API_KEY') || Deno.env.get('RESEND_API_KEY'))

function remetente() {
  const bruto = Deno.env.get('EMAIL_FROM') ?? 'pickgo <onboarding@resend.dev>'
  const m = bruto.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m ? { nome: m[1] || 'pickgo', email: m[2] } : { nome: 'pickgo', email: bruto.trim() }
}

export async function enviarEmail(para: string, assunto: string, html: string, texto: string) {
  const de = remetente()

  const brevo = Deno.env.get('BREVO_API_KEY')
  if (brevo) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevo, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: de.nome, email: de.email }, to: [{ email: para }], subject: assunto, htmlContent: html, textContent: texto }),
    })
    if (!res.ok) throw new Error(`Brevo respondeu ${res.status}: ${await res.text()}`)
    return
  }

  const resend = Deno.env.get('RESEND_API_KEY')
  if (!resend) throw new Error('Envio de e-mail não configurado (BREVO_API_KEY ou RESEND_API_KEY)')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${de.nome} <${de.email}>`, to: para, subject: assunto, html, text: texto }),
  })
  if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${await res.text()}`)
}
