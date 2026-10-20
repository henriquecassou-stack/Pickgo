import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, ExternalLink, RefreshCw, Send } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Aviso, ConfigAvisos, FiltroAvisos, GravidadeAviso } from '../../lib/tipos'
import { dataHoraBR, tempoRelativo } from '../../lib/formato'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Rotulo, useAviso, Vazio } from '../../componentes/ui'
import { IconeAviso, ROTULO_GRAVIDADE, useAvisosAdmin, VISUAL_AVISO } from '../../componentes/Avisos'

type Aba = 'nao_lidos' | 'abertos' | 'estoque' | 'avaliacoes' | 'historico'
const ABAS: { id: Aba; rotulo: string; filtro: FiltroAvisos }[] = [
  { id: 'nao_lidos', rotulo: 'Não lidos', filtro: { apenasNaoLidos: true } },
  { id: 'abertos', rotulo: 'Em aberto', filtro: {} },
  { id: 'estoque', rotulo: 'Estoque e validade', filtro: { grupo: 'estoque' } },
  { id: 'avaliacoes', rotulo: 'Avaliações', filtro: { grupo: 'avaliacoes' } },
  { id: 'historico', rotulo: 'Histórico', filtro: { incluirResolvidos: true } },
]

export default function Avisos() {
  const api = useApi()
  const avisar = useAviso()
  const navegar = useNavigate()
  const { naoLidos, marcarLidos } = useAvisosAdmin()
  const [aba, setAba] = useState<Aba>('nao_lidos')
  const [verificando, setVerificando] = useState(false)
  const lista = useCarregar(() => api.listarAvisos({ ...ABAS.find((a) => a.id === aba)!.filtro, limite: 300 }), [aba])

  // atualiza a lista quando chega aviso novo ou algo é lido
  useEffect(() => api.aoNovoAviso(lista.recarregar), [api, lista.recarregar])

  async function verificar() {
    setVerificando(true)
    try {
      const n = await api.verificarAvisos()
      avisar('sucesso', n ? `${n} aviso${n > 1 ? 's' : ''} novo${n > 1 ? 's' : ''}` : 'Verificado: nada novo')
      lista.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    } finally {
      setVerificando(false)
    }
  }

  async function abrir(a: Aviso) {
    if (!a.lido) await marcarLidos([a.id]).catch(() => {})
    if (a.link) navegar(a.link)
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Avisos"
        descricao="Alertas automáticos de estoque, validade e avaliações. Os de estoque se resolvem sozinhos quando a situação é corrigida."
        acoes={<>
          <Botao variante="secundario" icone={<RefreshCw className={cx('size-4', verificando && 'animate-spin')} />} onClick={verificar} disabled={verificando}>Verificar agora</Botao>
          {naoLidos > 0 && <Botao variante="secundario" icone={<CheckCheck className="size-4" />} onClick={() => marcarLidos('todos').then(lista.recarregar)}>Marcar todos como lidos</Botao>}
        </>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Cartao>
          <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
            {ABAS.map((x) => (
              <button key={x.id} onClick={() => setAba(x.id)} className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                aba === x.id ? 'bg-marca text-white' : 'text-slate-600 hover:bg-slate-100',
              )}>
                {x.rotulo}{x.id === 'nao_lidos' && naoLidos > 0 ? ` (${naoLidos})` : ''}
              </button>
            ))}
          </div>
          {lista.carregando && !lista.dados ? <Carregando /> : !lista.dados?.length ? (
            <Vazio icone={<Bell className="size-6" />} titulo={aba === 'nao_lidos' ? 'Nenhum aviso não lido' : 'Nenhum aviso aqui'} texto="Quando algo precisar da sua atenção, aparece aqui e no sino." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {lista.dados.map((a) => (
                <li key={a.id} className={cx('flex gap-3 px-4 py-3', !a.lido && !a.resolvido && 'bg-emerald-50/30', a.resolvido && 'opacity-60')}>
                  <IconeAviso a={a} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cx('text-slate-900', !a.lido && !a.resolvido && 'font-semibold')}>{a.titulo}</p>
                      <Etiqueta tom={a.gravidade === 'critico' ? 'vermelho' : a.gravidade === 'atencao' ? 'amarelo' : 'azul'}>{ROTULO_GRAVIDADE[a.gravidade]}</Etiqueta>
                      {a.resolvido && <Etiqueta tom="verde">Resolvido</Etiqueta>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">{a.mensagem}</p>
                    <p className="mt-1 text-xs text-slate-400" title={dataHoraBR(a.criado_em)}>
                      {VISUAL_AVISO[a.tipo].rotulo} · {tempoRelativo(a.criado_em)}
                      {a.enviado_em && ' · enviado por e-mail'}
                      {a.resolvido_em && ` · resolvido ${tempoRelativo(a.resolvido_em)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {a.link && (
                      <button onClick={() => abrir(a)} title="Abrir" aria-label={`Abrir ${a.titulo}`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                        <ExternalLink className="size-4" />
                      </button>
                    )}
                    {!a.lido && !a.resolvido && (
                      <button onClick={() => marcarLidos([a.id]).then(lista.recarregar)} title="Marcar como lido" aria-label="Marcar como lido"
                        className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700">
                        <CheckCheck className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <ConfigEnvio />
      </div>
    </>
  )
}

function ConfigEnvio() {
  const api = useApi()
  const avisar = useAviso()
  const cfg = useCarregar(() => api.obterConfigAvisos(), [])
  const [f, setF] = useState<ConfigAvisos | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  useEffect(() => { if (cfg.dados) setF(cfg.dados) }, [cfg.dados])

  if (!f) return <Cartao className="p-5"><Carregando /></Cartao>

  const alternarNivel = (n: GravidadeAviso) =>
    setF({ ...f, niveis_imediato: f.niveis_imediato.includes(n) ? f.niveis_imediato.filter((x) => x !== n) : [...f.niveis_imediato, n] })

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (f!.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f!.email)) return avisar('erro', 'E-mail inválido')
    setSalvando(true)
    try {
      await api.salvarConfigAvisos({ ...f!, email: f!.email?.trim() || null })
      avisar('sucesso', 'Configuração de avisos salva')
    } catch (err) {
      avisar('erro', (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    try {
      await api.testarEnvioAvisos()
      avisar('sucesso', 'Mensagem de teste enviada')
    } catch (err) {
      avisar('erro', (err as Error).message)
    } finally {
      setTestando(false)
    }
  }

  return (
    <Cartao className="h-fit p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Send className="size-4 text-slate-400" /> Receber por e-mail</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">Além do sino no painel, os avisos podem chegar no seu e-mail.</p>
      <form onSubmit={salvar} className="space-y-4">
        <Rotulo texto="E-mail"><input className="campo" type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="sindico@condominio.com" /></Rotulo>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" className="size-4 accent-emerald-600" checked={f.enviar_imediato} onChange={(e) => setF({ ...f, enviar_imediato: e.target.checked })} />
            Enviar assim que surgir
          </label>
          <div className={cx('mt-2 flex flex-wrap gap-3 pl-6 text-sm', !f.enviar_imediato && 'opacity-50')}>
            {(['critico', 'atencao', 'info'] as GravidadeAviso[]).map((n) => (
              <label key={n} className="flex items-center gap-1.5 text-slate-700">
                <input type="checkbox" className="size-4 accent-emerald-600" disabled={!f.enviar_imediato} checked={f.niveis_imediato.includes(n)} onChange={() => alternarNivel(n)} />
                {ROTULO_GRAVIDADE[n]}
              </label>
            ))}
          </div>
          <p className="mt-2 pl-6 text-xs text-slate-500">Urgente: estoque zerado e produto vencido. Atenção: estoque baixo, validade e avaliação ruim. Informativo: sugestões.</p>
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-0.5 size-4 accent-emerald-600" checked={f.resumo_diario} onChange={(e) => setF({ ...f, resumo_diario: e.target.checked })} />
          <span><span className="font-medium">Resumo diário às 8h</span><span className="block text-xs text-slate-500">Tudo que está em aberto e o que aconteceu nas últimas 24 h.</span></span>
        </label>

        <div className="flex gap-2">
          <Botao type="submit" carregando={salvando} className="flex-1">Salvar</Botao>
          <Botao type="button" variante="secundario" carregando={testando} onClick={testar} disabled={!f.email}>Enviar teste</Botao>
        </div>
        {api.modo === 'demo' && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">No modo demonstração a configuração é salva, mas nada é enviado. O envio usa a Edge Function <code>enviar-avisos</code> (veja o README).</p>
        )}
      </form>
    </Cartao>
  )
}
