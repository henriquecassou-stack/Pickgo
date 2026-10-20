import { StrictMode, lazy, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './index.css'
import { ProvedorSessao, useSessao } from './lib/sessao'
import { Carregando, ProvedorAvisos } from './componentes/ui'
import type { Perfil } from './lib/tipos'
import Login from './paginas/Login'
import LayoutAdmin from './paginas/admin/LayoutAdmin'

const Dashboard = lazy(() => import('./paginas/admin/Dashboard'))
const Produtos = lazy(() => import('./paginas/admin/Produtos'))
const HistoricoProduto = lazy(() => import('./paginas/admin/HistoricoProduto'))
const Movimentacoes = lazy(() => import('./paginas/admin/Movimentacoes'))
const Vendas = lazy(() => import('./paginas/admin/Vendas'))
const Cadastros = lazy(() => import('./paginas/admin/Cadastros'))
const Moradores = lazy(() => import('./paginas/admin/Moradores'))
const Avaliacoes = lazy(() => import('./paginas/admin/Avaliacoes'))
const Avisos = lazy(() => import('./paginas/admin/Avisos'))
const PixOffline = lazy(() => import('./paginas/admin/PixOffline'))
const Totem = lazy(() => import('./paginas/totem/Totem'))

function Protegida({ perfis, children }: { perfis: Perfil[]; children: ReactNode }) {
  const { usuario } = useSessao()
  const local = useLocation()
  if (!usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />
  if (!perfis.includes(usuario.perfil)) return <Navigate to={usuario.perfil === 'totem' ? '/totem' : '/admin'} replace />
  return <>{children}</>
}

function Inicio() {
  const { usuario } = useSessao()
  return <Navigate to={!usuario ? '/login' : usuario.perfil === 'totem' ? '/totem' : '/admin'} replace />
}

// guarda o app no aparelho para abrir sem internet (só no build de produção)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProvedorAvisos>
      <ProvedorSessao>
        <BrowserRouter>
          <Suspense fallback={<Carregando />}>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/login" element={<Login />} />
              <Route path="/totem" element={<Protegida perfis={['totem', 'admin']}><Totem /></Protegida>} />
              <Route path="/admin" element={<Protegida perfis={['admin']}><LayoutAdmin /></Protegida>}>
                <Route index element={<Dashboard />} />
                <Route path="produtos" element={<Produtos />} />
                <Route path="produtos/:id" element={<HistoricoProduto />} />
                <Route path="movimentacoes" element={<Movimentacoes />} />
                <Route path="vendas" element={<Vendas />} />
                <Route path="moradores" element={<Moradores />} />
                <Route path="avaliacoes" element={<Avaliacoes />} />
                <Route path="avisos" element={<Avisos />} />
                <Route path="pix" element={<PixOffline />} />
                <Route path="cadastros" element={<Cadastros />} />
              </Route>
              <Route path="*" element={<Inicio />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ProvedorSessao>
    </ProvedorAvisos>
  </StrictMode>,
)
