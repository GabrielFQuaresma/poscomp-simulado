import type { Area, Question, QuestionAttemptRecord, TopicMeta, TopicsData } from '../types'

let cache: TopicsData | null = null

export async function loadTopics(): Promise<TopicsData> {
  if (cache) return cache
  const res = await fetch(`${import.meta.env.BASE_URL}data/topics.json`)
  if (!res.ok) throw new Error(`Falha ao carregar topics.json: ${res.status}`)
  cache = (await res.json()) as TopicsData
  return cache
}

/** Quantas provas recentes contam como "tendencia atual". O POSCOMP mudou de
 * banca e de ementa varias vezes; o que caiu nas ultimas provas prediz melhor
 * a proxima do que a media de 20 anos. */
export const RECENT_YEARS_WINDOW = 5

/** Questoes por prova. Usado para converter incidencia em "questoes por prova",
 * que e a unidade em que vale a pena pensar ao decidir o que estudar. */
export const QUESTIONS_PER_EXAM = 70

export interface TopicStats {
  meta: TopicMeta
  /** Questoes em que este e o topico principal. */
  primaryCount: number
  /** Questoes que tocam o topico, mesmo como assunto secundario. */
  totalCount: number
  /** Media de questoes por prova (considerando todas as provas). */
  perExam: number
  /** Media de questoes por prova nas ultimas RECENT_YEARS_WINDOW provas. */
  perExamRecent: number
  /** perExamRecent - perExam: positivo = o tema vem ganhando espaco. */
  trend: number
  countByYear: Map<number, number>
  answered: number
  correct: number
  /** null quando ainda nao houve tentativas suficientes para significar algo. */
  accuracy: number | null
  /** Questoes que voce tende a perder por prova neste topico. E o ganho
   * potencial de estudar o tema, e por isso a ordem de prioridade padrao. */
  priority: number
  /** true quando a prioridade e uma estimativa por falta de historico seu. */
  priorityIsEstimate: boolean
}

/** Abaixo disso a taxa de acerto e ruido estatistico, nao sinal. */
export const MIN_ATTEMPTS_FOR_ACCURACY = 4

/** Acerto assumido para topicos que voce ainda nao praticou. Nao usamos 0 (que
 * jogaria todo tema novo para o topo) nem a sua media geral (que esconderia
 * temas novos atras de temas onde voce ja e bom): 50% e o meio-termo que mantem
 * a incidencia como fator dominante enquanto falta historico. */
const ASSUMED_ACCURACY = 0.5

export interface TopicStatsInput {
  questions: Question[]
  topics: TopicMeta[]
  attempts: QuestionAttemptRecord[]
  years: number[]
}

/** Ultima tentativa de cada questao -- reforcar a mesma questao varias vezes
 * nao deve pesar mais do que praticar varias questoes do topico. */
function latestAttemptByQuestion(attempts: QuestionAttemptRecord[]): Map<string, QuestionAttemptRecord> {
  const latest = new Map<string, QuestionAttemptRecord>()
  for (const a of attempts) {
    const prev = latest.get(a.questionId)
    if (!prev || a.timestamp >= prev.timestamp) latest.set(a.questionId, a)
  }
  return latest
}

export function computeTopicStats({ questions, topics, attempts, years }: TopicStatsInput): TopicStats[] {
  const examCount = years.length || 1
  const recentYears = new Set([...years].sort((a, b) => b - a).slice(0, RECENT_YEARS_WINDOW))
  const recentExamCount = recentYears.size || 1
  const latest = latestAttemptByQuestion(attempts)

  return topics.map((meta) => {
    const countByYear = new Map<number, number>()
    let primaryCount = 0
    let totalCount = 0
    let recentPrimary = 0
    let answered = 0
    let correct = 0

    for (const q of questions) {
      if (!q.topics.includes(meta.slug)) continue
      totalCount += 1

      const attempt = latest.get(q.id)
      if (attempt && attempt.answer !== null) {
        answered += 1
        if (attempt.correct) correct += 1
      }

      if (q.topics[0] !== meta.slug) continue
      primaryCount += 1
      countByYear.set(q.year, (countByYear.get(q.year) ?? 0) + 1)
      if (recentYears.has(q.year)) recentPrimary += 1
    }

    const perExam = primaryCount / examCount
    const perExamRecent = recentPrimary / recentExamCount
    const accuracy = answered >= MIN_ATTEMPTS_FOR_ACCURACY ? correct / answered : null

    // pondera a incidencia recente junto com a historica: o passado distante
    // ainda informa, mas as ultimas provas contam o dobro
    const expected = (perExam + 2 * perExamRecent) / 3
    const missRate = accuracy ?? ASSUMED_ACCURACY

    return {
      meta,
      primaryCount,
      totalCount,
      perExam,
      perExamRecent,
      trend: perExamRecent - perExam,
      countByYear,
      answered,
      correct,
      accuracy,
      priority: expected * (1 - missRate),
      priorityIsEstimate: accuracy === null,
    }
  })
}

export interface UnclassifiedStats {
  count: number
  total: number
  coverage: number
}

export function unclassifiedStats(questions: Question[]): UnclassifiedStats {
  const count = questions.filter((q) => q.topics.length === 0).length
  const total = questions.length
  return { count, total, coverage: total === 0 ? 1 : (total - count) / total }
}

export const AREA_SHORT_LABELS: Record<Area, string> = {
  matematica: 'Matematica',
  fundamentos: 'Fundamentos',
  tecnologia: 'Tecnologia',
  desconhecida: '-',
}

export function topicLabelMap(topics: TopicMeta[]): Map<string, TopicMeta> {
  return new Map(topics.map((t) => [t.slug, t]))
}
