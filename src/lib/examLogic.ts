import type { Area, AnswerLetter, CorrectionMode, ExamMode, ExamSession, Question, QuestionAttemptRecord } from '../types'
import { getAttempts } from './storage'

export function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface NewExamOptions {
  correctionMode: CorrectionMode
  timeLimitSeconds: number | null
}

export function createSession(
  mode: ExamMode,
  label: string,
  questionIds: string[],
  opts: NewExamOptions,
): ExamSession {
  return {
    id: newSessionId(),
    mode,
    label,
    createdAt: Date.now(),
    finishedAt: null,
    correctionMode: opts.correctionMode,
    timeLimitSeconds: opts.timeLimitSeconds,
    questionIds,
    responses: {},
    flagged: {},
    elapsedSeconds: 0,
  }
}

export function buildYearExam(questions: Question[], year: number, opts: NewExamOptions): ExamSession {
  const ids = questions
    .filter((q) => q.year === year)
    .sort((a, b) => a.number - b.number)
    .map((q) => q.id)
  return createSession('year', `Prova ${year}`, ids, opts)
}

const STANDARD_QUOTA: Record<Area, number> = {
  matematica: 20,
  fundamentos: 30,
  tecnologia: 20,
  desconhecida: 0,
}

export interface RandomExamFilters {
  excludeAnnulled: boolean
  excludeAlreadyCorrect: boolean
}

function alreadyCorrectIds(): Set<string> {
  const correct = new Set<string>()
  for (const a of getAttempts()) {
    if (a.correct) correct.add(a.questionId)
  }
  return correct
}

export function buildRandomExam(
  questions: Question[],
  filters: RandomExamFilters,
  opts: NewExamOptions,
): ExamSession {
  let pool = questions
  if (filters.excludeAnnulled) pool = pool.filter((q) => !q.annulled)
  if (filters.excludeAlreadyCorrect) {
    const correct = alreadyCorrectIds()
    pool = pool.filter((q) => !correct.has(q.id))
  }

  const ids: string[] = []
  for (const [area, quota] of Object.entries(STANDARD_QUOTA) as [Area, number][]) {
    if (quota === 0) continue
    const areaPool = shuffle(pool.filter((q) => q.area === area))
    ids.push(...areaPool.slice(0, quota).map((q) => q.id))
  }
  return createSession('random', 'Simulado aleatorio (70q)', shuffle(ids), opts)
}

export function buildAreaExam(
  questions: Question[],
  areas: Area[],
  count: number,
  filters: RandomExamFilters,
  opts: NewExamOptions,
): ExamSession {
  let pool = questions.filter((q) => areas.includes(q.area))
  if (filters.excludeAnnulled) pool = pool.filter((q) => !q.annulled)
  if (filters.excludeAlreadyCorrect) {
    const correct = alreadyCorrectIds()
    pool = pool.filter((q) => !correct.has(q.id))
  }
  const ids = shuffle(pool)
    .slice(0, count)
    .map((q) => q.id)
  const label = `Pratica: ${areas.join(', ')} (${ids.length}q)`
  return createSession('area', label, ids, opts)
}

export function buildWrongExam(questions: Question[], opts: NewExamOptions): ExamSession {
  const attempts = getAttempts()
  const lastByQuestion = new Map<string, boolean>()
  for (const a of attempts.sort((x, y) => x.timestamp - y.timestamp)) {
    lastByQuestion.set(a.questionId, a.correct)
  }
  const wrongIds = questions
    .filter((q) => lastByQuestion.get(q.id) === false)
    .map((q) => q.id)
  return createSession('wrong', `Refazer erradas (${wrongIds.length}q)`, shuffle(wrongIds), opts)
}

export function isCorrect(question: Question, answer: AnswerLetter | undefined): boolean {
  if (question.annulled) return true
  if (!answer) return false
  return answer === question.answer
}

export interface ScoreSummary {
  total: number
  answered: number
  correct: number
  incorrect: number
  blank: number
  byArea: Record<string, { total: number; correct: number }>
}

export function scoreSession(session: ExamSession, questionMap: Map<string, Question>): ScoreSummary {
  const byArea: Record<string, { total: number; correct: number }> = {}
  let correct = 0
  let answered = 0

  for (const id of session.questionIds) {
    const q = questionMap.get(id)
    if (!q) continue
    byArea[q.area] ??= { total: 0, correct: 0 }
    byArea[q.area].total += 1

    const resp = session.responses[id]
    if (resp) answered += 1
    const ok = isCorrect(q, resp)
    if (ok) {
      correct += 1
      byArea[q.area].correct += 1
    }
  }

  return {
    total: session.questionIds.length,
    answered,
    correct,
    incorrect: answered - correct,
    blank: session.questionIds.length - answered,
    byArea,
  }
}

export function buildAttemptRecords(session: ExamSession, questionMap: Map<string, Question>): QuestionAttemptRecord[] {
  const now = Date.now()
  const records: QuestionAttemptRecord[] = []
  for (const id of session.questionIds) {
    const q = questionMap.get(id)
    if (!q) continue
    const resp = session.responses[id]
    records.push({
      questionId: id,
      sessionId: session.id,
      timestamp: now,
      answer: resp ?? null,
      correct: isCorrect(q, resp),
    })
  }
  return records
}
