// Gera os ícones PNG do app (tela de início do iPad/iPhone e Android) a partir
// da mesma geometria do carrinho em src/componentes/Logo.tsx, sem dependências.
// Uso: node scripts/gerar-icones.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CREME = [0xfd, 0xf6, 0xeb]
const FOLHA = [0x79, 0xad, 0x48]
const ESCURO = [0x06, 0x2a, 0x1f]

// carrinho no viewBox "6 12 186 126" (igual ao Logo.tsx), na ordem de desenho
const FORMAS = [
  { cor: FOLHA, largura: 16, pontos: [[17, 52], [64, 52]] },
  { cor: FOLHA, largura: 18, pontos: [[48, 81], [72, 81]] },
  { cor: FOLHA, largura: 17, pontos: [[122, 40], [178, 40], [168, 86]] },
  { cor: ESCURO, largura: 19, pontos: [[54, 24], [90, 24], [104, 90], [168, 90]] },
  { cor: ESCURO, circulo: [112.5, 121.5, 15] },
  { cor: ESCURO, circulo: [165, 121.5, 15] },
]

function distSegmento(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function desenhar(tamanho, ocupacao) {
  // o carrinho ocupa `ocupacao` da largura, centralizado
  const escala = (tamanho * ocupacao) / 186
  const x0 = (tamanho - 186 * escala) / 2, y0 = (tamanho - 126 * escala) / 2
  const px = new Float64Array(tamanho * tamanho * 3)
  for (let i = 0; i < tamanho * tamanho; i++) px.set(CREME, i * 3)

  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      // centro do pixel em coordenadas do carrinho
      const cx = (x + 0.5 - x0) / escala + 6, cy = (y + 0.5 - y0) / escala + 12
      for (const f of FORMAS) {
        let borda // distância até a borda da forma, em pixels (negativa = dentro)
        if (f.circulo) {
          const [ox, oy, r] = f.circulo
          borda = (Math.hypot(cx - ox, cy - oy) - r) * escala
        } else {
          let d = Infinity
          for (let k = 0; k < f.pontos.length - 1; k++) d = Math.min(d, distSegmento(cx, cy, f.pontos[k], f.pontos[k + 1]))
          borda = (d - f.largura / 2) * escala
        }
        const a = Math.max(0, Math.min(1, 0.5 - borda)) // antisserrilhado
        if (a > 0) for (let c = 0; c < 3; c++) px[(y * tamanho + x) * 3 + c] += (f.cor[c] - px[(y * tamanho + x) * 3 + c]) * a
      }
    }
  }
  return png(tamanho, px)
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'ascii')
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])))
  return Buffer.concat([tam, t, dados, crc])
}
function png(tamanho, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(tamanho, 0); ihdr.writeUInt32BE(tamanho, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8 bits, RGB
  const linhas = Buffer.alloc(tamanho * (tamanho * 3 + 1))
  for (let y = 0; y < tamanho; y++) {
    for (let i = 0; i < tamanho * 3; i++) linhas[y * (tamanho * 3 + 1) + 1 + i] = Math.round(px[y * tamanho * 3 + i])
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas, { level: 9 })), bloco('IEND', Buffer.alloc(0)),
  ])
}

// fundo creme sem cantos: iOS e Android arredondam sozinhos
for (const [nome, tamanho] of [['apple-touch-icon.png', 180], ['icone-192.png', 192], ['icone-512.png', 512]]) {
  writeFileSync(new URL(`../public/${nome}`, import.meta.url), desenhar(tamanho, 0.66))
  console.log('gerado public/' + nome)
}
