import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Tags, Truck } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Categoria, Fornecedor } from '../../lib/tipos'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Modal, Rotulo, useAviso } from '../../componentes/ui'
import { ICONES, IconeCategoria } from '../../componentes/IconeCategoria'

export default function Cadastros() {
  const api = useApi()
  const cats = useCarregar(() => api.listarCategorias(), [])
  const forns = useCarregar(() => api.listarFornecedores(), [])
  const [cat, setCat] = useState<Partial<Categoria> | null>(null)
  const [forn, setForn] = useState<Partial<Fornecedor> | null>(null)

  return (
    <>
      <CabecalhoPagina titulo="Categorias e fornecedores" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Cartao>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold"><Tags className="size-4 text-slate-400" /> Categorias</h2>
            <Botao tamanho="sm" icone={<Plus className="size-4" />} onClick={() => setCat({ icone: 'package', cor: '#059669', ordem: (cats.dados?.length ?? 0) + 1, ativo: true })}>Nova</Botao>
          </div>
          {cats.carregando && !cats.dados ? <Carregando /> : (
            <ul className="divide-y divide-slate-100">
              {cats.dados?.map((c) => (
                <li key={c.id} className={cx('flex items-center gap-3 px-4 py-2.5', !c.ativo && 'opacity-50')}>
                  <IconeCategoria icone={c.icone} cor={c.cor} />
                  <span className="flex-1 font-medium">{c.nome}</span>
                  {!c.ativo && <Etiqueta>Inativa</Etiqueta>}
                  <button onClick={() => setCat(c)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={`Editar ${c.nome}`}><Pencil className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold"><Truck className="size-4 text-slate-400" /> Fornecedores</h2>
            <Botao tamanho="sm" icone={<Plus className="size-4" />} onClick={() => setForn({ ativo: true })}>Novo</Botao>
          </div>
          {forns.carregando && !forns.dados ? <Carregando /> : (
            <ul className="divide-y divide-slate-100">
              {forns.dados?.map((f) => (
                <li key={f.id} className={cx('flex items-center gap-3 px-4 py-2.5', !f.ativo && 'opacity-50')}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.nome}</p>
                    <p className="truncate text-xs text-slate-500">{[f.cnpj, f.contato, f.telefone].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  {!f.ativo && <Etiqueta>Inativo</Etiqueta>}
                  <button onClick={() => setForn(f)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={`Editar ${f.nome}`}><Pencil className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      <FormCategoria valor={cat} aoFechar={() => setCat(null)} aoSalvar={() => { setCat(null); cats.recarregar() }} />
      <FormFornecedor valor={forn} aoFechar={() => setForn(null)} aoSalvar={() => { setForn(null); forns.recarregar() }} />
    </>
  )
}

function useSalvar(fn: () => Promise<void>, aoSalvar: () => void) {
  const avisar = useAviso()
  const [salvando, setSalvando] = useState(false)
  return {
    salvando,
    async enviar(e: FormEvent) {
      e.preventDefault()
      setSalvando(true)
      try {
        await fn()
        avisar('sucesso', 'Salvo')
        aoSalvar()
      } catch (err) {
        avisar('erro', (err as Error).message)
      } finally {
        setSalvando(false)
      }
    },
  }
}

function FormCategoria({ valor, aoFechar, aoSalvar }: { valor: Partial<Categoria> | null; aoFechar: () => void; aoSalvar: () => void }) {
  const api = useApi()
  const [c, setC] = useState<Partial<Categoria>>({})
  const [ultimo, setUltimo] = useState(valor)
  if (valor !== ultimo) { setUltimo(valor); setC(valor ?? {}) }
  const { salvando, enviar } = useSalvar(() => api.salvarCategoria({ ...c, nome: (c.nome ?? '').trim() }), aoSalvar)
  return (
    <Modal aberto={!!valor} aoFechar={aoFechar} titulo={c.id ? 'Editar categoria' : 'Nova categoria'}
      rodape={<><Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao><Botao type="submit" form="form-cat" carregando={salvando}>Salvar</Botao></>}>
      <form id="form-cat" onSubmit={enviar} className="space-y-4">
        <Rotulo texto="Nome"><input className="campo" required value={c.nome ?? ''} onChange={(e) => setC({ ...c, nome: e.target.value })} autoFocus /></Rotulo>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Ícone</span>
          <div className="grid grid-cols-10 gap-1.5">
            {Object.entries(ICONES).map(([nome, Icone]) => (
              <button type="button" key={nome} onClick={() => setC({ ...c, icone: nome })} aria-label={nome}
                className={cx('grid aspect-square place-items-center rounded-lg border', c.icone === nome ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                <Icone className="size-4" />
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Rotulo texto="Cor"><input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-slate-300" value={c.cor ?? '#059669'} onChange={(e) => setC({ ...c, cor: e.target.value })} /></Rotulo>
          <Rotulo texto="Ordem no totem"><input type="number" className="campo" value={c.ordem ?? 0} onChange={(e) => setC({ ...c, ordem: Number(e.target.value) })} /></Rotulo>
          <div className="flex items-end justify-center pb-2"><IconeCategoria icone={c.icone} cor={c.cor} tamanho="lg" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-emerald-600" checked={c.ativo ?? true} onChange={(e) => setC({ ...c, ativo: e.target.checked })} /> Ativa</label>
      </form>
    </Modal>
  )
}

function FormFornecedor({ valor, aoFechar, aoSalvar }: { valor: Partial<Fornecedor> | null; aoFechar: () => void; aoSalvar: () => void }) {
  const api = useApi()
  const [f, setF] = useState<Partial<Fornecedor>>({})
  const [ultimo, setUltimo] = useState(valor)
  if (valor !== ultimo) { setUltimo(valor); setF(valor ?? {}) }
  const { salvando, enviar } = useSalvar(() => api.salvarFornecedor({ ...f, nome: (f.nome ?? '').trim() }), aoSalvar)
  const campo = (k: keyof Fornecedor, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Rotulo texto={rotulo}><input className="campo" value={(f[k] as string) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value || null })} {...extra} /></Rotulo>
  )
  return (
    <Modal aberto={!!valor} aoFechar={aoFechar} titulo={f.id ? 'Editar fornecedor' : 'Novo fornecedor'}
      rodape={<><Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao><Botao type="submit" form="form-forn" carregando={salvando}>Salvar</Botao></>}>
      <form id="form-forn" onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{campo('nome', 'Nome', { required: true, autoFocus: true })}</div>
        {campo('cnpj', 'CNPJ', { placeholder: '00.000.000/0000-00' })}
        {campo('contato', 'Contato')}
        {campo('telefone', 'Telefone', { type: 'tel' })}
        {campo('email', 'E-mail', { type: 'email' })}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-emerald-600" checked={f.ativo ?? true} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
      </form>
    </Modal>
  )
}
