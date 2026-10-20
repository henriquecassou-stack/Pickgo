import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowDownToLine, Bell, LayoutDashboard, LogOut, Menu, Package, Receipt, Star, Store, Tags, Users, WifiOff, X } from 'lucide-react'
import { useSessao } from '../../lib/sessao'
import { cx } from '../../componentes/ui'
import { ProvedorAvisosAdmin, SinoAvisos, useAvisosAdmin } from '../../componentes/Avisos'
import { LogoPickgo } from '../../componentes/Logo'
import { estaSimulandoOffline, simularOffline } from '../../lib/conexao'

const MENU = [
  { para: '/admin', rotulo: 'Dashboard', icone: LayoutDashboard, fim: true },
  { para: '/admin/produtos', rotulo: 'Produtos', icone: Package },
  { para: '/admin/movimentacoes', rotulo: 'Movimentações', icone: ArrowDownToLine },
  { para: '/admin/vendas', rotulo: 'Vendas', icone: Receipt },
  { para: '/admin/moradores', rotulo: 'Moradores', icone: Users },
  { para: '/admin/avaliacoes', rotulo: 'Avaliações', icone: Star },
  { para: '/admin/avisos', rotulo: 'Avisos', icone: Bell },
  { para: '/admin/pix', rotulo: 'PIX sem internet', icone: WifiOff },
  { para: '/admin/cadastros', rotulo: 'Categorias e fornecedores', icone: Tags },
]

export default function LayoutAdmin() {
  return (
    <ProvedorAvisosAdmin>
      <Layout />
    </ProvedorAvisosAdmin>
  )
}

function Layout() {
  const { usuario, sair, api } = useSessao()
  const { naoLidos } = useAvisosAdmin()
  const [menuAberto, setMenuAberto] = useState(false)
  const local = useLocation()
  useEffect(() => setMenuAberto(false), [local.pathname])

  const navegacao = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {MENU.map(({ para, rotulo, icone: Icone, fim }) => (
        <NavLink
          key={para}
          to={para}
          end={fim}
          className={({ isActive }) => cx(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          )}
        >
          <Icone className="size-4.5" strokeWidth={1.9} /> <span className="flex-1">{rotulo}</span>
          {para === '/admin/avisos' && naoLidos > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white tabular-nums">{naoLidos > 99 ? '99+' : naoLidos}</span>
          )}
        </NavLink>
      ))}
      <div className="my-3 border-t border-slate-200" />
      <NavLink to="/totem" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
        <Store className="size-4.5" strokeWidth={1.9} /> Abrir totem
      </NavLink>
    </nav>
  )

  const marca = (
    <div className="flex min-w-0 flex-col gap-1 py-5 pl-5">
      <LogoPickgo className="text-[28px]" />
      <p className="text-xs text-texto-suave">Painel do administrador</p>
    </div>
  )

  const rodape = (
    <div className="border-t border-slate-200 p-4">
      <p className="truncate text-sm font-medium text-slate-800">{usuario?.nome}</p>
      <p className="truncate text-xs text-slate-500">{usuario?.email}</p>
      <button onClick={sair} className="mt-3 flex items-center gap-2 text-sm text-slate-500 hover:text-rose-600">
        <LogOut className="size-4" /> Sair
      </button>
    </div>
  )

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* barra lateral (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-emerald-100 bg-white lg:flex">
        <div className="flex items-center justify-between pr-2">{marca}<SinoAvisos /></div>
        {navegacao}
        {rodape}
      </aside>

      {/* topo + gaveta (mobile/tablet) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <LogoPickgo className="text-2xl" />
        <div className="flex items-center gap-1">
          <SinoAvisos />
          <button onClick={() => setMenuAberto(true)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Abrir menu"><Menu className="size-5" /></button>
        </div>
      </header>
      {menuAberto && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMenuAberto(false)}>
          <aside className="flex h-full w-72 animate-entrar flex-col bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">{marca}<button onClick={() => setMenuAberto(false)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Fechar menu"><X className="size-5" /></button></div>
            {navegacao}
            {rodape}
          </aside>
        </div>
      )}

      {api.modo === 'demo' && estaSimulandoOffline() && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-marca px-4 py-2 text-sm text-white">
          A simulação "sem internet" está ligada nesta aba, então o painel não carrega dados.
          <button onClick={() => { simularOffline(false); location.reload() }} className="rounded-full bg-white px-3 py-1 font-medium text-marca">
            Voltar a internet
          </button>
        </div>
      )}

      {api.modo === 'demo' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 sm:px-8">
          <strong>Modo demonstração</strong> — banco local no navegador, pagamentos simulados. Configure o Supabase no <code>.env.local</code> para usar de verdade.
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
