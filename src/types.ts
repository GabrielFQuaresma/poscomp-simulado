export type Area = 'matematica' | 'fundamentos' | 'tecnologia' | 'desconhecida'

export interface Question {
  id: string
  year: number
  number: number
  area: Area
  image: string
  answer: string | null
  annulled: boolean
}

export interface QuestionsData {
  generated_at: string
  years: number[]
  questions: Question[]
}

export type AnswerLetter = 'A' | 'B' | 'C' | 'D' | 'E'

export type ExamMode = 'year' | 'random' | 'area' | 'wrong'
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

export interface AppData {
  version: 1
  sessions: ExamSession[]
  attempts: QuestionAttemptRecord[]
}
