// Envio de e-mail (Resend).

export async function enviarEmail(para: string, assunto: string, html: string, texto: string) {
  const chave = Deno.env.get('RESEND_API_KEY')
  if (!chave) throw new Error('RESEND_API_KEY não configurado')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('EMAIL_FROM') ?? 'pickgo <onboarding@resend.dev>', to: para, subject: assunto, html, text: texto }),
  })
  if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${await res.text()}`)
}
