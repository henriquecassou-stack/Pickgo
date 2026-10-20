// Service worker: guarda o app no aparelho para o totem abrir mesmo sem
// internet (por exemplo, se a página for recarregada durante a queda).
// Os dados (Supabase) sempre vão pela rede; o totem tem a própria cópia
// do catálogo e da chave PIX para o modo sem internet.
const VERSAO = 'mercado-autonomo-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(['/', '/index.html', '/icone.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // API e serviços externos: sempre rede

  // páginas: tenta a rede (versão nova) e cai para a cópia guardada
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone()
          caches.open(VERSAO).then((c) => c.put('/index.html', copia))
          return r
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // arquivos do app (nomes com hash): cópia guardada primeiro
  e.respondWith(
    caches.match(req).then((guardado) => guardado || fetch(req).then((r) => {
      if (r.ok) {
        const copia = r.clone()
        caches.open(VERSAO).then((c) => c.put(req, copia))
      }
      return r
    })),
  )
})
