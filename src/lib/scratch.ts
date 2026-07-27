/** Rascunho de uma questao: o que foi escrito e o que foi desenhado.
 * `drawing` e um PNG em data URL, vazio quando nao ha traco nenhum. */
export interface Scratch {
  text: string
  drawing: string
}

/** O rascunho mora fora do AppData, uma chave por sessao. Dois motivos: um
 * PNG de desenho pesa dezenas de KB e o AppData inteiro e reserializado a cada
 * 5s durante a prova -- juntar os dois deixaria o autosave lento; e o rascunho
 * e material de trabalho, nao progresso, entao nao faz sentido no export. */
const PREFIX = 'poscomp-simulado:scratch:'

export const EMPTY_SCRATCH: Scratch = { text: '', drawing: '' }

export function hasContent(scratch: Scratch | undefined): boolean {
  return !!scratch && (scratch.text.trim().length > 0 || scratch.drawing.length > 0)
}

/** A sincronia se inscreve aqui para saber que um rascunho mudou. Sem ela
 * configurada, o custo e uma chamada a um campo nulo por gravacao. */
let onChange: ((sessionId: string) => void) | null = null

export function setScratchListener(fn: ((sessionId: string) => void) | null): void {
  onChange = fn
}

export function loadScratch(sessionId: string): Record<string, Scratch> {
  const raw = localStorage.getItem(PREFIX + sessionId)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, Scratch>
  } catch {
    return {}
  }
}

/** Retorna false quando o navegador recusou por falta de espaco, para a tela
 * poder avisar em vez de perder o rascunho silenciosamente. */
export function saveScratch(sessionId: string, map: Record<string, Scratch>): boolean {
  if (!write(sessionId, map)) return false
  onChange?.(sessionId)
  return true
}

/** Grava o rascunho que veio da nuvem sem avisar a sincronia: se avisasse,
 * agendaria o envio de volta do que acabou de ser baixado. */
export function applyRemoteScratch(sessionId: string, map: Record<string, Scratch>): void {
  write(sessionId, map)
}

function write(sessionId: string, map: Record<string, Scratch>): boolean {
  const kept = Object.fromEntries(Object.entries(map).filter(([, s]) => hasContent(s)))
  try {
    if (Object.keys(kept).length === 0) localStorage.removeItem(PREFIX + sessionId)
    else localStorage.setItem(PREFIX + sessionId, JSON.stringify(kept))
    return true
  } catch {
    return false
  }
}

export function clearScratch(sessionId: string): void {
  localStorage.removeItem(PREFIX + sessionId)
}

export function clearAllScratch(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
}
