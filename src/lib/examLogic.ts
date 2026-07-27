import type { Area, AnswerLetter, CorrectionMode, ExamMode, ExamSession, Question, QuestionAttemptRecord, SrsState } from '../types'
import { getAttempts } from './storage'
import { isDue, reviewSrs } from './srs'

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

/** Pratica focada em um topico. Inclui questoes em que o topico e secundario:
 * quem quer treinar recorrencia tambem se beneficia da questao de complexidade
 * que exige resolver uma recorrencia no meio. */
export function buildTopicExam(
  questions: Question[],
  topicSlugs: string[],
  topicLabels: Map<string, string>,
  count: number,
  filters: RandomExamFilters,
  opts: NewExamOptions,
): ExamSession {
  let pool = questions.filter((q) => q.topics.some((t) => topicSlugs.includes(t)))
  if (filters.excludeAnnulled) pool = pool.filter((q) => !q.annulled)
  if (filters.excludeAlreadyCorrect) {
    const correct = alreadyCorrectIds()
    pool = pool.filter((q) => !correct.has(q.id))
  }
  const ids = shuffle(pool)
    .slice(0, count)
    .map((q) => q.id)
  const names = topicSlugs.map((s) => topicLabels.get(s) ?? s).join(', ')
  return createSession('topic', `Topico: ${names} (${ids.length}q)`, ids, opts)
}

/** Questoes com revisao vencida (dueAt <= now), das mais atrasadas para as
 * menos atrasadas, para priorizar o que esta ha mais tempo esperando. */
export function dueSrsQuestions(questions: Question[], srsMap: Record<string, SrsState>, now: number): Question[] {
  return questions
    .filter((q) => isDue(srsMap[q.id], now))
    .sort((a, b) => srsMap[a.id].dueAt - srsMap[b.id].dueAt)
}

export function buildSrsExam(
  questions: Question[],
  srsMap: Record<string, SrsState>,
  opts: NewExamOptions,
): ExamSession {
  const due = dueSrsQuestions(questions, srsMap, Date.now()).map((q) => q.id)
  return createSession('srs', `Revisao espacada (${due.length}q)`, due, opts)
}

/** Atualiza o estado de repeticao espacada (SM-2) de cada questao respondida
 * na sessao. Questoes em branco sao ignoradas: nao houve tentativa a avaliar. */
export function buildSrsUpdates(
  session: ExamSession,
  questionMap: Map<string, Question>,
  srsMap: Record<string, SrsState>,
  now: number,
): SrsState[] {
  const updates: SrsState[] = []
  for (const id of session.questionIds) {
    const q = questionMap.get(id)
    const resp = session.responses[id]
    if (!q || !resp) continue
    updates.push(reviewSrs(srsMap[id], isCorrect(q, resp), now, id))
  }
  return updates
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
