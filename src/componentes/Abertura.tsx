// Tela de abertura do totem: carrinho andando + logo por 2,5 s, enquanto o app
// carrega por baixo; depois some com um esmaecer. Só no totem (atalho do iPad em
// modo app ou endereço /totem): o painel do admin abre direto.
import { useEffect, useState, type ReactNode } from 'react'
import { CarrinhoAnimado, LogoPickgo } from './Logo'

const DURACAO_MS = 2500
const SAIDA_MS = 450

function abrirComAbertura() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
  return !!standalone || location.pathname.includes('/totem')
}

export function Abertura({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<'mostrando' | 'saindo' | 'fim'>(() => (abrirComAbertura() ? 'mostrando' : 'fim'))

  useEffect(() => {
    if (fase === 'fim') return
    const t1 = setTimeout(() => setFase('saindo'), DURACAO_MS)
    const t2 = setTimeout(() => setFase('fim'), DURACAO_MS + SAIDA_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {children}
      {fase !== 'fim' && (
        <div role="status" aria-label="Abrindo o pickgo"
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-creme transition-opacity ease-out"
          style={{ opacity: fase === 'saindo' ? 0 : 1, transitionDuration: `${SAIDA_MS}ms` }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <span className="absolute -top-40 -left-40 size-96 rounded-full bg-circulo" />
            <span className="absolute -right-32 -bottom-32 size-96 rounded-full bg-circulo" />
          </div>
          <div className="relative flex flex-col items-center gap-6">
            <CarrinhoAnimado className="h-36 w-auto text-marca-escura" rotulo="Abrindo o pickgo" />
            <LogoPickgo semSimbolo className="entra-em-seq text-6xl" />
          </div>
        </div>
      )}
    </>
  )
}
