import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft, BadgeCheck, Building2, PackagePlus, UserPlus, Camera, ChevronRight, CircleCheck, Delete, Eye, EyeOff, IdCard, CircleX, Clock, Copy, CreditCard, Hourglass, House, Loader, Mail, Minus, Plus,
  QrCode, Search, ShoppingCart, Smartphone, Star, Trash2, UserRound, WalletCards, Wifi, WifiOff, X,
} from 'lucide-react'
import { useSessao } from '../../lib/sessao'
import type { ClienteVenda, ItemCatalogo, MetodoPagamento, MoradorIdentificado, Pagamento, PixTotem, ResultadoCriarPagamento, TipoCliente, VendaOffline } from '../../lib/tipos'
import { catalogoLocal, ehErroDeRede, filaOffline, pixLocal } from '../../lib/offline'
import { online, simularOffline } from '../../lib/conexao'
import { gerarPixEstatico, novoTxidOffline } from '../../lib/pix'
import { cpfValido, formatarCpf, mascararCpf, somenteDigitos } from '../../lib/cpf'
import { brl, dataHoraBR, ROTULO_METODO } from '../../lib/formato'
import { cx } from '../../componentes/ui'
import { FotoProduto, IconeCategoria } from '../../componentes/IconeCategoria'
import { LeitorCamera, useLeitorUSB } from '../../componentes/LeitorCodigo'
import { CarrinhoAnimado, LogoPickgo, SimboloPickgo } from '../../componentes/Logo'

type Etapa = 'inicio' | 'cliente' | 'identificacao' | 'cadastro' | 'compra' | 'pagamento' | 'aguardando' | 'aprovado' | 'falha'
  | 'pix_offline' | 'offline_ok' | 'cpf_visitante' | 'cpf_morador'
interface ItemCarrinho { produto: ItemCatalogo; qtd: number }
/** Quem está comprando: escolhido na tela inicial */
interface Cliente { tipo: TipoCliente; morador?: MoradorIdentificado; cpf?: string }

const OCIOSO_MS = 30_000
const AVISO_OCIOSO_MS = 20_000
const LIMITE_PIX_OFFLINE_MS = 5 * 60_000 // tela do QR sem internet volta ao início depois disso

