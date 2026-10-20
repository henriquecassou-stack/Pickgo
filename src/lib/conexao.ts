// Estado da conexão. Além do navigator.onLine, permite SIMULAR a queda da
// internet (usado no modo demonstração para testar o PIX sem internet).
// A simulação vale só para a aba atual e sobrevive a recarregar a página.

const CHAVE = 'mercado-simular-offline'

function simulando() {
  try {
    return sessionStorage.getItem(CHAVE) === '1'
  } catch {
    return false
  }
}

/** Há internet? (falso se o navegador está offline ou a queda está sendo simulada) */
export function online() {
  return !simulando() && (typeof navigator === 'undefined' || navigator.onLine)
}

export function estaSimulandoOffline() {
  return simulando()
}

/** Liga/desliga a simulação e avisa o app com os mesmos eventos do navegador */
export function simularOffline(ligar: boolean) {
  try {
    if (ligar) sessionStorage.setItem(CHAVE, '1')
    else sessionStorage.removeItem(CHAVE)
  } catch {
    /* ignora */
  }
  window.dispatchEvent(new Event(ligar ? 'offline' : 'online'))
}
