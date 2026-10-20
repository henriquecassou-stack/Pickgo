import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Movimentacao } from '../lib/tipos'
import { brl, dataHoraBR, ROTULO_MOTIVO } from '../lib/formato'
import { type Coluna } from '../lib/exportar'
import { Etiqueta, cx } from './ui'

export function TabelaMovimentacoes({ linhas, mostrarProduto = true }: { linhas: Movimentacao[]; mostrarProduto?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabela min-w-[880px]">
        <thead>
          <tr>
            <th>Data</th>
            {mostrarProduto && <th>Produto</th>}
            <th>Tipo</th>
            <th className="num">Qtd.</th>
            <th className="num">Saldo após</th>
            <th className="num">Custo un.</th>
            <th>Origem</th>
            <th>Responsável</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap tabular-nums text-slate-600">{dataHoraBR(m.data_movimentacao)}</td>
              {mostrarProduto && (
                <td>
                  <Link to={`/admin/produtos/${m.produto_id}`} className="font-medium text-slate-800 hover:text-emerald-700 hover:underline">{m.produto_nome}</Link>
                  {m.categoria_nome && <p className="text-xs text-slate-400">{m.categoria_nome}</p>}
                </td>
              )}
              <td>
                <Etiqueta tom={m.tipo === 'entrada' ? 'verde' : m.motivo === 'venda' ? 'azul' : 'vermelho'}
                  icone={m.tipo === 'entrada' ? <ArrowDownToLine className="size-3" /> : <ArrowUpFromLine className="size-3" />}>
                  {ROTULO_MOTIVO[m.motivo]}
                </Etiqueta>
              </td>
              <td className={cx('num font-semibold', m.tipo === 'entrada' ? 'text-emerald-700' : 'text-rose-600')}>
                {m.tipo === 'entrada' ? '+' : '−'}{m.quantidade}
              </td>
              <td className="num">
                <span className="text-xs text-slate-400">{m.saldo_anterior} → </span>
                <strong className={m.saldo_posterior < 0 ? 'text-rose-600' : ''}>{m.saldo_posterior}</strong>
              </td>
              <td className="num text-slate-600">{m.custo_unitario != null ? brl(m.custo_unitario) : '—'}</td>
              <td className="max-w-56 text-slate-600">
                <p className="truncate">{m.venda_numero ? `Venda #${m.venda_numero}` : m.fornecedor_nome ?? '—'}</p>
                {m.observacao && !m.venda_numero && <p className="truncate text-xs text-slate-400" title={m.observacao}>{m.observacao}</p>}
              </td>
              <td className="text-slate-600">{m.usuario_nome ?? (m.motivo === 'venda' ? 'Totem' : 'Sistema')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const COLUNAS_EXPORT_MOV: Coluna<Movimentacao>[] = [
  { titulo: 'Data', valor: (m) => dataHoraBR(m.data_movimentacao), largura: 18 },
  { titulo: 'Produto', valor: (m) => m.produto_nome, largura: 32 },
  { titulo: 'Categoria', valor: (m) => m.categoria_nome },
  { titulo: 'Tipo', valor: (m) => (m.tipo === 'entrada' ? 'Entrada' : 'Saída') },
  { titulo: 'Motivo', valor: (m) => ROTULO_MOTIVO[m.motivo], largura: 16 },
  { titulo: 'Quantidade', valor: (m) => (m.tipo === 'entrada' ? m.quantidade : -m.quantidade), alinhar: 'direita' },
  { titulo: 'Saldo após', valor: (m) => m.saldo_posterior, alinhar: 'direita' },
  { titulo: 'Custo unitário', valor: (m) => m.custo_unitario, formatoExcel: '"R$" #,##0.00', alinhar: 'direita' },
  { titulo: 'Fornecedor / venda', valor: (m) => (m.venda_numero ? `Venda #${m.venda_numero}` : m.fornecedor_nome), largura: 24 },
  { titulo: 'Responsável', valor: (m) => m.usuario_nome ?? (m.motivo === 'venda' ? 'Totem' : 'Sistema'), largura: 20 },
  { titulo: 'Observação', valor: (m) => m.observacao, largura: 30 },
]