export default function Totem() {
  const { api, usuario, sair } = useSessao()
  const navegar = useNavigate()
  const [etapa, setEtapa] = useState<Etapa>('inicio')
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([])
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [categoria, setCategoria] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [camera, setCamera] = useState(false)
  const [apartamento, setApartamento] = useState('')
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [compra, setCompra] = useState<ResultadoCriarPagamento | null>(null)
  const [pagamento, setPagamento] = useState<Pagamento | null>(null)
  const [itensPagos, setItensPagos] = useState<ItemCarrinho[]>([])
  const [processando, setProcessando] = useState<MetodoPagamento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [ultimoToque, setUltimoToque] = useState(Date.now())
  const [agora, setAgora] = useState(Date.now())
  const desinscrever = useRef<(() => void) | null>(null)

  // ---- modo sem internet -------------------------------------------------
  const [semInternet, setSemInternet] = useState(() => !online())
  const [pix, setPix] = useState<PixTotem | null>(() => pixLocal.ler())
  const [pendentesEnvio, setPendentesEnvio] = useState(() => filaOffline.ler().length)
  const [vendaOffline, setVendaOffline] = useState<VendaOffline | null>(null)
  const semInternetRef = useRef(semInternet)
  semInternetRef.current = semInternet

  /** algo falhou por falta de conexão: entra no modo sem internet */
  const caiuInternet = useCallback((e: unknown) => {
    if (ehErroDeRede(e)) setSemInternet(true)
  }, [])

  const carregarCatalogo = useCallback(() => {
    api.catalogo()
      .then((c) => {
        setCatalogo(c)
        catalogoLocal.gravar(c) // cópia para usar sem internet
      })
      .catch((e) => {
        caiuInternet(e)
        setCatalogo((atual) => (atual.length ? atual : catalogoLocal.ler()))
      })
    api.configPixTotem()
      .then((p) => {
        setPix(p)
        pixLocal.gravar(p)
      })
      .catch(caiuInternet)
  }, [api, caiuInternet])
  useEffect(carregarCatalogo, [carregarCatalogo])

  /** envia as vendas feitas sem internet (idempotente: reenviar não duplica) */
  const enviando = useRef(false)
  const sincronizar = useCallback(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      for (const v of filaOffline.ler()) {
        try {
          await api.registrarVendaOffline(v)
          filaOffline.remover(v.txid)
        } catch (e) {
          if (ehErroDeRede(e)) {
            setSemInternet(true)
            break
          }
          console.error('Venda offline recusada pelo servidor', v.txid, e) // fica na fila para análise
        }
      }
    } finally {
      enviando.current = false
      setPendentesEnvio(filaOffline.ler().length)
    }
  }, [api])

  useEffect(() => {
    const voltou = () => {
      if (!online()) return
      setSemInternet(false)
      sincronizar()
      carregarCatalogo()
    }
    const caiu = () => setSemInternet(true)
    window.addEventListener('online', voltou)
    window.addEventListener('offline', caiu)
    sincronizar()
    // sem internet: testa a conexão de tempos em tempos; com internet: envia o que sobrou na fila
    const t = setInterval(() => {
      if (!online()) return
      if (semInternetRef.current) api.catalogo().then(voltou).catch(() => {})
      else if (filaOffline.ler().length) sincronizar()
    }, 20_000)
    return () => {
      window.removeEventListener('online', voltou)
      window.removeEventListener('offline', caiu)
      clearInterval(t)
    }
  }, [api, sincronizar, carregarCatalogo])

  // relógio (contagem do PIX e do ocioso)
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  // qualquer toque reinicia o contador de inatividade
  useEffect(() => {
    const toque = () => setUltimoToque(Date.now())
    window.addEventListener('pointerdown', toque)
    window.addEventListener('keydown', toque)
    return () => {
      window.removeEventListener('pointerdown', toque)
      window.removeEventListener('keydown', toque)
    }
  }, [])

  const reiniciar = useCallback(() => {
    desinscrever.current?.()
    desinscrever.current = null
    setCarrinho([])
    setCompra(null)
    setPagamento(null)
    setApartamento('')
    setCliente(null)
    setBusca('')
    setBuscaAberta(false)
    setCategoria(null)
    setErro(null)
    setAviso(null)
    setVendaOffline(null)
    setConfirmarCancelar(false)
    setEtapa('inicio')
    carregarCatalogo()
  }, [carregarCatalogo])

  // cancelar compra: com produtos no carrinho pede confirmação; vazio, volta direto
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const pedirCancelamento = () => (carrinho.length ? setConfirmarCancelar(true) : reiniciar())

  // volta ao início após 30 s parado (exceto enquanto aguarda o pagamento,
  // que tem a própria expiração de 5 min, e no PIX sem internet, em que o
  // cliente está pagando pelo celular)
  const ocioso = agora - ultimoToque
  const contaOciosidade = etapa !== 'inicio' && etapa !== 'aguardando' && etapa !== 'pix_offline'
  useEffect(() => {
    if (contaOciosidade && ocioso >= OCIOSO_MS) reiniciar()
    if (etapa === 'pix_offline' && ocioso >= LIMITE_PIX_OFFLINE_MS) reiniciar()
  }, [contaOciosidade, etapa, ocioso, reiniciar])
  useEffect(() => () => desinscrever.current?.(), [])

  const total = useMemo(() => carrinho.reduce((s, i) => s + Math.round(i.produto.preco_venda * 100) * i.qtd, 0) / 100, [carrinho])
  const qtdItens = carrinho.reduce((s, i) => s + i.qtd, 0)

  const adicionar = useCallback((p: ItemCatalogo, n = 1) => {
    setCarrinho((c) => {
      const existe = c.find((i) => i.produto.id === p.id)
      if (existe) return c.map((i) => (i.produto.id === p.id ? { ...i, qtd: Math.min(50, i.qtd + n) } : i)).filter((i) => i.qtd > 0)
      return n > 0 ? [...c, { produto: p, qtd: n }] : c
    })
    if (n > 0) {
      setFlash(p.id)
      setTimeout(() => setFlash((f) => (f === p.id ? null : f)), 600)
    }
  }, [])
  const remover = useCallback((p: ItemCatalogo) => setCarrinho((c) => c.filter((i) => i.produto.id !== p.id)), [])

  // se o cliente tirar tudo na tela de pagamento, volta para escolher produtos
  useEffect(() => { if (etapa === 'pagamento' && carrinho.length === 0) setEtapa('compra') }, [etapa, carrinho.length])

  const aoLerCodigo = useCallback((codigo: string) => {
    setCamera(false)
    if (etapa !== 'compra') return
    const p = catalogo.find((x) => x.codigo_barras === codigo)
    if (!p) {
      setErro(`Produto não encontrado (código ${codigo}). Procure pelo nome.`)
      setTimeout(() => setErro(null), 4000)
      return
    }
    navigator.vibrate?.(40)
    adicionar(p)
  }, [catalogo, etapa, adicionar])
  useLeitorUSB(aoLerCodigo, etapa === 'compra')

  function comecar(c: Cliente) {
    setCliente(c)
    setEtapa('compra')
  }

  async function pagar(metodo: MetodoPagamento) {
    setErro(null)
    setProcessando(metodo)
    try {
      desinscrever.current?.()
      const dadosCliente: ClienteVenda = {
        tipo: cliente?.tipo ?? 'morador',
        morador_id: cliente?.morador?.id ?? null,
        cpf: cliente?.tipo === 'morador_cadastrado' ? null : cliente?.cpf ?? null,
        apartamento: cliente?.tipo === 'morador' ? apartamento.trim() || null : null,
      }
      const r = await api.criarPagamento(carrinho.map((i) => ({ produto_id: i.produto.id, quantidade: i.qtd })), metodo, dadosCliente)
      setCompra(r)
      setPagamento(r.pagamento)
      setItensPagos(carrinho)
      setEtapa('aguardando')
      desinscrever.current = api.acompanharPagamento(r.pagamento.id, (p) => {
        setPagamento((atual) => ({ ...atual!, ...p }))
        if (p.status === 'aprovado') setEtapa('aprovado')
        else if (p.status !== 'pendente') setEtapa('falha')
        setUltimoToque(Date.now())
      })
    } catch (e) {
      if (ehErroDeRede(e)) {
        setSemInternet(true)
        setErro(pix ? 'Sem internet no momento. Pague com o PIX direto (QR Code abaixo).' : 'Sem internet no momento. Tente de novo em instantes.')
      } else {
        setErro((e as Error).message)
      }
    } finally {
      setProcessando(null)
    }
  }

  /** sem internet: gera o PIX estático com o valor exato, gerado no próprio totem */
  function pagarSemInternet() {
    if (!pix) return
    setErro(null)
    setVendaOffline({
      txid: novoTxidOffline(),
      tipo_cliente: cliente?.tipo === 'visitante' ? 'visitante' : 'morador',
      apartamento: cliente?.tipo === 'visitante' ? null : apartamento.trim() || null,
      cpf: cliente?.tipo === 'morador_cadastrado' ? null : cliente?.cpf ?? null,
      criado_em: new Date().toISOString(),
      total,
      itens: carrinho.map((i) => ({ produto_id: i.produto.id, nome: i.produto.nome, quantidade: i.qtd, preco_unitario: i.produto.preco_venda })),
    })
    setEtapa('pix_offline')
  }

  /** cliente confirmou que pagou: guarda a venda na fila e tenta enviar */
  function confirmarPixOffline() {
    if (!vendaOffline) return
    filaOffline.adicionar({ ...vendaOffline, criado_em: new Date().toISOString() })
    setPendentesEnvio(filaOffline.ler().length)
    setItensPagos(carrinho)
    setEtapa('offline_ok')
    setUltimoToque(Date.now())
    sincronizar()
  }

  // expiração do QR (5 min)
  const restanteMs = pagamento ? new Date(pagamento.expira_em).getTime() - agora : 0
  const expirando = useRef(false)
  useEffect(() => {
    if (etapa !== 'aguardando' || !pagamento || restanteMs > 0 || expirando.current) return
    expirando.current = true
    api.cancelarPagamento(pagamento.id, 'expirado')
      .catch(() => {})
      .finally(() => {
        expirando.current = false
        setPagamento((p) => (p && p.status === 'pendente' ? { ...p, status: 'expirado', motivo_recusa: 'O tempo para pagamento acabou' } : p))
        setEtapa((e) => (e === 'aguardando' ? 'falha' : e))
        setUltimoToque(Date.now())
      })
  }, [etapa, pagamento, restanteMs, api])

  async function cancelarPagamento() {
    if (!pagamento) return
    const id = pagamento.id
    desinscrever.current?.()
    desinscrever.current = null
    setEtapa('pagamento')
    await api.cancelarPagamento(id, 'cancelado').catch(() => {})
  }

  // saída do modo totem: segurar o logo por 3 s
  const pressionado = useRef<number | undefined>(undefined)
  const segurarLogo = {
    onPointerDown: () => {
      pressionado.current = window.setTimeout(async () => {
        if (!confirm('Sair do modo totem?')) return
        if (usuario?.perfil === 'admin') navegar('/admin')
        else await sair()
      }, 3000)
    },
    onPointerUp: () => clearTimeout(pressionado.current),
    onPointerLeave: () => clearTimeout(pressionado.current),
  }

  const categorias = useMemo(() => {
    const m = new Map<number, { id: number; nome: string; icone: string | null; cor: string | null; ordem: number }>()
    for (const p of catalogo) if (p.categoria_id && !m.has(p.categoria_id)) {
      m.set(p.categoria_id, { id: p.categoria_id, nome: p.categoria ?? '', icone: p.categoria_icone, cor: p.categoria_cor, ordem: p.categoria_ordem ?? 0 })
    }
    return [...m.values()].sort((a, b) => a.ordem - b.ordem)
  }, [catalogo])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return catalogo.filter((p) => (!categoria || p.categoria_id === categoria) && (!t || p.nome.toLowerCase().includes(t)))
  }, [catalogo, categoria, busca])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-creme text-marca-escura select-none">
      {(semInternet || pendentesEnvio > 0) && (
        <div className={cx('flex shrink-0 items-center justify-center gap-3 px-4 py-3 text-center text-lg font-medium text-white',
          semInternet ? 'bg-marca' : 'bg-emerald-800')} role="status">
          {semInternet ? (
            <><WifiOff className="size-6 shrink-0" /> Sem internet — as compras continuam com PIX direto pelo QR Code
              {pendentesEnvio > 0 && <span className="font-normal"> · {pendentesEnvio} compra{pendentesEnvio > 1 ? 's' : ''} aguardando envio</span>}</>
          ) : (
            <><Loader className="size-4 animate-spin" /> Enviando {pendentesEnvio} compra{pendentesEnvio > 1 ? 's' : ''} feita{pendentesEnvio > 1 ? 's' : ''} sem internet…</>
          )}
        </div>
      )}

      {etapa === 'inicio' && (
        <TelaInicio aoMorador={() => setEtapa('cliente')} aoVisitante={() => setEtapa('cpf_visitante')} segurarLogo={segurarLogo} demo={api.modo === 'demo'}
          semInternet={semInternet} aoAlternarInternet={() => simularOffline(!semInternet)} />
      )}

      {etapa === 'cpf_visitante' && (
        <TelaCpf subtitulo="Obrigatório para compras de visitantes" aoVoltar={reiniciar} aoConfirmar={(cpf) => comecar({ tipo: 'visitante', cpf })} />
      )}

      {etapa === 'cpf_morador' && (
        <TelaCpf subtitulo="Obrigatório para comprar sem cadastro" aoVoltar={() => setEtapa('cliente')} aoConfirmar={(cpf) => comecar({ tipo: 'morador', cpf })} />
      )}

      {etapa === 'cliente' && (
        <TelaEscolhaMorador aoVoltar={reiniciar} aoUsarCadastro={() => setEtapa('identificacao')} aoCadastrar={() => setEtapa('cadastro')}
          aoSemCadastro={() => setEtapa('cpf_morador')} semInternet={semInternet} />
      )}

      {etapa === 'identificacao' && (
        <TelaIdentificacao aoVoltar={() => setEtapa('cliente')} aoIdentificar={(m) => comecar({ tipo: 'morador_cadastrado', morador: m })} />
      )}

      {etapa === 'cadastro' && (
        <TelaCadastro aoVoltar={() => setEtapa('cliente')} aoConcluir={(m) => {
          comecar({ tipo: 'morador_cadastrado', morador: m })
          setAviso(`Cadastro concluído, ${m.nome}! Nas próximas compras use o apto ${m.apartamento} e o seu PIN.`)
          setTimeout(() => setAviso(null), 7000)
        }} />
      )}

      {etapa === 'compra' && (
        <>
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-4">
            <button {...segurarLogo} onClick={reiniciar} className="flex items-center gap-2 rounded-xl p-1 text-emerald-700" aria-label="Início">
              <SimboloPickgo className="h-11 w-auto" />
            </button>
            {buscaAberta ? (
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-slate-400" />
                <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do produto"
                  className="h-14 w-full rounded-2xl border-2 border-emerald-500 bg-white pr-12 pl-12 text-xl outline-none" />
                <button onClick={() => { setBusca(''); setBuscaAberta(false) }} className="absolute top-1/2 right-3 -translate-y-1/2 p-1 text-slate-400" aria-label="Fechar busca"><X className="size-6" /></button>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-2xl font-bold">{cliente?.morador ? `Olá, ${cliente.morador.nome}!` : 'Escolha seus produtos'}</h1>
                  <p className="flex items-center gap-1.5 text-base text-slate-500">
                    {cliente?.tipo === 'visitante' ? <><UserRound className="size-4" /> Visitante · CPF {mascararCpf(cliente.cpf)}</>
                      : cliente?.morador ? <><BadgeCheck className="size-4 text-emerald-600" /> Apto {cliente.morador.apartamento}{cliente.morador.bloco ? ` · Bloco ${cliente.morador.bloco}` : ''}</>
                      : <><Building2 className="size-4" /> Morador · CPF {mascararCpf(cliente?.cpf)}</>}
                  </p>
                </div>
                <BotaoTopo onClick={() => setBuscaAberta(true)} rotulo="Buscar"><Search /></BotaoTopo>
              </>
            )}
            <BotaoTopo onClick={() => setCamera(true)} rotulo="Câmera"><Camera /></BotaoTopo>
            <BotaoTopo onClick={pedirCancelamento} rotulo="Cancelar" perigo><X /></BotaoTopo>
          </header>

          <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white px-5 py-3 [scrollbar-width:none]">
            <Chip ativo={!categoria} onClick={() => setCategoria(null)}>Todos</Chip>
            {categorias.map((c) => (
              <Chip key={c.id} ativo={categoria === c.id} onClick={() => setCategoria(c.id)}>
                <IconeCategoria icone={c.icone} cor={c.cor} tamanho="sm" /> {c.nome}
              </Chip>
            ))}
          </nav>

          <main className="flex-1 overflow-y-auto px-5 py-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visiveis.map((p) => {
                const noCarrinho = carrinho.find((i) => i.produto.id === p.id)?.qtd ?? 0
                return (
                  <div key={p.id} className={cx('relative flex flex-col overflow-hidden rounded-3xl border-2 bg-white shadow-sm transition',
                    noCarrinho ? 'border-emerald-500' : 'border-transparent', flash === p.id && 'ring-4 ring-emerald-300')}>
                    <button onClick={() => adicionar(p)} className="flex flex-1 flex-col text-left transition active:scale-[0.97]" aria-label={`Adicionar ${p.nome}`}>
                      <FotoProduto url={p.foto_url} nome={p.nome} icone={p.categoria_icone} cor={p.categoria_cor} className="aspect-[4/3] w-full rounded-none [&>span]:rounded-none" />
                      <div className="flex flex-1 flex-col p-4 pb-0">
                        {emPromocao(p) && p.promocao !== 'Promoção' && <p className="mb-0.5 truncate text-sm font-semibold text-rose-600">{p.promocao}</p>}
                        <p className="line-clamp-2 text-lg leading-snug font-semibold">{p.nome}</p>
                        <div className="mt-auto pt-2 leading-tight">
                          {emPromocao(p) && <span className="block text-base text-slate-400 line-through tabular-nums">{brl(p.preco_original)}</span>}
                          <span className={cx('text-2xl font-bold tabular-nums', emPromocao(p) ? 'text-rose-600' : 'text-emerald-700')}>{brl(p.preco_venda)}</span>
                        </div>
                      </div>
                    </button>
                    {emPromocao(p) && (
                      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-rose-600 px-3 py-1 text-base font-bold text-white shadow">
                        −{Math.round((1 - p.preco_venda / p.preco_original) * 100)}%
                      </span>
                    )}
                    {/* fora do botão do card: tirar e pôr ficam a um toque, direto no produto */}
                    <div className="flex items-center justify-end gap-2 p-4 pt-3">
                      {noCarrinho > 0 ? (
                        <>
                          <button onClick={() => adicionar(p, -1)} aria-label={noCarrinho === 1 ? `Tirar ${p.nome}` : `Diminuir ${p.nome}`}
                            className="grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600 ring-2 ring-rose-200 transition active:scale-90">
                            {noCarrinho === 1 ? <Trash2 className="size-5" /> : <Minus className="size-6" />}
                          </button>
                          {/* key muda a cada toque: o número "pula" quando a quantidade muda */}
                          <span key={noCarrinho} className="w-9 animate-pulo text-center text-2xl font-bold tabular-nums">{noCarrinho}</span>
                        </>
                      ) : null}
                      <button onClick={() => adicionar(p)} aria-label={`Adicionar ${p.nome}`}
                        className="grid size-12 place-items-center rounded-full bg-emerald-600 text-white transition active:scale-90">
                        <Plus className="size-6" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {visiveis.length === 0 && <p className="py-20 text-center text-xl text-slate-500">Nenhum produto encontrado.</p>}
          </main>

          <PainelCarrinho carrinho={carrinho} total={total} qtdItens={qtdItens} adicionar={adicionar} remover={remover}
            aoPagar={() => setEtapa('pagamento')} aoLimpar={() => setCarrinho([])} />
        </>
      )}

      {etapa === 'pagamento' && (
        <TelaPagamento total={total} qtdItens={qtdItens} carrinho={carrinho} adicionar={adicionar} remover={remover}
          cliente={cliente} apartamento={apartamento} setApartamento={setApartamento}
          processando={processando} aoVoltar={() => setEtapa('compra')} aoPagar={pagar} aoCancelar={pedirCancelamento}
          semInternet={semInternet} pixDisponivel={!!pix} aoPagarSemInternet={pagarSemInternet} />
      )}

      {etapa === 'pix_offline' && vendaOffline && pix && (
        <TelaPixOffline venda={vendaOffline} pix={pix} restanteMs={Math.max(0, LIMITE_PIX_OFFLINE_MS - ocioso)}
          aoConfirmar={confirmarPixOffline} aoVoltar={() => { setVendaOffline(null); setEtapa('pagamento') }} />
      )}

      {etapa === 'offline_ok' && vendaOffline && (
        <TelaOfflineOk venda={vendaOffline} ocioso={ocioso} aoConcluir={reiniciar} />
      )}

      {etapa === 'aguardando' && pagamento && compra && (
        <TelaAguardando pagamento={pagamento} total={compra.venda.total} restanteMs={Math.max(0, restanteMs)}
          aoCancelar={cancelarPagamento} aoSimular={(r) => api.simularPagamento(pagamento.id, r).catch((e) => setErro(String(e.message)))} />
      )}

      {etapa === 'aprovado' && compra && pagamento && (
        <TelaAprovado compra={compra} pagamento={pagamento} itens={itensPagos} cliente={cliente} apartamento={apartamento} ocioso={ocioso} aoConcluir={reiniciar} />
      )}

      {etapa === 'falha' && pagamento && (
        <TelaFalha pagamento={pagamento} aoTentarDeNovo={() => { setPagamento(null); setEtapa('pagamento') }} aoDesistir={reiniciar} />
      )}

      {/* aviso de inatividade */}
      {contaOciosidade && etapa !== 'aprovado' && etapa !== 'offline_ok' && ocioso >= AVISO_OCIOSO_MS && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-8 backdrop-blur-sm">
          <div className="w-full max-w-md animate-entrar rounded-3xl bg-white p-8 text-center shadow-2xl">
            <Clock className="mx-auto size-14 text-amber-500" />
            <p className="mt-4 text-3xl font-bold">Ainda está aí?</p>
            <p className="mt-2 text-xl text-slate-600">Voltando ao início em {Math.ceil((OCIOSO_MS - ocioso) / 1000)} s</p>
            <button className="mt-6 h-16 w-full rounded-2xl bg-emerald-600 text-xl font-semibold text-white">Continuar comprando</button>
          </div>
        </div>
      )}

      {confirmarCancelar && (etapa === 'compra' || etapa === 'pagamento') && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-cancelar">
          <div className="w-full max-w-md animate-entrar rounded-3xl bg-white p-8 text-center shadow-2xl">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-rose-50 text-rose-600"><ShoppingCart className="size-8" /></span>
            <p id="titulo-cancelar" className="mt-4 text-3xl font-bold">Cancelar a compra?</p>
            <p className="mt-2 text-xl text-slate-600">
              {qtdItens} {qtdItens === 1 ? 'item' : 'itens'} ({brl(total)}) {qtdItens === 1 ? 'sai' : 'saem'} do carrinho e nada é cobrado.
            </p>
            <div className="mt-6 grid gap-3">
              <button onClick={reiniciar} className="h-16 rounded-2xl bg-rose-600 text-xl font-semibold text-white active:bg-rose-700">Sim, cancelar compra</button>
              <button onClick={() => setConfirmarCancelar(false)} className="h-16 rounded-2xl bg-slate-100 text-xl font-semibold text-slate-800 active:bg-slate-200">Continuar comprando</button>
            </div>
          </div>
        </div>
      )}

      {aviso && (
        <div className="fixed inset-x-6 top-6 z-50 flex animate-entrar items-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-medium text-white shadow-xl" role="status">
          <CircleCheck className="size-6 shrink-0" /> <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar"><X className="size-6" /></button>
        </div>
      )}

      {erro && (
        <div className="fixed inset-x-6 top-6 z-50 flex animate-entrar items-center gap-3 rounded-2xl bg-rose-600 px-6 py-4 text-lg font-medium text-white shadow-xl" role="alert">
          <CircleX className="size-6 shrink-0" /> <span className="flex-1">{erro}</span>
          <button onClick={() => setErro(null)} aria-label="Fechar"><X className="size-6" /></button>
        </div>
      )}

      <LeitorCamera aberto={camera} aoFechar={() => setCamera(false)} aoLer={aoLerCodigo} frontal />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** produto com promoção vigente (catálogo antigo guardado sem preco_original conta como sem promoção) */
