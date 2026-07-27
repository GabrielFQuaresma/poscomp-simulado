export type Area = 'matematica' | 'fundamentos' | 'tecnologia' | 'desconhecida'

export interface Question {
  id: string
  year: number
  number: number
  area: Area
  image: string
  answer: string | null
  annulled: boolean
  /** Topicos identificados pelo classificador do pipeline, do mais para o
   * menos provavel. Vazio quando nenhum topico foi reconhecido. */
  topics: string[]
}

export interface QuestionsData {
  generated_at: string
  years: number[]
  questions: Question[]
}

export interface TopicMeta {
  slug: string
  label: string
  area: Area
}

export interface TopicsData {
  generated_at: string
  topics: TopicMeta[]
}

export type ExamMode = 'year' | 'random' | 'area' | 'srs' | 'srs-topic' | 'topic'

export type AnswerLetter = 'A' | 'B' | 'C' | 'D' | 'E'

export type CorrectionMode = 'exam' | 'study'

export interface ExamSession {
  id: string
  mode: ExamMode
  label: string
  createdAt: number
  finishedAt: number | null
  correctionMode: CorrectionMode
  timeLimitSeconds: number | null
  questionIds: string[]
  responses: Record<string, AnswerLetter | undefined>
  flagged: Record<string, boolean>
  elapsedSeconds: number
  /** Segundos gastos em cada questao, acumulados enquanto ela esta na tela.
   * Sessoes salvas antes desse campo existir vem sem ele. */
  timePerQuestion: Record<string, number>
  /** Duracao em segundos de cada vez que a aba perdeu o foco durante um
   * simulado cronometrado. Na prova real isso e monitorado e pode eliminar. */
  absences: number[]
  /** Instante da ultima gravacao desta sessao. E o criterio de desempate da
   * sincronia: sem ele, uma prova em andamento so teria o createdAt, que nunca
   * muda, e a copia velha de outro dispositivo poderia sobrescrever a nova.
   * Ausente nas sessoes gravadas antes da sincronia existir. */
  updatedAt?: number
}

export interface QuestionAttemptRecord {
  questionId: string
  sessionId: string
  timestamp: number
  answer: AnswerLetter | null
  correct: boolean
  /** Tempo gasto nesta questao na sessao em que ela foi respondida. */
  secondsSpent: number
}

/** Agendamento SM-2, comum a questoes e a temas. */
export interface Scheduling {
  repetitions: number
  intervalDays: number
  easeFactor: number
  dueAt: number
  lastReviewedAt: number
}

export interface SrsState extends Scheduling {
  questionId: string
}

/** O tema e a unidade de revisao: e o tema que precisa voltar, e cada volta
 * deve trazer uma questao diferente. O SrsState por questao vira criterio de
 * desempate na hora de escolher qual questao do tema servir. */
export interface TopicSrsState extends Scheduling {
  topicSlug: string
  /** Acerto na ultima revisao do tema, para mostrar o historico ao usuario. */
  lastAccuracy: number
}

export interface AppData {
  version: 4
  sessions: ExamSession[]
  attempts: QuestionAttemptRecord[]
  srs: Record<string, SrsState>
  topicSrs: Record<string, TopicSrsState>
  /** Ids de sessoes apagadas, com o instante da exclusao. O merge e por id e
   * last-write-wins, entao sem esta marcacao uma prova apagada aqui voltaria
   * na proxima sincronia com um dispositivo que ainda a tivesse. */
  deletedSessions: Record<string, number>
}
