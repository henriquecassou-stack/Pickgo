import { realpathSync } from 'node:fs'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const raiz = searchForWorkspaceRoot(process.cwd())

export default defineConfig({
  // pasta do site (ex.: /Pickgo/ no GitHub Pages); local fica na raiz
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  // PGlite (modo demonstração) carrega seu próprio WASM
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  // no Windows a pasta pode ter um caminho real diferente (links/virtualização)
  server: { fs: { allow: [raiz, realpathSync.native(raiz)] } },
  build: { chunkSizeWarningLimit: 1500 },
})
