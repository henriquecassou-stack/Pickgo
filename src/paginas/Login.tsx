import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Info } from 'lucide-react'
import { LogoPickgo } from '../componentes/Logo'
import { useSessao } from '../lib/sessao'
import { Botao, Rotulo } from '../componentes/ui'

export default function Login() {
  const { usuario, entrar, api } = useSessao()
  const navegar = useNavigate()
  const local = useLocation()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (usuario) return <Navigate to={usuario.perfil === 'totem' ? '/totem' : '/admin'} replace />

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      // teclado do iPad/celular costuma pôr espaço no fim e maiúscula no início do e-mail
      const u = await entrar(email.trim().toLowerCase(), senha)
      const de = (local.state as { de?: string } | null)?.de
      navegar(de && (u.perfil === 'admin' || de === '/totem') ? de : u.perfil === 'totem' ? '/totem' : '/admin', { replace: true })
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-creme px-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="absolute -top-32 -left-32 size-80 rounded-full bg-circulo" />
        <span className="absolute -right-28 -bottom-28 size-80 rounded-full bg-circulo" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1><LogoPickgo className="text-6xl" /></h1>
          <p className="mt-3 text-sm text-texto-suave">Painel do administrador e totem de autoatendimento</p>
        </div>

        <form onSubmit={enviar} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Rotulo texto="E-mail">
            <input className="campo" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Rotulo>
          <Rotulo texto="Senha">
            <div className="relative">
              <input className="campo pr-11" type={verSenha ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                required value={senha} onChange={(e) => setSenha(e.target.value)} />
              <button type="button" onClick={() => setVerSenha(!verSenha)} aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-700">
                {verSenha ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
              </button>
            </div>
          </Rotulo>
          {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
          <Botao type="submit" carregando={enviando} className="w-full">Entrar</Botao>
        </form>

        {api.modo === 'demo' && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-medium"><Info className="size-4" /> Modo demonstração</p>
            <p className="mt-1 text-amber-800">Supabase não configurado: os dados ficam num banco local do navegador. Entre como:</p>
            <div className="mt-3 flex gap-2">
              <Botao variante="secundario" tamanho="sm" onClick={() => { setEmail('admin@demo.com'); setSenha('demo') }}>Administrador</Botao>
              <Botao variante="secundario" tamanho="sm" onClick={() => { setEmail('totem@demo.com'); setSenha('demo') }}>Totem</Botao>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
