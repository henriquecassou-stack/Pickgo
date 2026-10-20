// CPF: validação pelos dígitos verificadores e formatação.

export const somenteDigitos = (v: string) => v.replace(/\D/g, '')

export function cpfValido(valor: string) {
  const d = somenteDigitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((s, n, i) => s + Number(n) * (pesoInicial - i), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10])
}

/** máscara enquanto digita: 000.000.000-00 */
export function formatarCpf(valor: string) {
  const d = somenteDigitos(valor).slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

/** para listas e telas: ***.456.789-** */
export function mascararCpf(valor: string | null | undefined) {
  const d = somenteDigitos(valor ?? '')
  if (d.length !== 11) return '—'
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}
