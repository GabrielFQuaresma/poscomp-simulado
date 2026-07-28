import type { Area, AnswerLetter, CorrectionMode, ExamMode, ExamSession, Question, QuestionAttemptRecord, QuestionMark, SrsState, TopicSrsState } from '../types'
import { openMarks } from './marks'
import { DAILY_REVIEW_LIMIT, isDue, reviewSrs, reviewTopicSrs } from './srs'

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

/** Retira um item de cada grupo por vez. Enquanto houver dois grupos com
 * questoes, nenhuma questao cai ao lado de outra do mesmo tema -- que e o
 * ponto da intercalacao: obrigar a reconhecer de que assunto e a questao
 * antes de resolver, como acontece na prova. Sortear do bolo unido nao faz
 * isso: o tema com mais questoes no banco domina a amostra. */
function roundRobin<T>(groups: T[][], count: number): T[] {
  const queues = shuffle(groups.map((g) => [...g]))
  const out: T[] = []
  let served = true
  while (out.length < count && served) {
    served = false
    for (const queue of queues) {
      if (out.length >= count) break
      const next = queue.shift()
      if (next === undefined) continue
      out.push(next)
      served = true
    }
  }
  return out
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
    timePerQuestion: {},
    absences: [],
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
  /** Historico usado por excludeAlreadyCorrect. Vem de fora em vez de ser lido
   * daqui: montar prova e decidir onde os dados moram sao responsabilidades
   * diferentes, e so a segunda muda se o historico passar a vir de um servidor. */
  attempts: QuestionAttemptRecord[]
}

function alreadyCorrectIds(attempts: QuestionAttemptRecord[]): Set<string> {
  const correct = new Set<string>()
  for (const a of attempts) {
    if (a.correct) correct.add(a.questionId)
  }
  return correct
}

function applyFilters(pool: Question[], filters: RandomExamFilters): Question[] {
  let filtered = pool
  if (filters.excludeAnnulled) filtered = filtered.filter((q) => !q.annulled)
  if (filters.excludeAlreadyCorrect) {
    const correct = alreadyCorrectIds(filters.attempts)
    filtered = filtered.filter((q) => !correct.has(q.id))
  }
  return filtered
}

export function buildRandomExam(
  questions: Question[],
  filters: RandomExamFilters,
  opts: NewExamOptions,
): ExamSession {
  const pool = applyFilters(questions, filters)

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
  const pool = applyFilters(questions.filter((q) => areas.includes(q.area)), filters)
  const ids = shuffle(pool)
    .slice(0, count)
    .map((q) => q.id)
  const label = `Pratica: ${areas.join(', ')} (${ids.length}q)`
  return createSession('area', label, ids, opts)
}

/** Tema pelo qual a questao entra no treino: o primeiro dos seus temas que
 * esta entre os selecionados, para que uma questao de complexidade que tambem
 * usa recorrencia conte no balde em que ela e mais central. */
function bucketOf(question: Question, topicSlugs: string[]): string | undefined {
  return question.topics.find((t) => topicSlugs.includes(t))
}

/** Pratica focada em temas, intercalada. Inclui questoes em que o topico e
 * secundario: quem quer treinar recorrencia tambem se beneficia da questao de
 * complexidade que exige resolver uma recorrencia no meio. Com varios temas
 * marcados, cada um entra com a mesma frequencia e nunca duas seguidas do
 * mesmo tema -- estudar Grafos por 15 questoes seguidas e pratica bloqueada,
 * que parece mais produtiva e retem menos. */
export function buildTopicExam(
  questions: Question[],
  topicSlugs: string[],
  topicLabels: Map<string, string>,
  count: number,
  filters: RandomExamFilters,
  opts: NewExamOptions,
): ExamSession {
  const pool = applyFilters(
    questions.filter((q) => q.topics.some((t) => topicSlugs.includes(t))),
    filters,
  )
  const groups = topicSlugs.map((slug) => shuffle(pool.filter((q) => bucketOf(q, topicSlugs) === slug)))
  const ids = roundRobin(groups, count).map((q) => q.id)
  const names = topicSlugs.map((s) => topicLabels.get(s) ?? s).join(', ')
  const prefix = topicSlugs.length > 1 ? 'Intercalado' : 'Topico'
  return createSession('topic', `${prefix}: ${names} (${ids.length}q)`, ids, opts)
}

/** Questoes com revisao vencida (dueAt <= now), das mais atrasadas para as
 * menos atrasadas, para priorizar o que esta ha mais tempo esperando. */
