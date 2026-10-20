import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine } from 'lucide-react'
import { useApi } from '../lib/sessao'
import type { Fornecedor, NovaMovimentacao, Produto, TipoMovimentacao } from '../lib/tipos'
import { brl, decimalParaCampo, lerDecimal, ROTULO_MOTIVO } from '../lib/formato'
import { Botao, cx, Modal, Rotulo, useAviso } from './ui'
import { CampoDataHora } from './CampoData'

const MOTIVOS_SAIDA = ['vencido', 'avariado', 'perda', 'consumo_interno', 'ajuste_saida'] as const

function agoraLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

interface Props {
  aberto: boolean
  tipoInicial?: TipoMovimentacao
  produtoInicial?: string
  produtos: Produto[]
  fornecedores: Fornecedor[]
  aoFechar: () => void
  aoSalvar: () => void
}

export function FormMovimentacao({ aberto, tipoInicial = 'entrada', produtoInicial, produtos, fornecedores, aoFechar, aoSalvar }: Props) {
  const api = useApi()
  const avisar = useAviso()
  const [tipo, setTipo] = useState<TipoMovimentacao>(tipoInicial)
  const [produtoId, setProdutoId] = useState('')
  const [busca, setBusca] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [custo, setCusto] = useState('')
  const [fornecedorId, setFornecedorId] = useState('')
  const [motivo, setMotivo] = useState<(typeof MOTIVOS_SAIDA)[number] | 'reposicao' | 'ajuste_entrada'>('reposicao')
  const [data, setData] = useState(agoraLocal())
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    setTipo(tipoInicial)
    setMotivo(tipoInicial === 'entrada' ? 'reposicao' : 'vencido')
    setProdutoId(produtoInicial ?? '')
    setBusca('')
    setQuantidade('')
    setFornecedorId('')
    setObs('')
    setErro(null)
    setData(agoraLocal())
  }, [aberto, tipoInicial, produtoInicial])

  const produto = produtos.find((p) => p.id === produtoId)
  useEffect(() => {
    if (produto) setCusto(decimalParaCampo(produto.preco_custo))
  }, [produto])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const lista = produtos.filter((p) => p.ativo || p.id === produtoId)
    if (!t) return lista
    return lista.filter((p) => p.nome.toLowerCase().includes(t) || p.codigo_barras === t)
  }, [busca, produtos, produtoId])

  // código bipado no campo de busca seleciona o produto
  useEffect(() => {
    const exato = produtos.find((p) => p.codigo_barras && p.codigo_barras === busca.trim())
    if (exato) setProdutoId(exato.id)
  }, [busca, produtos])

  const qtd = Number(quantidade || 0)
  const saldoDepois = produto ? produto.estoque_atual + (tipo === 'entrada' ? qtd : -qtd) : null

  function trocarTipo(t: TipoMovimentacao) {
    setTipo(t)
    setMotivo(t === 'entrada' ? 'reposicao' : 'vencido')
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!produto) return setErro('Selecione o produto.')
    if (!Number.isInteger(qtd) || qtd <= 0) return setErro('Quantidade deve ser um número inteiro maior que zero.')
    if (tipo === 'saida' && saldoDepois! < 0) return setErro(`Estoque insuficiente: há ${produto.estoque_atual} unidade(s).`)
    const custoNum = lerDecimal(custo || '0')
    if (tipo === 'entrada' && (Number.isNaN(custoNum) || custoNum < 0)) return setErro('Custo unitário inválido.')

    const mov: NovaMovimentacao = {
      produto_id: produto.id,
      tipo,
      motivo,
      quantidade: qtd,
      custo_unitario: tipo === 'entrada' ? custoNum : produto.preco_custo,
      fornecedor_id: tipo === 'entrada' && fornecedorId ? Number(fornecedorId) : null,
      data_movimentacao: new Date(data).toISOString(),
      observacao: obs.trim() || null,
    }
    setSalvando(true)
    try {
      await api.registrarMovimentacao(mov)
      avisar('sucesso', `${tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada: ${produto.nome} (${saldoDepois} em estoque)`)
      aoSalvar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Registrar movimentação"
      largura="max-w-xl"
      rodape={<>
        <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
        <Botao type="submit" form="form-mov" carregando={salvando} variante={tipo === 'saida' ? 'perigo' : 'primario'}>
          Registrar {tipo === 'entrada' ? 'entrada' : 'saída'}
        </Botao>
      </>}
    >
      <form id="form-mov" onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          {(['entrada', 'saida'] as const).map((t) => (
            <button key={t} type="button" onClick={() => trocarTipo(t)} className={cx(
              'flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition',
              tipo === t ? (t === 'entrada' ? 'bg-white text-emerald-700 shadow-sm' : 'bg-white text-rose-700 shadow-sm') : 'text-slate-500 hover:text-slate-700',
            )}>
              {t === 'entrada' ? <ArrowDownToLine className="size-4" /> : <ArrowUpFromLine className="size-4" />}
              {t === 'entrada' ? 'Entrada (reposição)' : 'Saída manual'}
            </button>
          ))}
        </div>

        <Rotulo texto="Produto">
          {!produtoInicial && (
            <input className="campo mb-2" placeholder="Filtrar por nome ou bipar código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          )}
          <select className="campo" required value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={!!produtoInicial}>
            <option value="">Selecione…</option>
            {filtrados.map((p) => <option key={p.id} value={p.id}>{p.nome} — estoque {p.estoque_atual}</option>)}
          </select>
        </Rotulo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Rotulo texto="Quantidade">
            <input className="campo" type="number" min={1} step={1} required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </Rotulo>
          {tipo === 'entrada' ? (
            <Rotulo texto="Custo unitário (R$)" dica={produto && qtd > 0 ? `Total da compra: ${brl(lerDecimal(custo || '0') * qtd)}` : 'Atualiza o preço de custo do produto'}>
              <input className="campo tabular-nums" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} />
            </Rotulo>
          ) : (
            <Rotulo texto="Motivo">
              <select className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)}>
                {MOTIVOS_SAIDA.map((m) => <option key={m} value={m}>{ROTULO_MOTIVO[m]}</option>)}
              </select>
            </Rotulo>
          )}
          {tipo === 'entrada' && (
            <>
              <Rotulo texto="Fornecedor">
                <select className="campo" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                  <option value="">—</option>
                  {fornecedores.filter((f) => f.ativo).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </Rotulo>
              <Rotulo texto="Tipo de entrada">
                <select className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)}>
                  <option value="reposicao">Reposição / compra</option>
                  <option value="ajuste_entrada">Ajuste de inventário</option>
                </select>
              </Rotulo>
            </>
          )}
          <Rotulo texto="Data e hora" className="sm:col-span-2 sm:max-w-sm">
            <CampoDataHora valor={data} aoMudar={setData} max={agoraLocal()} ariaLabel="Data da movimentação" />
          </Rotulo>
        </div>

        <Rotulo texto="Observação">
          <textarea className="campo min-h-16" maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota fiscal, lote, detalhes…" />
        </Rotulo>

        {produto && (
          <div className="flex items-center justify-center gap-3 rounded-xl bg-slate-50 py-3 text-sm">
            <span className="text-slate-500">Saldo</span>
            <strong className="text-lg tabular-nums">{produto.estoque_atual}</strong>
            <ArrowRight className="size-4 text-slate-400" />
            <strong className={cx('text-lg tabular-nums', saldoDepois! < 0 ? 'text-rose-600' : saldoDepois! <= produto.estoque_minimo ? 'text-amber-600' : 'text-emerald-600')}>
              {saldoDepois}
            </strong>
          </div>
        )}
        {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      </form>
    </Modal>
  )
}