const emPromocao = (p: ItemCatalogo) => !!p.promocao && p.preco_original > p.preco_venda

function TelaInicio({ aoMorador, aoVisitante, segurarLogo, demo, semInternet, aoAlternarInternet }: {
  aoMorador: () => void; aoVisitante: () => void; segurarLogo: object; demo: boolean; semInternet: boolean; aoAlternarInternet: () => void
}) {
  const baixo = '[@media(max-height:820px)]'
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-creme">
      {/* círculos decorativos */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -top-40 -left-40 size-96 rounded-full bg-circulo" />
        <span className="absolute -right-32 -bottom-32 size-96 rounded-full bg-circulo" />
        <span className="absolute -bottom-28 -left-24 size-60 rounded-full bg-circulo" />
      </div>

      <div className={cx('relative flex min-h-full flex-col items-center justify-center px-8 py-12 text-center', `${baixo}:py-6`)}>
        <div {...segurarLogo}>
          <LogoPickgo animado className={cx('text-8xl sm:text-9xl', `${baixo}:text-7xl`)} />
        </div>
        <p className={cx('mt-6 max-w-4xl text-2xl font-medium text-marca-escura sm:text-3xl', `${baixo}:mt-3 ${baixo}:text-2xl`)}>
          Pegue o produto, registre aqui e pague com PIX ou cartão.
        </p>

        {/* passos numerados, sem caixa: é instrução, não botão (os únicos botões são morador/visitante) */}
        <div className={cx('mt-10 w-full max-w-4xl', `${baixo}:mt-6`)}>
          <p className="text-sm font-semibold tracking-[0.2em] text-texto-suave uppercase">Como funciona</p>
          <ol className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
            {[
              { t: 'Identifique-se', d: 'morador ou visitante' },
              { t: 'Bipe os produtos', d: 'no leitor ou na câmera' },
              { t: 'Pague', d: 'PIX, crédito ou débito' },
            ].map((x, n) => (
              <Fragment key={n}>
                {n > 0 && <ChevronRight aria-hidden="true" className="hidden size-7 shrink-0 text-folha sm:block" />}
                <li className="flex items-center gap-3 text-left text-marca-escura">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-folha text-xl font-bold text-marca">{n + 1}</span>
                  <span>
                    <span className="block text-xl leading-tight font-bold">{x.t}</span>
                    <span className="block text-base text-marca-escura/70">{x.d}</span>
                  </span>
                </li>
              </Fragment>
            ))}
          </ol>
        </div>

        <p className={cx('mt-10 text-3xl font-bold text-marca-escura', `${baixo}:mt-6 ${baixo}:text-2xl`)}>Para começar, toque em uma opção</p>
        <div className="mt-6 grid w-full max-w-3xl gap-5 sm:grid-cols-2">
          <button onClick={aoMorador}
            className={cx('flex h-40 flex-col items-center justify-center gap-3 rounded-[2rem] bg-marca text-white shadow-lg shadow-marca/25 transition active:scale-95', `${baixo}:h-28`)}>
            <Building2 className="size-12" strokeWidth={1.8} />
            <span className="text-4xl font-bold">Sou morador</span>
          </button>
          <button onClick={aoVisitante}
            className={cx('flex h-40 flex-col items-center justify-center gap-3 rounded-[2rem] border-[3px] border-emerald-300 bg-white/70 text-marca-escura transition active:scale-95', `${baixo}:h-28`)}>
            <UserRound className="size-12" strokeWidth={1.8} />
            <span className="text-4xl font-bold">Sou visitante</span>
          </button>
        </div>

        {demo && (
          <p className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-base text-texto-suave">
            Modo demonstração · pagamentos simulados
            <button onClick={aoAlternarInternet}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white/70 px-3 py-1 text-sm font-medium text-marca">
              {semInternet ? <><Wifi className="size-4" /> Voltar a internet</> : <><WifiOff className="size-4" /> Simular sem internet</>}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

function TelaEscolhaMorador({ aoVoltar, aoUsarCadastro, aoCadastrar, aoSemCadastro, semInternet }: {
  aoVoltar: () => void; aoUsarCadastro: () => void; aoCadastrar: () => void; aoSemCadastro: () => void; semInternet: boolean
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      <button onClick={aoVoltar} className="flex items-center gap-2 self-start rounded-xl py-2 text-xl text-slate-600"><ArrowLeft className="size-7" /> Voltar</button>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Building2 className="size-16 text-emerald-600" strokeWidth={1.6} />
        <h1 className="mt-4 text-center text-4xl font-extrabold">Como você quer comprar?</h1>
        {semInternet && (
          <p className="mt-4 flex max-w-xl items-center gap-2 rounded-2xl bg-amber-50 px-5 py-3 text-lg text-amber-900 ring-1 ring-amber-200">
            <WifiOff className="size-6 shrink-0" /> Sem internet: o cadastro fica indisponível por enquanto. Você pode comprar normalmente sem cadastro.
          </p>
        )}
        <div className="mt-10 grid w-full max-w-xl gap-5">
          <OpcaoGrande onClick={aoUsarCadastro} icone={<IdCard className="size-12" />} cor="bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
            titulo="Usar meu cadastro" texto="Apartamento + PIN. O comprovante vai direto para o seu contato." desabilitado={semInternet} />
          <OpcaoGrande onClick={aoCadastrar} icone={<UserPlus className="size-12" />} cor="bg-white text-emerald-800 ring-2 ring-emerald-300"
            titulo="Fazer meu cadastro" texto="Leva 1 minuto. Nas próximas compras é só apartamento + PIN." desabilitado={semInternet} />
          <OpcaoGrande onClick={aoSemCadastro} icone={<ShoppingCart className="size-12" />} cor="bg-white text-slate-800 ring-2 ring-slate-200"
            titulo="Iniciar sem cadastro" texto="Informe seu CPF e compre; o apartamento é opcional." />
        </div>
      </div>
    </div>
  )
}

function OpcaoGrande({ onClick, icone, cor, titulo, texto, desabilitado }: {
  onClick: () => void; icone: React.ReactNode; cor: string; titulo: string; texto: string; desabilitado?: boolean
}) {
  return (
    <button onClick={onClick} disabled={desabilitado}
      className={cx('flex min-h-32 items-center gap-6 rounded-3xl px-8 py-6 text-left transition active:scale-[0.98] disabled:opacity-40 disabled:grayscale', cor)}>
      {icone}
      <span className="flex-1">
        <span className="block text-3xl font-bold">{titulo}</span>
        <span className="mt-1 block text-lg opacity-80">{texto}</span>
      </span>
      <ChevronRight className="size-8 opacity-60" />
    </button>
  )
}

function TelaIdentificacao({ aoVoltar, aoIdentificar }: { aoVoltar: () => void; aoIdentificar: (m: MoradorIdentificado) => void }) {
  const { api } = useSessao()
  const [apto, setApto] = useState('')
  const [pin, setPin] = useState('')
  const [campo, setCampo] = useState<'apto' | 'pin'>('apto')
  const [verPin, setVerPin] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const valor = campo === 'apto' ? apto : pin
  const setValor = campo === 'apto' ? setApto : setPin

  function tecla(t: string) {
    setErro(null)
    if (t === 'apagar') setValor(valor.slice(0, -1))
    else if (valor.length < 6) setValor(valor + t)
  }

  async function confirmar() {
    if (campo === 'apto') {
      if (apto) setCampo('pin')
      return
    }
    if (pin.length < 4) return setErro('O PIN tem de 4 a 6 números.')
    setEnviando(true)
    try {
      aoIdentificar(await api.identificarMorador(apto, pin))
    } catch (e) {
      setErro((e as Error).message)
      setPin('')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      <button onClick={aoVoltar} className="flex items-center gap-2 self-start rounded-xl py-2 text-xl text-slate-600"><ArrowLeft className="size-7" /> Voltar</button>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <h1 className="text-center text-4xl font-extrabold">Identifique-se</h1>
        <p className="mt-2 text-center text-xl text-slate-500">Digite o número do apartamento e o seu PIN</p>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <CampoTeclado rotulo="Apartamento" valor={apto} ativo={campo === 'apto'} onClick={() => setCampo('apto')} />
          <CampoTeclado rotulo="PIN" valor={verPin ? pin : '•'.repeat(pin.length)} ativo={campo === 'pin'} onClick={() => apto && setCampo('pin')}
            acao={<BotaoVerPin visivel={verPin} alternar={() => setVerPin(!verPin)} />} />
        </div>
        <p className={cx('mt-3 min-h-7 text-center text-lg', erro ? 'font-medium text-rose-600' : 'invisible')} role="alert">{erro ?? '.'}</p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => <Tecla key={n} onClick={() => tecla(n)}>{n}</Tecla>)}
          <Tecla onClick={() => tecla('apagar')} rotulo="Apagar"><Delete className="size-8" /></Tecla>
          <Tecla onClick={() => tecla('0')}>0</Tecla>
          <button onClick={confirmar} disabled={enviando || !valor}
            className="flex h-20 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white disabled:bg-slate-300">
            {enviando ? <CarrinhoAnimado className="h-8 w-auto" rotulo="Entrando" /> : campo === 'apto' ? 'Próximo' : 'Entrar'}
          </button>
        </div>
        <p className="mt-6 text-center text-base text-slate-500">Esqueceu o PIN ou ainda não tem cadastro? Fale com a administração do condomínio.</p>
      </div>
    </div>
  )
}

/** Visitante e morador sem cadastro informam o CPF (obrigatório) antes de comprar */
function TelaCpf({ subtitulo, aoVoltar, aoConfirmar }: { subtitulo: string; aoVoltar: () => void; aoConfirmar: (cpf: string) => void }) {
  const [digitos, setDigitos] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const completo = digitos.length === 11
  const valido = completo && cpfValido(digitos)

  function tecla(t: string) {
    setErro(null)
    if (t === 'apagar') setDigitos((d) => d.slice(0, -1))
    else setDigitos((d) => (d.length < 11 ? d + t : d))
  }
  function continuar() {
    if (!valido) return setErro('CPF inválido. Confira os números.')
    aoConfirmar(digitos)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <button onClick={aoVoltar} className="flex items-center gap-2 self-start rounded-xl py-2 text-xl text-slate-600"><ArrowLeft className="size-7" /> Voltar</button>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <UserRound className="mx-auto size-14 text-emerald-600" strokeWidth={1.6} />
        <h1 className="mt-3 text-center text-4xl font-extrabold">Informe seu CPF</h1>
        <p className="mt-2 text-center text-xl text-slate-500">{subtitulo}</p>

        <div className={cx('mt-8 rounded-2xl border-2 bg-white px-5 py-4 text-center',
          completo ? (valido ? 'border-emerald-500 ring-4 ring-emerald-100' : 'border-rose-400 ring-4 ring-rose-100') : 'border-slate-200')}>
          <span className="text-4xl font-bold tracking-wider tabular-nums">{formatarCpf(digitos) || <span className="text-slate-300">000.000.000-00</span>}</span>
        </div>
        <p className={cx('mt-3 min-h-7 text-center text-lg font-medium', erro || (completo && !valido) ? 'text-rose-600' : 'invisible')} role="alert">
          {erro ?? 'CPF inválido. Confira os números.'}
        </p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => <Tecla key={n} onClick={() => tecla(n)}>{n}</Tecla>)}
          <Tecla onClick={() => tecla('apagar')} rotulo="Apagar"><Delete className="size-8" /></Tecla>
          <Tecla onClick={() => tecla('0')}>0</Tecla>
          <button onClick={continuar} disabled={!valido}
            className="flex h-20 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white disabled:bg-slate-300">
            Continuar
          </button>
        </div>
        <p className="mt-6 text-center text-base text-slate-500">O CPF fica registrado só na sua compra, para segurança do mercado, e não é mostrado na tela.</p>
      </div>
    </div>
  )
}

function TelaCadastro({ aoVoltar, aoConcluir }: { aoVoltar: () => void; aoConcluir: (m: MoradorIdentificado) => void }) {
  const { api } = useSessao()
  const [f, setF] = useState({ nome: '', cpf: '', apartamento: '', bloco: '', email: '', pin: '', pin2: '', aceite: false })
  const [verPin, setVerPin] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const set = (k: keyof typeof f, limpar?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setErro(null)
    setF((x) => ({ ...x, [k]: limpar ? limpar(e.target.value) : e.target.value }))
  }
  const soNumeros = (v: string) => v.replace(/\D/g, '').slice(0, 6)

  async function concluir(e: React.FormEvent) {
    e.preventDefault()
    if (f.nome.trim().length < 3) return setErro('Informe seu nome.')
    if (!cpfValido(f.cpf)) return setErro('CPF inválido. Confira os números.')
    if (!f.apartamento.trim()) return setErro('Informe o número do apartamento.')
    if (!/^\d{4,6}$/.test(f.pin)) return setErro('O PIN deve ter de 4 a 6 números.')
    if (f.pin !== f.pin2) return setErro('Os dois PINs não são iguais.')
    if (!f.aceite) return setErro('Marque a autorização para concluir o cadastro.')
    setEnviando(true)
    try {
      aoConcluir(await api.cadastrarMoradorTotem({
        nome: f.nome, cpf: somenteDigitos(f.cpf), apartamento: f.apartamento, bloco: f.bloco || null, telefone: null,
        email: f.email || null, pin: f.pin, aceite: f.aceite,
      }))
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const campo = 'mt-2 h-16 w-full rounded-2xl border-2 border-slate-200 bg-white px-5 text-2xl outline-none focus:border-emerald-500'
  const rotulo = 'block text-xl font-medium text-slate-700'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <button onClick={aoVoltar} className="flex items-center gap-2 self-start rounded-xl py-2 text-xl text-slate-600"><ArrowLeft className="size-7" /> Voltar</button>
      <form onSubmit={concluir} className="mx-auto w-full max-w-xl pb-6">
        <div className="mt-2 flex items-center gap-4">
          <span className="grid size-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UserPlus className="size-9" /></span>
          <div>
            <h1 className="text-4xl font-extrabold">Fazer meu cadastro</h1>
            <p className="text-lg text-slate-500">Depois é só apartamento + PIN.</p>
          </div>
        </div>

        <div className="mt-8 grid gap-5">
          <label className={rotulo}>Nome completo
            <input className={campo} value={f.nome} onChange={set('nome')} autoComplete="off" maxLength={100} placeholder="Como você se chama" />
          </label>
          <label className={rotulo}>CPF
            <input className={cx(campo, f.cpf.length === 14 && !cpfValido(f.cpf) && 'border-rose-400')} value={f.cpf} onChange={set('cpf', formatarCpf)}
              inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" />
            {f.cpf.length === 14 && !cpfValido(f.cpf) && <span className="mt-1 block text-base font-normal text-rose-600">CPF inválido. Confira os números.</span>}
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={rotulo}>Apartamento
              <input className={campo} value={f.apartamento} onChange={set('apartamento', (v) => v.toUpperCase().slice(0, 10))} inputMode="numeric" placeholder="101" />
            </label>
            <label className={rotulo}>Bloco <span className="text-slate-400">(se houver)</span>
              <input className={campo} value={f.bloco} onChange={set('bloco', (v) => v.toUpperCase().slice(0, 10))} placeholder="A" />
            </label>
          </div>
          <label className={rotulo}>E-mail <span className="text-slate-400">(opcional, para receber o comprovante)</span>
            <input className={campo} value={f.email} onChange={set('email')} type="email" inputMode="email" autoComplete="off" placeholder="nome@email.com" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={rotulo}>Crie um PIN
              <input className={cx(campo, 'tracking-[0.4em] placeholder:text-xl placeholder:tracking-normal')} value={f.pin} onChange={set('pin', soNumeros)} type={verPin ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" placeholder="4 a 6 números" />
            </label>
            <label className={rotulo}>Repita o PIN
              <input className={cx(campo, 'tracking-[0.4em] placeholder:text-xl placeholder:tracking-normal')} value={f.pin2} onChange={set('pin2', soNumeros)} type={verPin ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" />
            </label>
            <button type="button" onClick={() => setVerPin(!verPin)} aria-pressed={verPin}
              className="col-span-2 -mt-2 flex items-center gap-2 justify-self-start rounded-xl px-2 py-2 text-lg text-slate-600 active:bg-slate-100">
              {verPin ? <EyeOff className="size-6" /> : <Eye className="size-6" />} {verPin ? 'Esconder PIN' : 'Mostrar PIN'}
            </button>
          </div>
          <label className="flex cursor-pointer items-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <input type="checkbox" checked={f.aceite} onChange={(e) => { setErro(null); setF((x) => ({ ...x, aceite: e.target.checked })) }}
              className="mt-1 size-7 shrink-0 accent-emerald-600" />
            <span className="text-lg text-slate-700">
              Autorizo o condomínio a guardar meu nome, CPF, apartamento e e-mail para identificar minhas compras e enviar comprovantes.
              Posso pedir a exclusão a qualquer momento na administração.
            </span>
          </label>
        </div>

        <p className={cx('mt-4 min-h-7 text-center text-lg font-medium text-rose-600', !erro && 'invisible')} role="alert">{erro ?? '.'}</p>
        <button type="submit" disabled={enviando}
          className="mt-2 flex h-20 w-full items-center justify-center gap-3 rounded-3xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30 disabled:opacity-60">
          {enviando && <CarrinhoAnimado className="h-8 w-auto" rotulo="Salvando cadastro" />} Concluir cadastro e comprar
        </button>
      </form>
    </div>
  )
}

function CampoTeclado({ rotulo, valor, ativo, onClick, acao }: { rotulo: string; valor: string; ativo: boolean; onClick: () => void; acao?: React.ReactNode }) {
  return (
    <div className="relative">
      <button onClick={onClick} className={cx('w-full rounded-2xl border-2 bg-white px-5 py-3 text-left transition', !!acao && 'pr-16', ativo ? 'border-emerald-500 ring-4 ring-emerald-100' : 'border-slate-200')}>
        <span className="block text-base text-slate-500">{rotulo}</span>
        <span className="block h-10 text-3xl font-bold tracking-widest tabular-nums">{valor || <span className="text-slate-300">—</span>}</span>
      </button>
      {acao && <div className="absolute inset-y-0 right-2 flex items-center">{acao}</div>}
    </div>
  )
}

/** Botão de olho para mostrar/esconder o PIN */
function BotaoVerPin({ visivel, alternar }: { visivel: boolean; alternar: () => void }) {
  return (
    <button type="button" onClick={alternar} aria-label={visivel ? 'Esconder PIN' : 'Mostrar PIN'} aria-pressed={visivel}
      className="grid size-12 place-items-center rounded-xl text-slate-500 active:bg-slate-100">
      {visivel ? <EyeOff className="size-7" /> : <Eye className="size-7" />}
    </button>
  )
}

function Tecla({ onClick, rotulo, children }: { onClick: () => void; rotulo?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={rotulo} className="grid h-20 place-items-center rounded-2xl bg-white text-3xl font-semibold shadow-sm ring-1 ring-slate-200 active:bg-slate-100">
      {children}
    </button>
  )
}

/** Lista dos produtos escolhidos, com quantidade editável e botão para tirar o item */
function ListaItens({ carrinho, adicionar, remover, desabilitado }: {
  carrinho: ItemCarrinho[]; adicionar: (p: ItemCatalogo, n: number) => void; remover: (p: ItemCatalogo) => void; desabilitado?: boolean
}) {
  return (
    // @container: em espaço estreito (tela de pagamento deitada) o "Tirar" vira só o ícone
    <ul className="@container divide-y divide-slate-100">
      {carrinho.map(({ produto: p, qtd }) => (
        <li key={p.id} className="flex items-center gap-x-3 py-3 @xl:gap-x-4">
          <FotoProduto url={p.foto_url} nome={p.nome} icone={p.categoria_icone} cor={p.categoria_cor} className="size-12 shrink-0 @xl:size-14" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-lg leading-snug font-medium">{p.nome}</p>
            <p className="text-slate-500 tabular-nums">
              {emPromocao(p) && <span className="mr-1.5 text-slate-400 line-through">{brl(p.preco_original)}</span>}
              <span className={cx(emPromocao(p) && 'font-medium text-rose-600')}>{brl(p.preco_venda)}</span> un.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <BotaoQtd onClick={() => adicionar(p, -1)} rotulo="Diminuir" desabilitado={desabilitado || qtd === 1}><Minus /></BotaoQtd>
            <span key={qtd} className="w-7 animate-pulo text-center text-2xl font-bold tabular-nums">{qtd}</span>
            <BotaoQtd onClick={() => adicionar(p, 1)} rotulo="Aumentar" desabilitado={desabilitado}><Plus /></BotaoQtd>
          </div>
          <span className="w-24 shrink-0 text-right text-xl font-semibold tabular-nums">{brl(p.preco_venda * qtd)}</span>
          <button onClick={() => remover(p)} disabled={desabilitado} aria-label={`Tirar ${p.nome}`}
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-rose-50 px-3 text-base font-medium text-rose-600 ring-1 ring-rose-200 transition active:scale-95 disabled:opacity-40">
            <Trash2 className="size-5" /> <span className="hidden @xl:inline">Tirar</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function PainelCarrinho({ carrinho, total, qtdItens, adicionar, remover, aoPagar, aoLimpar }: {
  carrinho: ItemCarrinho[]; total: number; qtdItens: number; adicionar: (p: ItemCatalogo, n: number) => void; remover: (p: ItemCatalogo) => void
  aoPagar: () => void; aoLimpar: () => void
}) {
  const [expandido, setExpandido] = useState(false)
  useEffect(() => { if (carrinho.length === 0) setExpandido(false) }, [carrinho.length])
  return (
    <section className="shrink-0 rounded-t-[2rem] border-t border-slate-200 bg-white shadow-[0_-12px_40px_-12px_rgb(15_23_42/0.25)]">
      {expandido && (
        <div className="max-h-[45dvh] overflow-y-auto border-b border-slate-100 px-5 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-2xl font-bold">Seu carrinho</h2>
            <button onClick={aoLimpar} className="flex items-center gap-2 rounded-xl px-3 py-2 text-lg text-rose-600"><Trash2 className="size-5" /> Esvaziar</button>
          </div>
          <ListaItens carrinho={carrinho} adicionar={adicionar} remover={remover} />
        </div>
      )}
      <div className="flex items-center gap-4 px-5 py-4">
        <button onClick={() => carrinho.length && setExpandido(!expandido)} className="flex flex-1 items-center gap-4 text-left" disabled={!carrinho.length}>
          <span className="relative grid size-16 place-items-center rounded-2xl bg-slate-100">
            <ShoppingCart className="size-8 text-slate-700" />
            {qtdItens > 0 && <span key={qtdItens} className="absolute -top-2 -right-2 grid size-8 animate-pulo place-items-center rounded-full bg-emerald-600 text-base font-bold text-white">{qtdItens}</span>}
          </span>
          <span>
            <span className="block text-lg text-slate-500">{qtdItens ? (expandido ? 'Fechar carrinho' : 'Ver carrinho') : 'Carrinho vazio'}</span>
            <span key={total} className={cx('block origin-left text-4xl font-extrabold tabular-nums', total > 0 && 'animate-pulo-leve')}>{brl(total)}</span>
          </span>
        </button>
        <button onClick={aoPagar} disabled={!carrinho.length}
          className="h-20 rounded-3xl bg-emerald-600 px-10 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30 transition active:scale-95 disabled:bg-slate-300 disabled:shadow-none">
          Pagar
        </button>
      </div>
    </section>
  )
}

function TelaPagamento({ total, qtdItens, carrinho, adicionar, remover, cliente, apartamento, setApartamento, processando, aoVoltar, aoPagar, aoCancelar, semInternet, pixDisponivel, aoPagarSemInternet }: {
  total: number; qtdItens: number; carrinho: ItemCarrinho[]; adicionar: (p: ItemCatalogo, n: number) => void; remover: (p: ItemCatalogo) => void
  cliente: Cliente | null; apartamento: string; setApartamento: (v: string) => void
  processando: MetodoPagamento | null; aoVoltar: () => void; aoPagar: (m: MetodoPagamento) => void; aoCancelar: () => void
  semInternet: boolean; pixDisponivel: boolean; aoPagarSemInternet: () => void
}) {
  const opcoes: { m: MetodoPagamento; t: string; d: string; i: React.ReactNode; cor: string }[] = [
    { m: 'pix', t: 'PIX', d: 'QR Code no celular', i: <QrCode className="size-11" />, cor: 'bg-marca text-white shadow-lg shadow-marca/25' },
    { m: 'cartao_debito', t: 'Débito', d: 'Cartão de débito', i: <CreditCard className="size-11" />, cor: 'border-[3px] border-emerald-300 bg-white text-marca-escura' },
    { m: 'cartao_credito', t: 'Crédito', d: 'Crédito à vista', i: <WalletCards className="size-11" />, cor: 'border-[3px] border-emerald-300 bg-white text-marca-escura' },
  ]
  const economia = carrinho.reduce((s, i) => s + (emPromocao(i.produto) ? Math.round((i.produto.preco_original - i.produto.preco_venda) * 100) * i.qtd : 0), 0) / 100
  // botão: em pé os três ficam lado a lado (ícone em cima); deitado ficam na coluna da direita
  const botao = 'flex min-h-36 flex-col items-center justify-center gap-2 rounded-3xl px-3 text-center transition active:scale-[0.98] disabled:opacity-60 '
    + 'lg:min-h-28 lg:flex-row lg:justify-start lg:gap-5 lg:px-6 lg:text-left'
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <button onClick={aoVoltar} className="flex items-center gap-2 rounded-xl py-2 text-xl text-slate-600"><ArrowLeft className="size-7" /> Voltar ao carrinho</button>
        <button onClick={aoCancelar} disabled={!!processando}
          className="flex h-14 items-center gap-2 rounded-2xl bg-rose-50 px-5 text-lg font-medium text-rose-700 ring-1 ring-rose-200 active:bg-rose-100 disabled:opacity-40">
          <X className="size-6" /> Cancelar compra
        </button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div>
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Confira sua compra</h2>
          <button onClick={aoVoltar} disabled={!!processando}
            className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-lg font-medium text-emerald-800 ring-1 ring-emerald-200 disabled:opacity-40">
            <Plus className="size-5" /> Adicionar mais
          </button>
        </div>
        <div className="mt-2">
          <ListaItens carrinho={carrinho} adicionar={adicionar} remover={remover} desabilitado={!!processando} />
        </div>
        <div className="mt-2 flex items-end justify-between border-t border-slate-200 pt-4">
          <span className="text-xl text-slate-500">Total · {qtdItens} {qtdItens === 1 ? 'item' : 'itens'}</span>
          <span className="text-5xl font-extrabold tabular-nums">{brl(total)}</span>
        </div>
        {economia > 0 && (
          <p className="mt-2 text-right text-lg font-medium text-rose-600">Você economiza {brl(economia)} com promoções</p>
        )}
      </div>

      {/* visitante não informa apartamento; morador cadastrado já vem identificado */}
      {cliente?.morador ? (
        <div className="mt-6 flex items-center gap-4 rounded-3xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
          <BadgeCheck className="size-10 text-emerald-600" />
          <div>
            <p className="text-2xl font-bold text-emerald-900">{cliente.morador.nome}</p>
            <p className="text-lg text-emerald-800">Apto {cliente.morador.apartamento}{cliente.morador.bloco ? ` · Bloco ${cliente.morador.bloco}` : ''}</p>
          </div>
        </div>
      ) : cliente?.tipo === 'visitante' ? null : (
        <label className="mt-6 block">
          <span className="text-xl font-medium text-slate-700">Apartamento <span className="text-slate-400">(opcional)</span></span>
          <input value={apartamento} onChange={(e) => setApartamento(e.target.value.slice(0, 10))} inputMode="numeric" placeholder="Ex.: 101 ou 12B"
            className="mt-2 h-16 w-full rounded-2xl border-2 border-slate-200 bg-white px-5 text-2xl outline-none focus:border-emerald-500" />
        </label>
      )}
      </div>

      {/* formas de pagamento: deitado ficam fixas na direita, sempre à vista */}
      <div className="lg:sticky lg:top-0">
      <h2 className="mb-4 text-2xl font-bold">Como você quer pagar?</h2>
      {semInternet ? (
        pixDisponivel ? (
          <div className="grid gap-4">
            <button onClick={aoPagarSemInternet}
              className="flex min-h-32 items-center gap-6 rounded-3xl bg-marca px-8 text-left text-white shadow-lg shadow-marca/25 transition active:scale-[0.98]">
              <QrCode className="size-12" />
              <span>
                <span className="block text-3xl font-bold">PIX direto</span>
                <span className="block text-lg opacity-90">Funciona sem a internet do totem: você paga pelo celular com o QR Code</span>
              </span>
            </button>
            <p className="flex items-center gap-2 rounded-2xl bg-slate-100 px-5 py-4 text-lg text-slate-600">
              <WifiOff className="size-6 shrink-0" /> Cartão indisponível enquanto o totem estiver sem internet.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-3 rounded-2xl bg-amber-50 px-6 py-5 text-xl text-amber-900 ring-1 ring-amber-200">
            <WifiOff className="size-7 shrink-0" /> O totem está sem internet. Use o QR Code PIX afixado no mercado ou procure a administração.
          </p>
        )
      ) : (
      <div className="grid grid-cols-3 gap-4 lg:grid-cols-1">
        {opcoes.map((o) => (
          <button key={o.m} onClick={() => aoPagar(o.m)} disabled={!!processando} className={cx(botao, o.cor)}>
            <span className="shrink-0">{processando === o.m ? <CarrinhoAnimado className="h-11 w-auto" rotulo="Preparando o pagamento" /> : o.i}</span>
            <span>
              <span className="block text-3xl font-bold">{o.t}</span>
              <span className="block text-base opacity-85 lg:text-lg">{o.d}</span>
            </span>
          </button>
        ))}
      </div>
      )}
      </div>
      </div>
    </div>
  )
}

/** PIX estático gerado no próprio totem (sem internet), com o valor exato */
function TelaPixOffline({ venda, pix, restanteMs, aoConfirmar, aoVoltar }: {
  venda: VendaOffline; pix: PixTotem; restanteMs: number; aoConfirmar: () => void; aoVoltar: () => void
}) {
  const [copiado, setCopiado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const codigo = useMemo(() => gerarPixEstatico({ chave: pix.chave, nome: pix.nome, cidade: pix.cidade, valor: venda.total, txid: venda.txid }), [pix, venda])
  const min = Math.floor(restanteMs / 60_000)
  const seg = Math.floor((restanteMs % 60_000) / 1000)

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8 text-center">
      <p className="text-xl font-medium text-slate-500">Total a pagar</p>
      <p className="text-6xl font-extrabold tabular-nums">{brl(venda.total)}</p>

      <div className="mt-6 w-full max-w-lg rounded-[2rem] bg-white p-8 shadow-sm">
        <p className="flex items-center justify-center gap-2 text-2xl font-bold text-marca"><QrCode className="size-7" /> Pague com PIX pelo celular</p>
        <p className="mt-1 text-lg text-slate-500">Abra o app do seu banco e leia o QR Code. O valor já vem preenchido.</p>
        <div className="mx-auto mt-6 w-fit rounded-3xl border-4 border-emerald-200 bg-white p-4">
          <QRCodeSVG value={codigo} size={288} level="M" />
        </div>
        <p className="mt-4 text-lg text-slate-700">Recebedor: <strong>{pix.nome}</strong></p>
        <button onClick={() => navigator.clipboard?.writeText(codigo).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })}
          className="mt-2 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-lg text-marca hover:bg-emerald-50">
          <Copy className="size-5" /> {copiado ? 'Copiado!' : 'Copiar código PIX'}
        </button>
        <p className="mt-2 text-sm text-slate-400">Identificador: {venda.txid}</p>
      </div>

      <div className="mt-6 w-full max-w-lg rounded-3xl bg-amber-50 p-5 text-left text-lg text-amber-900 ring-1 ring-amber-200">
        <p className="flex items-center gap-2 font-semibold"><WifiOff className="size-5" /> O totem está sem internet</p>
        <p className="mt-1">Ele não consegue confirmar o pagamento sozinho. Depois de pagar, toque em <strong>“Já paguei”</strong>.
          A administração confere o recebimento no extrato.</p>
      </div>

      {confirmando ? (
        <div className="mt-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-2xl font-bold">O PIX de {brl(venda.total)} foi concluído no seu banco?</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button onClick={() => setConfirmando(false)} className="h-16 rounded-2xl text-xl ring-2 ring-slate-200">Ainda não</button>
            <button onClick={aoConfirmar} className="h-16 rounded-2xl bg-emerald-600 text-xl font-bold text-white">Sim, paguei</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmando(true)} className="mt-6 flex h-20 w-full max-w-lg items-center justify-center gap-3 rounded-3xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30">
          <CircleCheck className="size-7" /> Já paguei
        </button>
      )}
      <button onClick={aoVoltar} className="mt-4 h-14 rounded-2xl px-8 text-lg text-slate-600 ring-2 ring-slate-200">Voltar</button>
      <p className="mt-3 flex items-center gap-2 text-base text-slate-400 tabular-nums"><Hourglass className="size-4" /> Esta tela fecha em {min}:{String(seg).padStart(2, '0')}</p>
    </div>
  )
}

function TelaOfflineOk({ venda, ocioso, aoConcluir }: { venda: VendaOffline; ocioso: number; aoConcluir: () => void }) {
  const restante = Math.min(OCIOSO_MS / 1000, Math.max(0, Math.ceil((OCIOSO_MS - ocioso) / 1000)))
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
      <Confete />
      <SeloAprovado />
      <h1 {...emSeq(0.35)} className="entra-em-seq mt-5 text-center text-5xl font-extrabold text-emerald-700">Compra registrada!</h1>
      <p {...emSeq(0.45)} className="entra-em-seq mt-2 max-w-lg text-center text-2xl text-slate-600">Obrigado. Pode levar seus produtos. O pagamento será conferido pela administração.</p>
      <div {...emSeq(0.6)} className="entra-em-seq mt-8 w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-sm">
        <div className="flex justify-between text-lg text-slate-500">
          <span>PIX sem internet</span>
          <span>{dataHoraBR(venda.criado_em)}</span>
        </div>
        <ul className="mt-4 divide-y divide-dashed divide-slate-200 border-y border-dashed border-slate-200">
          {venda.itens.map((i) => (
            <li key={i.produto_id} className="flex justify-between gap-4 py-2.5 text-lg">
              <span>{i.quantidade}× {i.nome}</span>
              <span className="tabular-nums">{brl(i.preco_unitario * i.quantidade)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-end justify-between">
          <span className="text-sm text-slate-400">Identificador {venda.txid}</span>
          <span className="text-3xl font-extrabold tabular-nums">{brl(venda.total)}</span>
        </div>
      </div>
      <button onClick={aoConcluir} className="mt-8 flex h-20 w-full max-w-lg items-center justify-center gap-3 rounded-3xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30">
        <House className="size-7" /> Concluir
      </button>
      <p className="mt-3 text-lg text-slate-500">Voltando ao início em {restante} s</p>
    </div>
  )
}

function TelaAguardando({ pagamento, total, restanteMs, aoCancelar, aoSimular }: {
  pagamento: Pagamento; total: number; restanteMs: number; aoCancelar: () => void; aoSimular: (r: 'aprovado' | 'recusado') => Promise<unknown>
}) {
  const [copiado, setCopiado] = useState(false)
  const [simulando, setSimulando] = useState(false)
  const min = Math.floor(restanteMs / 60_000)
  const seg = Math.floor((restanteMs % 60_000) / 1000)
  const pouco = restanteMs < 60_000
  const modo = pagamento.modo ?? (pagamento.metodo === 'pix' ? 'pix' : pagamento.checkout_url ? 'checkout' : 'maquininha')

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8 text-center">
      <p className="text-xl font-medium text-slate-500">Total a pagar</p>
      <p className="text-6xl font-extrabold tabular-nums">{brl(total)}</p>

      <div className="mt-8 w-full max-w-lg rounded-[2rem] bg-white p-8 shadow-sm">
        {modo === 'pix' && (
          <>
            <p className="flex items-center justify-center gap-2 text-2xl font-bold text-marca"><QrCode className="size-7" /> Pague com PIX</p>
            <p className="mt-1 text-lg text-slate-500">Abra o app do seu banco e leia o QR Code</p>
            <div className="mx-auto mt-6 w-fit rounded-3xl border-4 border-emerald-200 bg-white p-4">
              {pagamento.qr_code_base64
                ? <img src={`data:image/png;base64,${pagamento.qr_code_base64}`} alt="QR Code PIX" className="size-72" />
                : <QRCodeSVG value={pagamento.qr_code ?? pagamento.id} size={288} level="M" />}
            </div>
            {pagamento.qr_code && (
              <button onClick={() => navigator.clipboard?.writeText(pagamento.qr_code!).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })}
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-lg text-marca hover:bg-emerald-50">
                <Copy className="size-5" /> {copiado ? 'Copiado!' : 'Copiar código PIX'}
              </button>
            )}
          </>
        )}
        {modo === 'maquininha' && (
          <>
            <CreditCard className="mx-auto size-20 text-marca" />
            <p className="mt-4 text-3xl font-bold">Use a maquininha</p>
            <p className="mt-2 text-xl text-slate-600">Insira ou aproxime seu cartão de {pagamento.metodo === 'cartao_credito' ? 'crédito' : 'débito'} e siga as instruções na tela da maquininha.</p>
          </>
        )}
        {modo === 'checkout' && pagamento.checkout_url && (
          <>
            <p className="flex items-center justify-center gap-2 text-2xl font-bold text-marca"><Smartphone className="size-7" /> Pague pelo celular</p>
            <p className="mt-1 text-lg text-slate-500">Leia o QR Code e conclua com seu cartão</p>
            <div className="mx-auto mt-6 w-fit rounded-3xl border-4 border-emerald-200 p-4"><QRCodeSVG value={pagamento.checkout_url} size={288} /></div>
          </>
        )}

        <div className="mt-8 flex items-center justify-center gap-3 text-xl font-medium text-slate-700">
          <span className="relative flex size-4"><span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex size-4 rounded-full bg-amber-500" /></span>
          Aguardando pagamento…
        </div>
        <p className={cx('mt-2 flex items-center justify-center gap-2 text-lg tabular-nums', pouco ? 'font-semibold text-rose-600' : 'text-slate-500')}>
          <Hourglass className="size-5" /> Expira em {min}:{String(seg).padStart(2, '0')}
        </p>
      </div>

      {pagamento.provedor === 'simulado' && (
        <div className="mt-6 w-full max-w-lg rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50 p-5">
          <p className="text-lg font-semibold text-amber-900">Sandbox: simular resposta do provedor</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button disabled={simulando} onClick={() => { setSimulando(true); aoSimular('aprovado').finally(() => setSimulando(false)) }} className="h-14 rounded-2xl bg-emerald-600 text-lg font-semibold text-white disabled:opacity-50">Aprovar</button>
            <button disabled={simulando} onClick={() => { setSimulando(true); aoSimular('recusado').finally(() => setSimulando(false)) }} className="h-14 rounded-2xl bg-rose-600 text-lg font-semibold text-white disabled:opacity-50">Recusar</button>
          </div>
        </div>
      )}

      <button onClick={aoCancelar} className="mt-8 h-16 rounded-2xl px-10 text-xl font-medium text-slate-600 ring-2 ring-slate-200 active:bg-slate-100">
        Cancelar e escolher outra forma
      </button>
    </div>
  )
}

/** Selo de sucesso: círculo surge com mola, o check é desenhado e dois anéis se espalham */
function SeloAprovado() {
  return (
    <div className="selo-aprovado relative grid size-28 place-items-center">
      <span className="anel absolute inset-0 rounded-full border-4 border-folha" style={{ animationDelay: '0.25s' }} />
      <span className="anel absolute inset-0 rounded-full border-4 border-folha/60" style={{ animationDelay: '0.45s' }} />
      <svg viewBox="0 0 48 48" className="relative size-28" aria-hidden="true">
        <circle cx="24" cy="24" r="23" className="fill-marca" />
        <path className="check" d="M14 24.5 L21 31.5 L35 17" pathLength={40} fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const CORES_CONFETE = ['#79ad48', '#0f402d', '#d99a12', '#a9cb86', '#062a1f']

/** Confete nas cores da marca saindo do selo; some sozinho depois de ~3 s */
function Confete() {
  const [pecas] = useState(() => Array.from({ length: 32 }, (_, i) => ({
    cor: CORES_CONFETE[i % CORES_CONFETE.length],
    dx: Math.round((Math.random() * 2 - 1) * 420),
    // o selo fica perto do topo: sobe pouco para o confete não sair da tela
    sobe: -Math.round(30 + Math.random() * 60),
    giro: Math.round((Math.random() * 2 - 1) * 720),
    dur: (1.7 + Math.random() * 0.9).toFixed(2),
    atraso: (0.2 + Math.random() * 0.25).toFixed(2),
    largura: Math.round(8 + Math.random() * 6),
    bolinha: Math.random() < 0.3,
  })))
  const [ativo, setAtivo] = useState(true)
  useEffect(() => {
    navigator.vibrate?.([30, 50, 70])
    const t = setTimeout(() => setAtivo(false), 3300)
    return () => clearTimeout(t)
  }, [])
  if (!ativo) return null
  // fixed: o confete não mexe na rolagem da tela; a origem fica no centro do selo
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <div className="absolute top-[88px] left-1/2">
        {pecas.map((p, i) => (
          <span key={i} className="confete" style={{
            width: p.largura, height: p.bolinha ? p.largura : p.largura * 1.7, background: p.cor, borderRadius: p.bolinha ? 9999 : 2,
            '--dx': `${p.dx}px`, '--sobe': `${p.sobe}px`, '--giro': `${p.giro}deg`, '--dur': `${p.dur}s`, '--atraso': `${p.atraso}s`,
          } as React.CSSProperties} />
        ))}
      </div>
    </div>
  )
}

/** atraso para os blocos da tela de sucesso entrarem um depois do outro */
const emSeq = (s: number) => ({ className: 'entra-em-seq', style: { animationDelay: `${s}s` } })

function TelaAprovado({ compra, pagamento, itens, cliente, apartamento, ocioso, aoConcluir }: {
  compra: ResultadoCriarPagamento; pagamento: Pagamento; itens: ItemCarrinho[]; cliente: Cliente | null; apartamento: string; ocioso: number; aoConcluir: () => void
}) {
  const { api } = useSessao()
  const [envio, setEnvio] = useState<'email' | null>(null)
  const [destino, setDestino] = useState('')
  const [estadoEnvio, setEstadoEnvio] = useState<'idle' | 'enviando' | 'ok' | string>('idle')
  const [hora] = useState(() => new Date().toISOString())
  const restante = Math.min(OCIOSO_MS / 1000, Math.max(0, Math.ceil((OCIOSO_MS - ocioso) / 1000)))

  // morador cadastrado: envia direto para o e-mail do cadastro (mostrado mascarado)
  const emailCadastro = cliente?.morador?.email_mascarado ?? null
  const aptoRecibo = cliente?.morador ? cliente.morador.apartamento : apartamento

  async function enviar(canal = envio!, destinoFinal: string | null = destino) {
    setEnvio(canal)
    setEstadoEnvio('enviando')
    try {
      await api.enviarComprovante(compra.venda.id, canal, destinoFinal)
      setEstadoEnvio('ok')
    } catch (e) {
      setEstadoEnvio((e as Error).message)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
      <Confete />
      <SeloAprovado />
      <h1 {...emSeq(0.35)} className="entra-em-seq mt-5 text-5xl font-extrabold text-emerald-700">Pagamento aprovado!</h1>
      <p {...emSeq(0.45)} className="entra-em-seq mt-2 text-2xl text-slate-600">Obrigado pela compra. Pode levar seus produtos.</p>

      <div {...emSeq(0.6)} className="entra-em-seq mt-8 w-full max-w-lg rounded-[2rem] bg-white p-7 shadow-sm">
        <div className="flex justify-between text-lg text-slate-500">
          <span>Compra #{compra.venda.numero}</span>
          <span>{dataHoraBR(hora)}</span>
        </div>
        <ul className="mt-4 divide-y divide-dashed divide-slate-200 border-y border-dashed border-slate-200">
          {itens.map((i) => (
            <li key={i.produto.id} className="flex justify-between gap-4 py-2.5 text-lg">
              <span>{i.qtd}× {i.produto.nome}</span>
              <span className="tabular-nums">{brl(i.produto.preco_venda * i.qtd)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-end justify-between">
          <span className="text-lg text-slate-500">{ROTULO_METODO[pagamento.metodo]}{aptoRecibo ? ` · Apto ${aptoRecibo}` : ''}</span>
          <span className="text-3xl font-extrabold tabular-nums">{brl(compra.venda.total)}</span>
        </div>
      </div>

      <div {...emSeq(0.75)} className="entra-em-seq flex w-full justify-center">
        <AvaliacaoCompra vendaId={compra.venda.id} />
      </div>

      {envio ? (
        <div className="mt-6 w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-sm">
          {estadoEnvio === 'enviando' && !destino ? (
            <p className="flex items-center justify-center gap-2 py-4 text-xl text-slate-600"><CarrinhoAnimado className="h-7 w-auto text-marca-escura" rotulo="Enviando" /> Enviando…</p>
          ) : estadoEnvio === 'ok' ? (
            <p className="flex items-center justify-center gap-2 py-4 text-xl font-semibold text-emerald-700">
              <CircleCheck className="size-6" /> {api.modo === 'demo' ? 'Envio simulado (modo demonstração)' : 'Comprovante enviado!'}
            </p>
          ) : (
            <>
              <p className="text-xl font-semibold">Seu e-mail</p>
              <input autoFocus value={destino} onChange={(e) => setDestino(e.target.value)} type="email"
                inputMode="email" placeholder="nome@email.com"
                className="mt-3 h-16 w-full rounded-2xl border-2 border-slate-200 px-5 text-2xl outline-none focus:border-emerald-500" />
              {estadoEnvio !== 'idle' && estadoEnvio !== 'enviando' && <p className="mt-2 text-lg text-rose-600">{estadoEnvio}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button onClick={() => { setEnvio(null); setEstadoEnvio('idle') }} className="h-14 rounded-2xl text-lg ring-2 ring-slate-200">Voltar</button>
                <button onClick={() => enviar()} disabled={!destino || estadoEnvio === 'enviando'} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-semibold text-white disabled:opacity-50">
                  {estadoEnvio === 'enviando' && <Loader className="size-5 animate-spin" />} Enviar
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-400">Usado apenas para este envio; não guardamos seu contato.</p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 w-full max-w-lg">
          <button onClick={() => (emailCadastro ? enviar('email', null) : setEnvio('email'))} className="flex h-20 w-full flex-col items-center justify-center rounded-3xl bg-white text-xl font-semibold text-marca shadow-sm ring-2 ring-emerald-200">
            <span className="flex items-center gap-3"><Mail className="size-7" /> Receber comprovante por e-mail</span>
            {emailCadastro && <span className="text-sm font-normal text-slate-500">para {emailCadastro}</span>}
          </button>
        </div>
      )}

      <button onClick={aoConcluir} className="mt-8 flex h-20 w-full max-w-lg items-center justify-center gap-3 rounded-3xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30">
        <House className="size-7" /> Concluir
      </button>
      <p className="mt-3 text-lg text-slate-500">Voltando ao início em {restante} s</p>
    </div>
  )
}

const ROTULO_NOTA = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente']
const SUGESTOES_BOAS = ['Rápido', 'Prático', 'Boa variedade', 'Preço justo']
const SUGESTOES_RUINS = ['Faltou produto', 'Preço alto', 'Limpeza / organização', 'Problema no pagamento', 'Produto vencido']

/** Avaliação da compra: a nota é gravada no toque; a observação é opcional. */
function AvaliacaoCompra({ vendaId }: { vendaId: string }) {
  const { api } = useSessao()
  const [nota, setNota] = useState(0)
  const [comentario, setComentario] = useState('')
  const [sugestao, setSugestao] = useState('')
  const [estado, setEstado] = useState<'idle' | 'salvando' | 'enviado'>('idle')
  const [erro, setErro] = useState<string | null>(null)

  async function escolher(n: number) {
    setNota(n)
    setErro(null)
    try {
      await api.avaliarVenda(vendaId, n)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function enviarObservacao() {
    setEstado('salvando')
    setErro(null)
    try {
      await api.avaliarVenda(vendaId, nota, comentario, sugestao)
      setEstado('enviado')
    } catch (e) {
      setErro((e as Error).message)
      setEstado('idle')
    }
  }

  const sugerir = (t: string) => setComentario((c) => (c.includes(t) ? c : c ? `${c.replace(/[.s]+$/, '')}. ${t}` : t).slice(0, 500))
  const sugestoes = nota && nota <= 3 ? SUGESTOES_RUINS : SUGESTOES_BOAS

  if (estado === 'enviado') {
    return (
      <div className="mt-6 flex w-full max-w-lg animate-entrar items-center justify-center gap-3 rounded-[2rem] bg-amber-50 p-6 text-xl font-semibold text-amber-900 ring-1 ring-amber-200">
        <Star className="size-7 fill-amber-400 text-amber-400" /> Obrigado pela avaliação!
      </div>
    )
  }

  return (
    <div className="mt-6 w-full max-w-lg rounded-[2rem] bg-white p-6 text-center shadow-sm">
      <p className="text-2xl font-bold">Como foi sua experiência?</p>
      <div className="mt-4 flex justify-center gap-2" role="radiogroup" aria-label="Nota de 1 a 5 estrelas">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={`${n} estrela${n > 1 ? 's' : ''} — ${ROTULO_NOTA[n]}`}
            onClick={() => escolher(n)} className="rounded-2xl p-1.5 transition active:scale-90">
            <Star className={cx('size-14 transition-colors', n <= nota ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <p className={cx('mt-1 h-7 text-lg font-medium', nota ? 'text-amber-700' : 'text-slate-400')}>
        {nota ? `${ROTULO_NOTA[nota]} · nota registrada` : 'Toque nas estrelas para avaliar'}
      </p>

      {nota > 0 && (
        <div className="mt-4 animate-entrar text-left">
          <div className="flex flex-wrap gap-2">
            {sugestoes.map((t) => (
              <button key={t} type="button" onClick={() => sugerir(t)}
                className={cx('rounded-full px-4 py-2 text-base ring-1 transition', comentario.includes(t) ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-slate-50 text-slate-700 ring-slate-200')}>
                {t}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-lg font-medium text-slate-700">
            Observação <span className="font-normal text-slate-400">(opcional)</span>
            <textarea value={comentario} onChange={(e) => setComentario(e.target.value.slice(0, 500))} rows={3}
              placeholder={nota <= 3 ? 'O que podemos melhorar?' : 'Conte como foi sua experiência'}
              className="mt-2 w-full resize-none rounded-2xl border-2 border-slate-200 px-4 py-3 text-xl font-normal outline-none focus:border-amber-400" />
          </label>
          <label className="mt-3 block text-lg font-medium text-slate-700">
            Algo a adicionar? <span className="font-normal text-slate-400">(opcional)</span>
            <span className="relative mt-2 block">
              <PackagePlus className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-slate-400" />
              <input value={sugestao} onChange={(e) => setSugestao(e.target.value.slice(0, 200))}
                placeholder="Um produto que você gostaria de encontrar aqui"
                className="h-16 w-full rounded-2xl border-2 border-slate-200 pr-4 pl-13 text-xl font-normal outline-none focus:border-amber-400" />
            </span>
          </label>
          <button type="button" onClick={enviarObservacao} disabled={(!comentario.trim() && !sugestao.trim()) || estado === 'salvando'}
            className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-lg font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">
            {estado === 'salvando' && <Loader className="size-5 animate-spin" />} Enviar
          </button>
        </div>
      )}
      {erro && <p className="mt-3 text-lg text-rose-600" role="alert">{erro}</p>}
    </div>
  )
}

function TelaFalha({ pagamento, aoTentarDeNovo, aoDesistir }: { pagamento: Pagamento; aoTentarDeNovo: () => void; aoDesistir: () => void }) {
  const expirado = pagamento.status === 'expirado'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
     <div className="m-auto flex w-full flex-col items-center text-center">
      <div className={cx('grid size-28 animate-entrar place-items-center rounded-full', expirado ? 'bg-amber-100' : 'bg-rose-100')}>
        {expirado ? <Hourglass className="size-16 text-amber-600" /> : <CircleX className="size-20 text-rose-600" strokeWidth={2.2} />}
      </div>
      <h1 className={cx('mt-6 text-5xl font-extrabold', expirado ? 'text-amber-700' : 'text-rose-700')}>
        {expirado ? 'Tempo esgotado' : pagamento.status === 'cancelado' ? 'Pagamento cancelado' : 'Pagamento recusado'}
      </h1>
      <p className="mt-3 max-w-lg text-2xl text-slate-600">
        {pagamento.motivo_recusa ?? (expirado ? 'O QR Code expirou.' : 'Não foi possível concluir o pagamento.')} Nenhum valor foi cobrado.
      </p>
      <div className="mt-10 grid w-full max-w-lg gap-4">
        <button onClick={aoTentarDeNovo} className="h-20 rounded-3xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30">Tentar novamente</button>
        <button onClick={aoDesistir} className="h-16 rounded-3xl text-xl font-medium text-slate-600 ring-2 ring-slate-200">Cancelar compra</button>
      </div>
     </div>
    </div>
  )
}

function BotaoTopo({ onClick, rotulo, perigo, children }: { onClick: () => void; rotulo: string; perigo?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={rotulo} className={cx('flex h-14 items-center gap-2 rounded-2xl px-5 text-lg font-medium [&>svg]:size-6',
      perigo ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 active:bg-rose-100' : 'bg-slate-100 text-slate-700 active:bg-slate-200')}>
      {children} <span className="hidden sm:inline">{rotulo}</span>
    </button>
  )
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx(
      'flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-lg font-medium whitespace-nowrap transition',
      ativo ? 'bg-marca text-white' : 'bg-cartao text-marca-escura',
    )}>
      {children}
    </button>
  )
}

function BotaoQtd({ onClick, rotulo, desabilitado, children }: { onClick: () => void; rotulo: string; desabilitado?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={rotulo} disabled={desabilitado}
      className="grid size-12 place-items-center rounded-xl bg-slate-100 active:bg-slate-200 disabled:opacity-35 [&>svg]:size-6">
      {children}
    </button>
  )
}
