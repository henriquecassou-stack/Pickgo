import { useEffect, useState, type FormEvent } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { useApi } from '../lib/sessao'
import type { Categoria, Fornecedor, Produto } from '../lib/tipos'
import { brl, decimalParaCampo, lerDecimal, pct } from '../lib/formato'
import { Botao, Modal, Rotulo, useAviso } from './ui'
import { LeitorCamera } from './LeitorCodigo'
import { CampoData } from './CampoData'

interface Props {
  aberto: boolean
  produto: Produto | null // null = novo
  categorias: Categoria[]
  fornecedores: Fornecedor[]
  codigoInicial?: string
  aoFechar: () => void
  aoSalvar: () => void
}

export function FormProduto({ aberto, produto, categorias, fornecedores, codigoInicial, aoFechar, aoSalvar }: Props) {
  const api = useApi()
  const avisar = useAviso()
  const [f, setF] = useState(vazio())
  const [salvando, setSalvando] = useState(false)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [camera, setCamera] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function vazio() {
    return {
      nome: '', foto_url: null as string | null, categoria_id: '' as string, codigo_barras: '', preco_custo: '', preco_venda: '',
      estoque_minimo: '5', validade: '', ativo: true, estoque_inicial: '', fornecedor_id: '',
    }
  }

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    setF(produto
      ? {
          nome: produto.nome, foto_url: produto.foto_url, categoria_id: String(produto.categoria_id ?? ''), codigo_barras: produto.codigo_barras ?? '',
          preco_custo: decimalParaCampo(produto.preco_custo), preco_venda: decimalParaCampo(produto.preco_venda),
          estoque_minimo: String(produto.estoque_minimo), validade: produto.validade ?? '', ativo: produto.ativo, estoque_inicial: '', fornecedor_id: '',
        }
      : { ...vazio(), codigo_barras: codigoInicial ?? '' })
  }, [aberto, produto, codigoInicial])

  const custo = lerDecimal(f.preco_custo || '0')
  const venda = lerDecimal(f.preco_venda || '0')
  const margem = venda > 0 && custo >= 0 ? (venda - custo) / venda : null
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function enviarFoto(arquivo?: File) {
    if (!arquivo) return
    if (arquivo.size > 5 * 1024 * 1024) return avisar('erro', 'A foto deve ter no máximo 5 MB')
    setEnviandoFoto(true)
    try {
      const url = await api.enviarFoto(arquivo)
      setF((x) => ({ ...x, foto_url: url }))
    } catch (e) {
      avisar('erro', (e as Error).message)
    } finally {
      setEnviandoFoto(false)
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!(venda > 0)) return setErro('Informe um preço de venda válido.')
    if (Number.isNaN(custo) || custo < 0) return setErro('Informe um preço de custo válido.')
    if (venda < custo && !confirm('O preço de venda está abaixo do custo. Salvar mesmo assim?')) return
    const inicial = Number(f.estoque_inicial || 0)
    if (!Number.isInteger(inicial) || inicial < 0) return setErro('Estoque inicial inválido.')

    setSalvando(true)
    try {
      const id = await api.salvarProduto({
        id: produto?.id,
        nome: f.nome.trim(),
        foto_url: f.foto_url,
        categoria_id: f.categoria_id ? Number(f.categoria_id) : null,
        codigo_barras: f.codigo_barras.trim() || null,
        preco_custo: custo,
        preco_venda: venda,
        estoque_minimo: Number(f.estoque_minimo || 0),
        validade: f.validade || null,
        ativo: f.ativo,
      })
      // estoque inicial também passa por movimentação (nunca "na mão")
      if (!produto && inicial > 0) {
        await api.registrarMovimentacao({
          produto_id: id, tipo: 'entrada', motivo: 'reposicao', quantidade: inicial, custo_unitario: custo,
          fornecedor_id: f.fornecedor_id ? Number(f.fornecedor_id) : null, observacao: 'Estoque inicial',
        })
      }
      avisar('sucesso', produto ? 'Produto atualizado' : 'Produto cadastrado')
      aoSalvar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Modal
        aberto={aberto}
        aoFechar={aoFechar}
        titulo={produto ? 'Editar produto' : 'Novo produto'}
        largura="max-w-2xl"
        rodape={<>
          <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" form="form-produto" carregando={salvando}>Salvar</Botao>
        </>}
      >
        <form id="form-produto" onSubmit={salvar} className="grid gap-4 sm:grid-cols-[160px_1fr]">
          {/* foto */}
          <div className="flex flex-col items-center gap-2">
            <label className="group relative grid aspect-square w-full cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-emerald-400 hover:text-emerald-600">
              {f.foto_url ? <img src={f.foto_url} alt="" className="absolute inset-0 size-full object-cover" /> : (
                <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus className="size-7" />{enviandoFoto ? 'Enviando…' : 'Adicionar foto'}</span>
              )}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => enviarFoto(e.target.files?.[0])} />
            </label>
            {f.foto_url && (
              <button type="button" onClick={() => setF((x) => ({ ...x, foto_url: null }))} className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
                <Trash2 className="size-3.5" /> Remover foto
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Rotulo texto="Nome" className="sm:col-span-2">
              <input className="campo" required maxLength={120} value={f.nome} onChange={set('nome')} autoFocus />
            </Rotulo>
            <Rotulo texto="Categoria">
              <select className="campo" value={f.categoria_id} onChange={set('categoria_id')}>
                <option value="">Sem categoria</option>
                {categorias.filter((c) => c.ativo || String(c.id) === f.categoria_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Rotulo>
            <Rotulo texto="Código de barras">
              <div className="flex gap-2">
                <input className="campo font-mono" inputMode="numeric" value={f.codigo_barras} onChange={set('codigo_barras')} placeholder="Bipe ou digite" />
                <Botao type="button" variante="secundario" onClick={() => setCamera(true)} aria-label="Ler com a câmera" className="shrink-0 px-3"><Camera className="size-4" /></Botao>
              </div>
            </Rotulo>
            <Rotulo texto="Preço de custo (R$)">
              <input className="campo tabular-nums" inputMode="decimal" required value={f.preco_custo} onChange={set('preco_custo')} placeholder="0,00" />
            </Rotulo>
            <Rotulo texto="Preço de venda (R$)" dica={margem !== null && !Number.isNaN(margem) ? `Margem: ${pct(margem)} · lucro ${brl(venda - custo)} por unidade` : undefined}>
              <input className="campo tabular-nums" inputMode="decimal" required value={f.preco_venda} onChange={set('preco_venda')} placeholder="0,00" />
            </Rotulo>
            <Rotulo texto="Estoque mínimo" dica="Abaixo disso o produto aparece em alerta">
              <input className="campo" type="number" min={0} required value={f.estoque_minimo} onChange={set('estoque_minimo')} />
            </Rotulo>
            <Rotulo texto="Validade" dica="Alerta a partir de 7 dias antes">
              <CampoData valor={f.validade} aoMudar={(v) => setF((x) => ({ ...x, validade: v }))} ariaLabel="Validade" />
            </Rotulo>

            {produto ? (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
                Estoque atual: <strong>{produto.estoque_atual}</strong>. Para alterar, registre uma entrada ou saída em Movimentações.
              </div>
            ) : (
              <>
                <Rotulo texto="Estoque inicial" dica="Gera uma entrada no histórico">
                  <input className="campo" type="number" min={0} value={f.estoque_inicial} onChange={set('estoque_inicial')} placeholder="0" />
                </Rotulo>
                <Rotulo texto="Fornecedor (estoque inicial)">
                  <select className="campo" value={f.fornecedor_id} onChange={set('fornecedor_id')} disabled={!Number(f.estoque_inicial)}>
                    <option value="">—</option>
                    {fornecedores.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </Rotulo>
              </>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={f.ativo} onChange={(e) => setF((x) => ({ ...x, ativo: e.target.checked }))} />
              Produto ativo (aparece no totem)
            </label>
            {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{erro}</p>}
          </div>
        </form>
      </Modal>
      <LeitorCamera aberto={camera} aoFechar={() => setCamera(false)} aoLer={(c) => { setF((x) => ({ ...x, codigo_barras: c })); setCamera(false) }} />
    </>
  )
}
