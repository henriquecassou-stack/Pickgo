import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { aoProgressoDemo, obterApi, type Api } from './api'
import type { Usuario } from './tipos'

interface Sessao {
  api: Api
  usuario: Usuario | null
  entrar: (email: string, senha: string) => Promise<Usuario>
  sair: () => Promise<void>
}

const Ctx = createContext<Sessao | null>(null)

export function useSessao() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSessao fora do ProvedorSessao')
  return s
}
export const useApi = () => useSessao().api

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<Api | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [progresso, setProgresso] = useState('Carregando…')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const off = aoProgressoDemo(setProgresso)
    let desligar: (() => void) | undefined
    obterApi()
      .then(async (a) => {
        setUsuario(await a.sessaoAtual())
        desligar = a.aoMudarSessao(setUsuario)
        setApi(a)
      })
      .catch((e) => setErro(String(e?.message ?? e)))
    return () => {
      off()
      desligar?.()
    }
  }, [])

  const entrar = useCallback(async (email: string, senha: string) => {
    const u = await api!.entrar(email, senha)
    setUsuario(u)
    return u
  }, [api])
  const sair = useCallback(async () => {
    await api!.sair()
    setUsuario(null)
  }, [api])

  if (erro) {
    return <div className="grid min-h-dvh place-items-center p-6 text-center text-rose-700">Erro ao iniciar: {erro}</div>
  }
  if (!api) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="size-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm">{progresso}</p>
        </div>
      </div>
    )
  }
  return <Ctx.Provider value={{ api, usuario, entrar, sair }}>{children}</Ctx.Provider>
}

/** Carrega dados assíncronos com estado de carregando/erro e função de recarregar. */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    let vivo = true
    setCarregando(true)
    fn()
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(String(e?.message ?? e)))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao])
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { dados, erro, carregando, recarregar, setDados }
}
