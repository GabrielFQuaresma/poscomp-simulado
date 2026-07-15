import type { AppData, ExamSession, QuestionAttemptRecord } from '../types'

const STORAGE_KEY = 'poscomp-simulado:data'

function emptyData(): AppData {
  return { version: 1, sessions: [], attempts: [] }
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return emptyData()
  try {
    const parsed = JSON.parse(raw) as AppData
    if (!parsed.sessions || !parsed.attempts) return emptyData()
    return parsed
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): void {
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

export function resetAll(): void {
  localStorage.removeItem(STORAGE_KEY)
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

  const merged: AppData = {
    version: 1,
    sessions: Array.from(sessionMap.values()),
    attempts: Array.from(attemptMap.values()),
  }
  saveData(merged)
  return { sessions: merged.sessions.length, attempts: merged.attempts.length }
}
