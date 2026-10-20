// Exportação de relatórios. As bibliotecas são carregadas só quando o
// usuário clica em exportar (não pesam no carregamento inicial).

export interface Coluna<T> {
  titulo: string
  valor: (l: T) => string | number | null
  /** formato numérico do Excel, ex.: '"R$" #,##0.00' */
  formatoExcel?: string
  largura?: number
  alinhar?: 'esquerda' | 'direita'
}
export interface Secao<T = never> {
  titulo: string
  colunas: Coluna<T>[]
  linhas: T[]
}

const MOEDA_XLS = '"R$" #,##0.00'
export const fmtExcel = { moeda: MOEDA_XLS, inteiro: '#,##0', pct: '0.0%' }

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: nome })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportarExcel(nomeArquivo: string, secoes: Secao<any>[]) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'pickgo'
  for (const s of secoes) {
    const ws = wb.addWorksheet(s.titulo.slice(0, 31))
    ws.columns = s.colunas.map((c) => ({ header: c.titulo, width: c.largura ?? Math.max(12, c.titulo.length + 4), style: c.formatoExcel ? { numFmt: c.formatoExcel } : {} }))
    for (const l of s.linhas) ws.addRow(s.colunas.map((c) => c.valor(l)))
    const cab = ws.getRow(1)
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4A34' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.colunas.length } }
  }
  const buf = await wb.xlsx.writeBuffer()
  baixar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${nomeArquivo}.xlsx`)
}

export async function exportarPDF(nomeArquivo: string, titulo: string, subtitulo: string, secoes: Secao<any>[], destaques?: { rotulo: string; valor: string }[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const larg = doc.internal.pageSize.getWidth()

  doc.setFillColor(15, 74, 52)
  doc.rect(0, 0, larg, 64, 'F')
  doc.setTextColor(255)
  doc.setFont('helvetica', 'bold').setFontSize(16).text(titulo, 40, 30)
  doc.setFont('helvetica', 'normal').setFontSize(10).text(subtitulo, 40, 48)
  doc.setTextColor(30)
  let y = 88

  if (destaques?.length) {
    const w = (larg - 80) / destaques.length
    destaques.forEach((d, i) => {
      const x = 40 + i * w
      doc.setDrawColor(226, 232, 240).roundedRect(x + 2, y, w - 4, 46, 4, 4, 'S')
      doc.setFontSize(8).setTextColor(100).text(d.rotulo.toUpperCase(), x + 10, y + 16)
      doc.setFontSize(12).setFont('helvetica', 'bold').setTextColor(15).text(d.valor, x + 10, y + 34)
      doc.setFont('helvetica', 'normal')
    })
    y += 66
  }

  for (const s of secoes) {
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(15).text(s.titulo, 40, y)
    autoTable(doc, {
      startY: y + 6,
      head: [s.colunas.map((c) => c.titulo)],
      body: s.linhas.map((l) => s.colunas.map((c) => String(c.valor(l) ?? ''))),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85] },
      columnStyles: Object.fromEntries(s.colunas.map((c, i) => [i, { halign: c.alinhar === 'direita' ? 'right' : 'left' }])),
      margin: { left: 40, right: 40 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage()
      y = 50
    }
  }

  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFontSize(8).setTextColor(140)
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · página ${i} de ${paginas}`, 40, doc.internal.pageSize.getHeight() - 20)
  }
  doc.save(`${nomeArquivo}.pdf`)
}
