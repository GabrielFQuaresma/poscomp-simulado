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

export type ExamMode = 'year' | 'random' | 'area' | 'srs' | 'srs-topic' | 'topic' | 'marked'

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
  /** Estrela da prova: "volto nesta antes de entregar". E de proposito que ela
   * viva dentro da sessao e morra com ela -- e o gesto da prova real, feito com
   * um clique e sob o cronometro. O que sobrevive a prova e a marca de estudo
   * (`QuestionMark`), decidida com calma na triagem do resultado. */
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

/** Por que a questao ficou marcada. A razao e o que torna a marca util depois:
 * "chutei e acertei" e "errei e nao entendi" pedem estudos diferentes, e uma
 * lista sem esse rotulo vira so um monte de questoes que voce nao sabe por que
 * guardou. */
export type MarkReason = 'chute' | 'erro' | 'lento' | 'duvida'

/** Uma questao que ficou pendente na sua cabeca. Diferente da estrela da prova,
 * esta atravessa sessoes: e a unidade do caderno de revisao. */
export interface QuestionMark {
  questionId: string
  reason: MarkReason
  /** O que voce nao soube, nas suas palavras. Vazio e o caso comum; quando tem
   * texto, e a parte mais valiosa da marca, porque e o unico registro do
   * raciocinio que falhou. */
  note: string
  /** Sessao em que a marca nasceu. E por ela que se volta ao contexto: o
   * gabarito daquele dia, o tempo gasto e o rascunho da questao. */
  sessionId: string
  createdAt: number
  updatedAt: number
  /** Quando voce declarou que entendeu; null enquanto esta em aberto.
   * Desmarcar resolve em vez de apagar por dois motivos: sem o registro, a
   * sincronia traria a marca de volta do outro dispositivo (o merge e por id, e
   * ninguem propaga uma ausencia); e "esta questao ja me pegou tres vezes" e o
   * sinal mais forte que existe aqui, que apagar destruiria. */
  resolvedAt: number | null
  /** Quantas vezes esta questao foi marcada, contando as reincidencias. */
  timesMarked: number
}

export interface AppData {
  version: 5
  sessions: ExamSession[]
  attempts: QuestionAttemptRecord[]
  srs: Record<string, SrsState>
  topicSrs: Record<string, TopicSrsState>
  /** Caderno de revisao, indexado por questionId: uma marca por questao, viva
   * ou ja resolvida. */
  marks: Record<string, QuestionMark>
  /** Ids de sessoes apagadas, com o instante da exclusao. O merge e por id e
   * last-write-wins, entao sem esta marcacao uma prova apagada aqui voltaria
   * na proxima sincronia com um dispositivo que ainda a tivesse. */
  deletedSessions: Record<string, number>
}
