import type { AppData, ExamSession, QuestionAttemptRecord, SrsState, TopicSrsState } from '../types'
import { clearAllScratch, clearScratch } from './scratch'

const STORAGE_KEY = 'poscomp-simulado:data'

function emptyData(): AppData {
  return { version: 3, sessions: [], attempts: [], srs: {}, topicSrs: {} }
}

/** Preenche os campos que versoes anteriores nao gravavam. Nada e descartado:
 * o historico de quem ja usava o site continua valendo, so sem tempo por
 * questao (que ninguem media) e sem agenda de temas (que so passa a existir
 * conforme novas provas forem finalizadas). */
function migrate(data: AppData): AppData {
  data.srs ??= {}
  data.topicSrs ??= {}
  for (const s of data.sessions) {
    s.timePerQuestion ??= {}
    s.absences ??= []
  }
  for (const a of data.attempts) a.secondsSpent ??= 0
  data.version = 3
  return data
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

export function saveData(data: AppData): void {
  cache = data
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function upsertSession(session: ExamSession): void {
  const data = loadData()
  const idx = data.sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) data.sessions[idx] = session
  else data.sessions.push(session)
  saveData(data)
}

export function deleteSession(sessionId: string): void {
  const data = loadData()
  data.sessions = data.sessions.filter((s) => s.id !== sessionId)
  saveData(data)
  clearScratch(sessionId)
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
}

export function exportData(): string {
  return JSON.stringify(loadData(), null, 2)
}

/** Merge imported data into local data. Sessions/attempts are merged by id
 * with the newer (by timestamp) version winning, so importing on a second
 * computer can't clobber more recent local progress. */
export function importData(json: string): { sessions: number; attempts: number } {
  const incoming = JSON.parse(json) as AppData
  if (!incoming.sessions || !incoming.attempts) {
    throw new Error('Arquivo invalido: formato nao reconhecido')
  }
  const current = loadData()

  const sessionMap = new Map<string, ExamSession>()
  for (const s of current.sessions) sessionMap.set(s.id, s)
  for (const s of incoming.sessions) {
    const existing = sessionMap.get(s.id)
    if (!existing || (s.finishedAt ?? s.createdAt) >= (existing.finishedAt ?? existing.createdAt)) {
      sessionMap.set(s.id, s)
    }
  }

  const attemptKey = (a: QuestionAttemptRecord) => `${a.sessionId}:${a.questionId}:${a.timestamp}`
  const attemptMap = new Map<string, QuestionAttemptRecord>()
  for (const a of current.attempts) attemptMap.set(attemptKey(a), a)
  for (const a of incoming.attempts) attemptMap.set(attemptKey(a), a)

  const srs: Record<string, SrsState> = { ...current.srs }
  for (const [qid, incomingState] of Object.entries(incoming.srs ?? {})) {
    const existing = srs[qid]
    if (!existing || incomingState.lastReviewedAt >= existing.lastReviewedAt) {
      srs[qid] = incomingState
    }
  }

  const topicSrs: Record<string, TopicSrsState> = { ...current.topicSrs }
  for (const [slug, incomingState] of Object.entries(incoming.topicSrs ?? {})) {
    const existing = topicSrs[slug]
    if (!existing || incomingState.lastReviewedAt >= existing.lastReviewedAt) {
      topicSrs[slug] = incomingState
    }
  }

  const merged: AppData = migrate({
    version: 3,
    sessions: Array.from(sessionMap.values()),
    attempts: Array.from(attemptMap.values()),
    srs,
    topicSrs,
  })
  saveData(merged)
  return { sessions: merged.sessions.length, attempts: merged.attempts.length }
}
