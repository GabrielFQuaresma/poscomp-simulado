import type { AppData, ExamSession, QuestionAttemptRecord } from '../types'

export const DATA_VERSION = 5

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    sessions: [],
    attempts: [],
    srs: {},
    topicSrs: {},
    marks: {},
    deletedSessions: {},
  }
}

/** Preenche os campos que versoes anteriores nao gravavam. Nada e descartado:
 * o historico de quem ja usava o site continua valendo, so sem tempo por
 * questao (que ninguem media) e sem agenda de temas (que so passa a existir
 * conforme novas provas forem finalizadas). */
export function migrate(data: AppData): AppData {
  data.srs ??= {}
  data.topicSrs ??= {}
  data.marks ??= {}
  data.deletedSessions ??= {}
  for (const s of data.sessions) {
    s.timePerQuestion ??= {}
    s.absences ??= []
    // Sessoes gravadas antes da sincronia nao tem updatedAt. O melhor palpite
    // e quando ela terminou, ou quando comecou se ficou em andamento.
    s.updatedAt ??= s.finishedAt ?? s.createdAt
  }
  for (const a of data.attempts) a.secondsSpent ??= 0
  data.version = DATA_VERSION
  return data
}

/** Quando esta sessao mudou pela ultima vez. Sem isto o desempate de uma prova
 * em andamento seria pelo createdAt, que nunca muda -- duas maquinas com a
 * mesma prova aberta empatariam sempre, e a copia velha poderia vencer. */
function touchedAt(s: ExamSession): number {
  return s.updatedAt ?? s.finishedAt ?? s.createdAt
}

/** Uma tentativa e identificada pelo trio sessao/questao/instante: o mesmo
 * registro gravado nos dois dispositivos colapsa numa entrada so. */
function attemptKey(a: QuestionAttemptRecord): string {
  return `${a.sessionId}:${a.questionId}:${a.timestamp}`
}

/** Une dois estados do app resolvendo conflito por timestamp, campo a campo.
 * Nunca "o remoto vence" nem "o local vence": qualquer um dos dois descartaria
 * trabalho feito no outro dispositivo enquanto este estava offline.
 *
 * Em empate `incoming` vence, o que preserva o comportamento historico da
 * importacao manual de arquivo (onde o arquivo escolhido pelo usuario e a
 * intencao mais recente).
 *
 * Funcao pura de proposito: e a logica com risco real de perder dados, e sem
 * I/O ela pode ser testada sem rede nem navegador. */
export function mergeAppData(local: AppData, incoming: AppData): AppData {
  const a = migrate(local)
  const b = migrate(incoming)

  // Exclusoes primeiro: sao elas que decidem o que sobra das duas listas.
  // Sem isto, uma prova apagada no dispositivo A voltaria na proxima sincronia
  // com o B, que ainda a tem -- o merge por id sozinho nao propaga remocao.
  const deletedSessions: Record<string, number> = { ...a.deletedSessions }
  for (const [id, at] of Object.entries(b.deletedSessions)) {
    const current = deletedSessions[id]
    if (current === undefined || at > current) deletedSessions[id] = at
  }

  const sessionMap = new Map<string, ExamSession>()
  for (const s of a.sessions) sessionMap.set(s.id, s)
  for (const s of b.sessions) {
    const existing = sessionMap.get(s.id)
    if (!existing || touchedAt(s) >= touchedAt(existing)) sessionMap.set(s.id, s)
  }
  for (const id of Object.keys(deletedSessions)) sessionMap.delete(id)

  // As tentativas sobrevivem a exclusao da sessao, como ja acontece no
  // deleteSession local: o que se apaga e a prova, nao o fato de a questao ter
  // sido respondida um dia -- e disso que vivem as estatisticas e o SRS.
  const attemptMap = new Map<string, QuestionAttemptRecord>()
  for (const x of a.attempts) attemptMap.set(attemptKey(x), x)
  for (const x of b.attempts) attemptMap.set(attemptKey(x), x)

  const srs = { ...a.srs }
  for (const [questionId, state] of Object.entries(b.srs)) {
    const existing = srs[questionId]
    if (!existing || state.lastReviewedAt >= existing.lastReviewedAt) srs[questionId] = state
  }

  const topicSrs = { ...a.topicSrs }
  for (const [slug, state] of Object.entries(b.topicSrs)) {
    const existing = topicSrs[slug]
    if (!existing || state.lastReviewedAt >= existing.lastReviewedAt) topicSrs[slug] = state
  }

  // As marcas nao precisam de lapide como as sessoes: resolver e uma edicao,
  // nao uma remocao, entao a marca resolvida aqui vence a versao aberta que o
  // outro dispositivo ainda tem -- e vice-versa, se la ela foi remarcada depois.
  const marks = { ...a.marks }
  for (const [questionId, mark] of Object.entries(b.marks)) {
    const existing = marks[questionId]
    if (!existing || mark.updatedAt >= existing.updatedAt) marks[questionId] = mark
  }

  return {
    version: DATA_VERSION,
    sessions: Array.from(sessionMap.values()),
    attempts: Array.from(attemptMap.values()),
    srs,
    topicSrs,
    marks,
    deletedSessions,
  }
}