export function dueSrsQuestions(questions: Question[], srsMap: Record<string, SrsState>, now: number): Question[] {
  return questions
    .filter((q) => isDue(srsMap[q.id], now))
    .sort((a, b) => srsMap[a.id].dueAt - srsMap[b.id].dueAt)
}

/** Revisao das questoes exatas que voce errou. Util para conferir se a duvida
 * pontual foi resolvida, mas nao substitui a revisao por tema: reencontrar a
 * mesma imagem acaba testando a memoria daquela questao, nao do assunto. */
export function buildSrsExam(
  questions: Question[],
  srsMap: Record<string, SrsState>,
  opts: NewExamOptions,
  limit: number = DAILY_REVIEW_LIMIT,
): ExamSession {
  const due = dueSrsQuestions(questions, srsMap, Date.now())
  const ids = due.slice(0, limit).map((q) => q.id)
  const suffix = due.length > ids.length ? ` de ${due.length}` : ''
  return createSession('srs', `Revisao de questoes (${ids.length}${suffix}q)`, ids, opts)
}

/** Refaz as questoes do caderno de revisao, das marcadas ha mais tempo para as
 * mais recentes. Aqui reencontrar a mesma imagem e o ponto, nao o defeito: a
 * marca diz "esta eu nao resolvi", e a unica forma de saber se resolveu e
 * tentar de novo. Para atacar o assunto em vez da questao, o caderno tambem
 * oferece treinar os temas das marcadas, que cai no buildTopicExam. */
export function buildMarkedExam(
  questions: Question[],
  marks: Record<string, QuestionMark>,
  opts: NewExamOptions,
  limit: number = DAILY_REVIEW_LIMIT,
): ExamSession {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const open = openMarks(marks).filter((m) => byId.has(m.questionId))
  const ids = open.slice(0, limit).map((m) => m.questionId)
  const suffix = open.length > ids.length ? ` de ${open.length}` : ''
  return createSession('marked', `Marcadas (${ids.length}${suffix}q)`, ids, opts)
}

export function dueTopicSlugs(topicSrs: Record<string, TopicSrsState>, now: number): TopicSrsState[] {
  return Object.values(topicSrs)
    .filter((s) => isDue(s, now))
    .sort((a, b) => a.dueAt - b.dueAt)
}

/** Ultima vez que cada questao foi respondida. Ausente = nunca vista. */
function lastSeenAt(attempts: QuestionAttemptRecord[]): Map<string, number> {
  const seen = new Map<string, number>()
  for (const a of attempts) {
    const prev = seen.get(a.questionId)
    if (prev === undefined || a.timestamp > prev) seen.set(a.questionId, a.timestamp)
  }
  return seen
}

/** Questoes do tema, das mais uteis para revisar as menos: primeiro as que
 * voce nunca viu, depois as vistas ha mais tempo. Anuladas ficam de fora --
 * contam como acerto automatico e nao testam nada. Questoes em que o tema e
 * secundario entram so quando as principais acabam. */
function reviewCandidates(questions: Question[], slug: string, seen: Map<string, number>): Question[] {
  const rank = (list: Question[]) => {
    const fresh = shuffle(list.filter((q) => !seen.has(q.id)))
    const revisited = list
      .filter((q) => seen.has(q.id))
      .sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0))
    return [...fresh, ...revisited]
  }
  const usable = questions.filter((q) => !q.annulled && q.topics.includes(slug))
  return [
    ...rank(usable.filter((q) => q.topics[0] === slug)),
    ...rank(usable.filter((q) => q.topics[0] !== slug)),
  ]
}

/** Revisao espacada por tema. O tema define *quando* revisar; a questao servida
 * e sempre a mais inedita disponivel, para testar o assunto em vez da memoria
 * de um enunciado ja visto. Os temas vencidos entram intercalados. */
export function buildTopicSrsExam(
  questions: Question[],
  topicSrs: Record<string, TopicSrsState>,
  attempts: QuestionAttemptRecord[],
  topicLabels: Map<string, string>,
  opts: NewExamOptions,
  limit: number = DAILY_REVIEW_LIMIT,
): ExamSession {
  const due = dueTopicSlugs(topicSrs, Date.now())
  const seen = lastSeenAt(attempts)
  const groups = due.map((t) => reviewCandidates(questions, t.topicSlug, seen))
  const ids = roundRobin(groups, limit).map((q) => q.id)
  const names = due.length <= 2 ? due.map((t) => topicLabels.get(t.topicSlug) ?? t.topicSlug).join(' e ') : `${due.length} temas`
  return createSession('srs-topic', `Revisao: ${names} (${ids.length}q)`, ids, opts)
}

