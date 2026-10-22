// Onda de toque em todos os botões: um círculo na cor do texto do botão se
// espalha a partir do ponto tocado. Um único listener no documento cobre o app
// inteiro (totem e painel). Para desligar num botão: data-sem-onda.
// Com "reduzir movimento" ligado no aparelho, não faz nada.

const reduzirMovimento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function criarOnda(e: PointerEvent) {
  if (e.button !== 0 || reduzirMovimento()) return
  const botao = (e.target as Element | null)?.closest?.('button')
  if (!botao || botao.disabled || botao.hasAttribute('data-sem-onda')) return

  // a camada precisa de um pai posicionado; botão estático vira relative (não muda o layout)
  if (getComputedStyle(botao).position === 'static') botao.style.position = 'relative'
  let camada = botao.querySelector<HTMLSpanElement>(':scope > .onda-camada')
  if (!camada) {
    camada = document.createElement('span')
    camada.className = 'onda-camada'
    camada.setAttribute('aria-hidden', 'true')
    botao.appendChild(camada)
  }

  const r = botao.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  // diâmetro que cobre o botão inteiro a partir do ponto tocado
  const d = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y))
  const onda = document.createElement('span')
  onda.className = 'onda'
  onda.style.width = onda.style.height = `${d}px`
  onda.style.left = `${x}px`
  onda.style.top = `${y}px`
  onda.addEventListener('animationend', () => onda.remove(), { once: true })
  camada.appendChild(onda)
}

let instalado = false
export function instalarAnimacoesDeToque() {
  if (instalado) return
  instalado = true
  document.addEventListener('pointerdown', criarOnda, { passive: true })
  // no Safari do iPad, :active (o botão "afundar") só funciona com algum touchstart registrado
  document.addEventListener('touchstart', () => {}, { passive: true })
}
