import { useMemo, useState, type FormEvent } from 'react'
import { Check, KeyRound, LockOpen, Pencil, Plus, Search, Users } from 'lucide-react'
import { useApi, useCarregar } from '../../lib/sessao'
import type { Morador, MoradorEditavel } from '../../lib/tipos'
import { dataBR, numero, telefoneBR } from '../../lib/formato'
import { cpfValido, formatarCpf, mascararCpf, somenteDigitos } from '../../lib/cpf'
import { Botao, CabecalhoPagina, Carregando, Cartao, cx, Etiqueta, Modal, Rotulo, useAviso, Vazio } from '../../componentes/ui'

export default function Moradores() {
  const api = useApi()
  const avisar = useAviso()
  const lista = useCarregar(() => api.listarMoradores(), [])
  const [busca, setBusca] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)
  const pendentes = (lista.dados ?? []).filter((m) => !m.revisado).length
  const [edicao, setEdicao] = useState<Morador | 'novo' | null>(null)

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (lista.dados ?? [])
      .filter((m) => (!soPendentes || !m.revisado) && (!t || m.nome.toLowerCase().includes(t) || m.apartamento.toLowerCase().includes(t)))
      .sort((a, b) => a.apartamento.localeCompare(b.apartamento, 'pt-BR', { numeric: true }) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [lista.dados, busca, soPendentes])

  async function confirmar(m: Morador) {
    try {
      await api.revisarMorador(m.id)
      avisar('sucesso', `Cadastro de ${m.nome} confirmado`)
      lista.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    }
  }

  async function desbloquear(m: Morador) {
    try {
      await api.desbloquearMorador(m.id)
      avisar('sucesso', `${m.nome} desbloqueado`)
      lista.recarregar()
    } catch (e) {
      avisar('erro', (e as Error).message)
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Moradores"
        descricao="Moradores cadastrados se identificam no totem com apartamento + PIN e recebem o comprovante no contato salvo."
        acoes={<Botao icone={<Plus className="size-4" />} onClick={() => setEdicao('novo')}>Novo morador</Botao>}
      />
      <Cartao>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          {pendentes > 0 && (
            <button onClick={() => setSoPendentes(!soPendentes)} className={cx(
              'rounded-full border border-amber-200 px-3.5 py-1.5 text-sm font-medium text-amber-800 transition',
              soPendentes ? 'bg-amber-100' : 'bg-white hover:bg-amber-50',
            )}>
              {pendentes} cadastro{pendentes > 1 ? 's' : ''} feito{pendentes > 1 ? 's' : ''} no totem para revisar
            </button>
          )}
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="campo pl-9" placeholder="Buscar por nome ou apartamento" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <p className="p-6 text-sm text-rose-600">{lista.erro}</p>
          : filtrados.length === 0 ? (
            <Vazio icone={<Users className="size-6" />} titulo="Nenhum morador encontrado"
              acao={<Botao icone={<Plus className="size-4" />} onClick={() => setEdicao('novo')}>Cadastrar morador</Botao>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[760px]">
                <thead>
                  <tr><th>Morador</th><th>Apto</th><th>Contato</th><th className="num">Compras</th><th>Situação</th><th className="text-right">Ações</th></tr>
                </thead>
                <tbody>
                  {filtrados.map((m) => (
                    <tr key={m.id} className={cx(!m.ativo && 'opacity-60', !m.revisado && 'bg-amber-50/40')}>
                      <td>
                        <p className="font-medium text-slate-900">{m.nome}</p>
                        <p className="text-xs text-slate-400">{m.origem === 'totem' ? 'cadastrou-se no totem' : 'cadastrado no painel'} em {dataBR(m.criado_em.slice(0, 10))}</p>
                      </td>
                      <td className="whitespace-nowrap">{m.apartamento}{m.bloco ? <span className="text-slate-400"> · Bloco {m.bloco}</span> : ''}</td>
                      <td className="text-slate-600">
                        <p className="text-xs text-slate-500 tabular-nums">CPF {mascararCpf(m.cpf)}</p>
                        <p>{telefoneBR(m.telefone) ?? '—'}</p>
                        {m.email && <p className="text-xs text-slate-400">{m.email}</p>}
                      </td>
                      <td className="num">{numero(m.compras)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {!m.ativo ? <Etiqueta>Inativo</Etiqueta> : m.bloqueado ? <Etiqueta tom="vermelho">Bloqueado (PIN errado)</Etiqueta> : <Etiqueta tom="verde">Ativo</Etiqueta>}
                          {!m.tem_pin && <Etiqueta tom="amarelo">Sem PIN</Etiqueta>}
                          {!m.revisado && <Etiqueta tom="amarelo">A revisar</Etiqueta>}
                        </div>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {!m.revisado && (
                            <button title="Confirmar cadastro" aria-label={`Confirmar cadastro de ${m.nome}`} onClick={() => confirmar(m)} className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700">
                              <Check className="size-4" />
                            </button>
                          )}
                          {m.bloqueado && (
                            <button title="Desbloquear" aria-label="Desbloquear" onClick={() => desbloquear(m)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-emerald-700">
                              <LockOpen className="size-4" />
                            </button>
                          )}
                          <button title="Editar" aria-label={`Editar ${m.nome}`} onClick={() => setEdicao(m)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                            <Pencil className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Cartao>

      <FormMorador valor={edicao} aoFechar={() => setEdicao(null)} aoSalvar={() => { setEdicao(null); lista.recarregar() }} />
    </>
  )
}

function FormMorador({ valor, aoFechar, aoSalvar }: { valor: Morador | 'novo' | null; aoFechar: () => void; aoSalvar: () => void }) {
  const api = useApi()
  const avisar = useAviso()
  const novo = valor === 'novo'
  const [f, setF] = useState<MoradorEditavel>({ nome: '', cpf: '', apartamento: '', bloco: null, telefone: null, email: null, ativo: true, pin: '' })
  const [ultimo, setUltimo] = useState(valor)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  if (valor !== ultimo) {
    setUltimo(valor)
    setErro(null)
    setF(valor && valor !== 'novo'
      ? { id: valor.id, nome: valor.nome, cpf: formatarCpf(valor.cpf ?? ''), apartamento: valor.apartamento, bloco: valor.bloco, telefone: valor.telefone, email: valor.email, ativo: valor.ativo, pin: '' }
      : { nome: '', cpf: '', apartamento: '', bloco: null, telefone: null, email: null, ativo: true, pin: '' })
  }
  const set = (k: keyof MoradorEditavel) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value || null }))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!cpfValido(f.cpf ?? '')) return setErro('CPF inválido. Confira os números.')
    if (novo && !f.pin) return setErro('Defina um PIN de 4 a 6 números.')
    if (f.pin && !/^\d{4,6}$/.test(f.pin)) return setErro('O PIN deve ter de 4 a 6 números.')
    setSalvando(true)
    try {
      await api.salvarMorador({ ...f, cpf: somenteDigitos(f.cpf ?? ''), nome: (f.nome ?? '').trim(), apartamento: (f.apartamento ?? '').trim() })
      avisar('sucesso', novo ? 'Morador cadastrado' : f.pin ? 'Morador atualizado e PIN trocado' : 'Morador atualizado')
      aoSalvar()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal aberto={!!valor} aoFechar={aoFechar} titulo={novo ? 'Novo morador' : 'Editar morador'}
      rodape={<><Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao><Botao type="submit" form="form-morador" carregando={salvando}>Salvar</Botao></>}>
      <form id="form-morador" onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
        <Rotulo texto="Nome completo" className="sm:col-span-2">
          <input className="campo" required maxLength={100} value={f.nome ?? ''} onChange={set('nome')} autoFocus />
        </Rotulo>
        <Rotulo texto="CPF" className="sm:col-span-2">
          <input className={cx('campo max-w-56 tabular-nums', (f.cpf ?? '').length === 14 && !cpfValido(f.cpf ?? '') && 'border-rose-400')}
            required inputMode="numeric" placeholder="000.000.000-00" value={f.cpf ?? ''} onChange={(e) => setF((x) => ({ ...x, cpf: formatarCpf(e.target.value) }))} />
        </Rotulo>
        <Rotulo texto="Apartamento"><input className="campo" required maxLength={10} value={f.apartamento ?? ''} onChange={set('apartamento')} placeholder="101" /></Rotulo>
        <Rotulo texto="Bloco / torre"><input className="campo" maxLength={10} value={f.bloco ?? ''} onChange={set('bloco')} placeholder="opcional" /></Rotulo>
        <Rotulo texto="Telefone" dica="Contato do morador (opcional)">
          <input className="campo" type="tel" value={f.telefone ?? ''} onChange={set('telefone')} placeholder="(11) 91234-5678" />
        </Rotulo>
        <Rotulo texto="E-mail" dica="Para receber o comprovante"><input className="campo" type="email" value={f.email ?? ''} onChange={set('email')} /></Rotulo>
        <Rotulo texto={novo ? 'PIN (4 a 6 números)' : 'Novo PIN'} dica={novo ? 'O morador usa no totem junto com o apartamento' : 'Deixe em branco para manter o PIN atual'} className="sm:col-span-2">
          <div className="relative max-w-48">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="campo pl-9 font-mono tracking-widest" inputMode="numeric" autoComplete="off" maxLength={6}
              value={f.pin ?? ''} onChange={(e) => setF((x) => ({ ...x, pin: e.target.value.replace(/\D/g, '') }))} />
          </div>
        </Rotulo>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-emerald-600" checked={f.ativo} onChange={(e) => setF((x) => ({ ...x, ativo: e.target.checked }))} />
          Cadastro ativo (pode se identificar no totem)
        </label>
        {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{erro}</p>}
      </form>
    </Modal>
  )
}
