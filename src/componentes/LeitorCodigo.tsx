import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { cx, Modal } from './ui'

/**
 * Leitor USB de código de barras: ele "digita" muito rápido e termina com Enter.
 * Captura essa rajada em qualquer lugar da página (exceto quando o foco está num
 * campo de texto, para não atrapalhar a digitação normal).
 */
export function useLeitorUSB(aoLer: (codigo: string) => void, ativo = true) {
  const ref = useRef(aoLer)
  ref.current = aoLer
  useEffect(() => {
    if (!ativo) return
    let buffer = ''
    let ultimo = 0
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target
      if (alvo instanceof Element && alvo.closest('input, textarea, select, [contenteditable="true"]')) return
      const agora = performance.now()
      if (agora - ultimo > 80) buffer = ''
      ultimo = agora
      if (e.key === 'Enter') {
        if (buffer.length >= 6) {
          e.preventDefault()
          ref.current(buffer)
        }
        buffer = ''
      } else if (e.key.length === 1 && /[0-9A-Za-z-]/.test(e.key)) {
        buffer += e.key
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ativo])
}

/** Leitura pela câmera do tablet/celular (ZXing). `frontal`: câmera da frente (totem de parede, o cliente mostra o produto para a tela). */
export function LeitorCamera({ aberto, aoFechar, aoLer, frontal = false }: { aberto: boolean; aoFechar: () => void; aoLer: (codigo: string) => void; frontal?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    let parar: (() => void) | undefined
    let cancelado = false
    setErro(null)
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const leitor = new BrowserMultiFormatReader()
        const controles = await leitor.decodeFromConstraints(
          { video: { facingMode: frontal ? 'user' : 'environment' } },
          video.current!,
          (resultado) => {
            if (resultado && !cancelado) {
              cancelado = true
              navigator.vibrate?.(60)
              controles.stop()
              aoLer(resultado.getText())
            }
          },
        )
        parar = () => controles.stop()
        if (cancelado) controles.stop()
      } catch {
        setErro('Não foi possível acessar a câmera. Verifique a permissão do navegador.')
      }
    })()
    return () => {
      cancelado = true
      parar?.()
    }
  }, [aberto, aoLer, frontal])

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={<span className="flex items-center gap-2"><Camera className="size-5" /> Ler código de barras</span>}>
      {erro ? (
        <p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{erro}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          {/* câmera da frente espelhada, como um espelho: mais fácil de posicionar o produto (a leitura usa a imagem original) */}
          <video ref={video} className={cx('aspect-[4/3] w-full object-cover', frontal && '-scale-x-100')} muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500 shadow-[0_0_12px_2px] shadow-rose-500/70" />
        </div>
      )}
      <p className="mt-3 text-center text-sm text-slate-500">
        {frontal ? 'Mostre o código de barras do produto para a câmera da tela.' : 'Aponte a câmera para o código de barras do produto.'}
      </p>
    </Modal>
  )
}
