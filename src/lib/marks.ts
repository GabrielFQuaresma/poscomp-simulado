import type { MarkReason, QuestionMark } from '../types'

export const MARK_REASONS: MarkReason[] = ['erro', 'chute', 'lento', 'duvida']

export const REASON_LABELS: Record<MarkReason, string> = {
  erro: 'Errei e nao entendi',
  chute: 'Chutei',
  lento: 'Acertei, mas demorei demais',
  duvida: 'Fiquei em duvida',
}

/** Rotulo curto para caber em etiqueta e filtro. */
export const REASON_SHORT: Record<MarkReason, string> = {
  erro: 'Erro',
  chute: 'Chute',
  lento: 'Lentidao',
  duvida: 'Duvida',
}

/** O que fazer com cada tipo de marca. E isto que separa um caderno de revisao
 * de uma lista de favoritos: sem o "e agora?", a marca so acumula. */
export const REASON_HINTS: Record<MarkReason, string> = {
  erro: 'Refaca a questao ate saber dizer onde seu raciocinio saiu do trilho. So conferir o gabarito nao mostra isso.',
  chute: 'O chute certo pontua hoje e some na prova. Trate como erro: estude o tema, nao a questao.',
  lento: 'O conteudo voce tem; falta caminho mais curto. Refaca cronometrando e compare com o tempo de antes.',
  duvida: 'Voce eliminou alternativas mas nao fechou. Ache o criterio que faltava — costuma ser uma definicao especifica.',
}

/** Acima de quantas vezes o tempo alvo uma questao acertada conta como lenta.
 * Duas vezes o ritmo da prova e onde o tempo ganho em outra questao acaba. */
const SLOW_FACTOR = 2

/** Palpite da razao a partir do que a prova ja registrou, para a triagem
 * comecar com a opcao provavel escolhida em vez de um formulario em branco --
 * o formulario em branco e onde a triagem morre. O usuario troca com um clique;
 * o palpite nunca decide sozinho. */
export function suggestReason(
  correct: boolean,
  secondsSpent: number,
  referenceSeconds: number | null,
): MarkReason {
  if (!correct) return 'erro'
  if (referenceSeconds !== null && secondsSpent > referenceSeconds * SLOW_FACTOR) return 'lento'
  // acertou dentro do tempo e ainda assim marcou: a leitura mais honesta e que
  // a resposta nao veio de convicao
  return 'chute'
}

export interface MarkInput {
  questionId: string
  sessionId: string
  reason: MarkReason
  note?: string
}

/** Cria ou atualiza a marca de uma questao. Marcar de novo algo que ja tinha
 * sido resolvido nao e um evento qualquer: e o contador que revela o assunto
 * que so parece resolvido. */
export function markQuestion(
  prev: QuestionMark | undefined,
  input: MarkInput,
  now: number,
): QuestionMark {
  const reincidencia = prev === undefined || prev.resolvedAt !== null
  return {
    questionId: input.questionId,
    sessionId: input.sessionId,
    reason: input.reason,
    note: input.note ?? prev?.note ?? '',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: null,
    timesMarked: (prev?.timesMarked ?? 0) + (reincidencia ? 1 : 0),
  }
}

export function resolveMark(mark: QuestionMark, now: number): QuestionMark {
  return { ...mark, resolvedAt: now, updatedAt: now }
}

/** Inverso exato de `resolveMark`, para o desfazer de quem clicou errado.
 * Difere de `markQuestion` num ponto que importa: nao soma no contador de
 * reincidencia, porque nao houve reincidencia nenhuma -- houve um clique. */
export function unresolveMark(mark: QuestionMark, now: number): QuestionMark {
  return { ...mark, resolvedAt: null, updatedAt: now }
}

export function isOpen(mark: QuestionMark | undefined): boolean {
  return mark !== undefined && mark.resolvedAt === null
}

/** Marcas em aberto, da mais antiga para a mais nova: o que esta esperando ha
 * mais tempo e o que voce mais provavelmente ja esqueceu de novo. */
export function openMarks(marks: Record<string, QuestionMark>): QuestionMark[] {
  return Object.values(marks)
    .filter((m) => m.resolvedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function countByReason(marks: QuestionMark[]): Record<MarkReason, number> {
  const counts: Record<MarkReason, number> = { erro: 0, chute: 0, lento: 0, duvida: 0 }
  for (const m of marks) counts[m.reason] += 1
  return counts
}
