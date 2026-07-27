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

export type ExamMode = 'year' | 'random' | 'area' | 'srs' | 'topic'

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
}

export interface QuestionAttemptRecord {
  questionId: string
  sessionId: string
  timestamp: number
  answer: AnswerLetter | null
  correct: boolean
}

export interface SrsState {
  questionId: string
  repetitions: number
  intervalDays: number
  easeFactor: number
  dueAt: number
  lastReviewedAt: number
}

export interface AppData {
  version: 1
  sessions: ExamSession[]
  attempts: QuestionAttemptRecord[]
  srs: Record<string, SrsState>
}
