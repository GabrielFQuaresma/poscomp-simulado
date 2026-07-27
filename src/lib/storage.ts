import type { AppData, ExamSession, QuestionAttemptRecord, SrsState, TopicSrsState } from '../types'
import { clearAllScratch, clearScratch } from './scratch'
import { emptyData, mergeAppData, migrate } from './merge'

const STORAGE_KEY = 'poscomp-simulado:data'

/** Avisos para a camada de sincronia. Ficam aqui porque este e o unico lugar
 * que sabe quando os dados mudaram; a sincronia se inscreve e nada mais no app
 * precisa saber que ela existe. Sem sincronia configurada, ninguem se inscreve
 * e o custo e uma chamada a um campo nulo. */
export interface StorageListeners {
  /** Algo mudou no historico local -- vale agendar um envio. */
  changed: () => void
  /** Uma prova foi apagada; o rascunho dela tambem precisa sumir do servidor. */
  sessionDeleted: (sessionId: string) => void
  /** O usuario pediu para apagar tudo, inclusive o que esta na nuvem. */
  reset: () => void
}

let listeners: Partial<StorageListeners> = {}

export function setStorageListeners(next: Partial<StorageListeners>): void {
  listeners = next
}

/** Copia em memoria do que esta no localStorage. Sem ela, cada getter reparseia
 * o blob inteiro -- a tela de estatisticas sozinha chama tres getters por
 * render, ou seja, tres parses de algo que passa de 1 MB depois de algumas
 * dezenas de simulados. Toda escrita passa por saveData, entao invalidar ali
 * basta; outra aba do mesmo site avisa pelo evento `storage`. */
let cache: AppData | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) cache = null
  })
}

export function loadData(): AppData {
  if (cache) return cache
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return (cache = emptyData())
  try {
    const parsed = JSON.parse(raw) as AppData
    if (!parsed.sessions || !parsed.attempts) return (cache = emptyData())
    return (cache = migrate(parsed))
  } catch {
    return (cache = emptyData())
  }
}

function write(data: AppData): void {
  cache = data
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function saveData(data: AppData): void {
  write(data)
  listeners.changed?.()
}

/** Grava o que veio da nuvem ja mesclado. Nao avisa `changed`: quem chama esta
 * funcao e a propria sincronia, que envia o resultado logo em seguida -- avisar
 * aqui agendaria um segundo envio identico. Invalidar o cache e o ponto: sem
 * isto as telas continuariam lendo a copia em memoria anterior ao merge. */
export function applyRemoteData(data: AppData): void {
  write(data)
}

export function upsertSession(session: ExamSession): void {
  const data = loadData()
  const stamped: ExamSession = { ...session, updatedAt: Date.now() }
  const idx = data.sessions.findIndex((s) => s.id === stamped.id)
  if (idx >= 0) data.sessions[idx] = stamped
  else data.sessions.push(stamped)
  saveData(data)
}

export function deleteSession(sessionId: string): void {
  const data = loadData()
  data.sessions = data.sessions.filter((s) => s.id !== sessionId)
  data.deletedSessions[sessionId] = Date.now()
  saveData(data)
  clearScratch(sessionId)
  listeners.sessionDeleted?.(sessionId)
}

export function getSession(sessionId: string): ExamSession | undefined {
  return loadData().sessions.find((s) => s.id === sessionId)
}

export function getInProgressSessions(): ExamSession[] {
  return loadData().sessions.filter((s) => s.finishedAt === null)
}

export function getFinishedSessions(): ExamSession[] {
  return loadData()
    .sessions.filter((s) => s.finishedAt !== null)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
}

export function addAttempts(records: QuestionAttemptRecord[]): void {
  const data = loadData()
  data.attempts.push(...records)
  saveData(data)
}

export function getAttempts(): QuestionAttemptRecord[] {
  return loadData().attempts
}

export function getSrsMap(): Record<string, SrsState> {
  return loadData().srs
}

export function saveSrsStates(states: SrsState[]): void {
  if (states.length === 0) return
  const data = loadData()
  for (const s of states) data.srs[s.questionId] = s
  saveData(data)
}

export function getTopicSrsMap(): Record<string, TopicSrsState> {
  return loadData().topicSrs
}

export function saveTopicSrsStates(states: TopicSrsState[]): void {
  if (states.length === 0) return
  const data = loadData()
  for (const s of states) data.topicSrs[s.topicSlug] = s
  saveData(data)
}

export function resetAll(): void {
  cache = null
  localStorage.removeItem(STORAGE_KEY)
  clearAllScratch()
  // Sem apagar tambem no servidor, a proxima sincronia traria tudo de volta e
  // o botao pareceria nao funcionar.
  listeners.reset?.()
}

export function exportData(): string {
  return JSON.stringify(loadData(), null, 2)
}

/** Importa um arquivo exportado por outro dispositivo. Usa o mesmo merge da
 * sincronia: e a mesma pergunta ("estes dois estados sao um so, quem vence
 * campo a campo?"), e manter duas respostas para ela seria manter dois jeitos
 * de perder dados. */
export function importData(json: string): { sessions: number; attempts: number } {
  const incoming = JSON.parse(json) as AppData
  if (!incoming.sessions || !incoming.attempts) {
    throw new Error('Arquivo invalido: formato nao reconhecido')
  }
  const merged = mergeAppData(loadData(), incoming)
  saveData(merged)
  return { sessions: merged.sessions.length, attempts: merged.attempts.length }
}