/** Atualiza o estado de repeticao espacada (SM-2) de cada questao respondida
 * na sessao. Questoes em branco sao ignoradas: nao houve tentativa a avaliar.
 *
 * A estrela que sobreviveu ate o envio entra como duvida declarada: ninguem
 * marca e deixa marcada aquilo de que tem certeza. */
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
    updates.push(reviewSrs(srsMap[id], isCorrect(q, resp), now, id, !!session.flagged[id]))
  }
  return updates
}

/** Reagenda cada tema tocado pela sessao a partir do seu acerto no tema. Um
 * tema so entra na agenda depois de aparecer numa prova, entao o calendario se
 * monta sozinho conforme voce estuda. Anuladas ficam fora da conta: acerto
 * automatico inflaria o tema e o mandaria para longe sem motivo -- e acerto
 * marcado tambem nao conta, pelo mesmo motivo: um tema em que voce chutou tudo
 * certo nao merece sumir da agenda por seis dias. */
export function buildTopicSrsUpdates(
  session: ExamSession,
  questionMap: Map<string, Question>,
  topicSrs: Record<string, TopicSrsState>,
  now: number,
): TopicSrsState[] {
  const tally = new Map<string, { correct: number; total: number }>()
  for (const id of session.questionIds) {
    const q = questionMap.get(id)
    const resp = session.responses[id]
    if (!q || !resp || q.annulled || q.topics.length === 0) continue
    const slug = q.topics[0]
    const entry = tally.get(slug) ?? { correct: 0, total: 0 }
    entry.total += 1
    if (isCorrect(q, resp) && !session.flagged[id]) entry.correct += 1
    tally.set(slug, entry)
  }
  return [...tally.entries()].map(([slug, v]) =>
    reviewTopicSrs(topicSrs[slug], v.correct, v.total, now, slug),
  )
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
      secondsSpent: session.timePerQuestion?.[id] ?? 0,
    })
  }
  return records
}

/** Ritmo alvo: o tempo total dividido pelas questoes. Numa prova de 70 questoes
 * em 4h da 3min26s por questao -- o numero que decide se voce termina. */
export function targetSecondsPerQuestion(session: ExamSession): number | null {
  if (!session.timeLimitSeconds || session.questionIds.length === 0) return null
  return session.timeLimitSeconds / session.questionIds.length
}

/** Segundos de adiantamento (negativo) ou de atraso (positivo) em relacao ao
 * ritmo alvo, medido pelo que ja foi respondido. */
export function paceDelta(session: ExamSession, elapsedSeconds: number, answeredCount: number): number | null {
  const target = targetSecondsPerQuestion(session)
  if (target === null) return null
  return elapsedSeconds - answeredCount * target
}

export interface PaceSummary {
  /** Questoes que registraram tempo. Sessoes antigas nao tem, e ficam de fora. */
  measured: number
  totalSeconds: number
  averageSeconds: number
  averageCorrect: number | null
  averageIncorrect: number | null
  slowest: { question: Question; seconds: number; correct: boolean }[]
}

/** Analise de ritmo de uma sessao ja finalizada. Comparar o tempo medio das
 * acertadas com o das erradas mostra se voce esta perdendo tempo em questao
 * que nao ia acertar de todo jeito -- o erro de gestao mais caro na prova. */
export function pacingSummary(session: ExamSession, questionMap: Map<string, Question>): PaceSummary | null {
  const timed: { question: Question; seconds: number; correct: boolean }[] = []
  for (const id of session.questionIds) {
    const q = questionMap.get(id)
    const seconds = session.timePerQuestion?.[id] ?? 0
    if (!q || seconds <= 0) continue
    timed.push({ question: q, seconds, correct: isCorrect(q, session.responses[id]) })
  }
  if (timed.length === 0) return null

  const totalSeconds = timed.reduce((sum, t) => sum + t.seconds, 0)
  const mean = (list: typeof timed) =>
    list.length === 0 ? null : list.reduce((sum, t) => sum + t.seconds, 0) / list.length

  return {
    measured: timed.length,
    totalSeconds,
    averageSeconds: totalSeconds / timed.length,
    averageCorrect: mean(timed.filter((t) => t.correct)),
    averageIncorrect: mean(timed.filter((t) => !t.correct)),
    slowest: [...timed].sort((a, b) => b.seconds - a.seconds).slice(0, 5),
  }
}
