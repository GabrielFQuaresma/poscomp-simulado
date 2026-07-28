import type { Scheduling, SrsState, TopicSrsState } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Quantas questoes uma sessao de revisao pode ter. Sem teto, o rebote de um
 * dia depois de dois simulados de 70 ja monta uma fila de 100+ que ninguem
 * comeca -- e uma fila que nao se comeca nao revisa nada. O Anki limita pelo
 * mesmo motivo. O que sobra continua vencido e aparece na proxima sessao. */
export const DAILY_REVIEW_LIMIT = 20

/** SM-2 (algoritmo do Anki). `quality` vai de 0 a 5, como no original;
 * abaixo de 3 o item recomeca do intervalo de 1 dia. */
export function schedule(prev: Scheduling | undefined, quality: number, now: number): Scheduling {
  const q = Math.max(0, Math.min(5, quality))
  const easeFactor = Math.max(1.3, (prev?.easeFactor ?? 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  let repetitions = prev?.repetitions ?? 0
  let intervalDays: number

  if (q < 3) {
    repetitions = 0
    intervalDays = 1
  } else {
    repetitions += 1
    if (repetitions === 1) intervalDays = 1
    else if (repetitions === 2) intervalDays = 6
    else intervalDays = Math.round((prev?.intervalDays ?? 1) * easeFactor)
  }

  return {
    repetitions,
    intervalDays,
    easeFactor,
    dueAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
  }
}

/** Traduz o resultado da questao para a escala do SM-2. A escala existe
 * justamente para graduar confianca, e a estrela da prova e a unica confissao
 * de duvida que temos: sem ela, chutar certo e saber a resposta produzem o
 * mesmo agendamento, e o item que voce nao domina volta daqui a seis dias como
 * se estivesse resolvido.
 *
 * 4 = acerto sem hesitacao declarada; 3 = acerto com dificuldade (ainda avanca,
 * mas com intervalo curto e ease menor); 1 = erro que ainda reconhece o item. */
export function qualityFromOutcome(correct: boolean, unsure: boolean): number {
  if (!correct) return 1
  return unsure ? 3 : 4
}

/** Acerto no tema traduzido para a escala do SM-2, com um prior de Laplace
 * (+1 acerto, +1 erro) para amortecer sessoes curtas: acertar a unica questao
 * do tema vira 2/3, nao 100%, e por isso nao dispara o intervalo la na frente.
 * O corte do SM-2 em 3 cai perto de 50% de acerto real. */
export function qualityFromAccuracy(correct: number, total: number): number {
  const damped = (correct + 1) / (total + 2)
  return Math.round(damped * 5)
}

export function reviewSrs(
  prev: SrsState | undefined,
  correct: boolean,
  now: number,
  questionId: string,
  unsure = false,
): SrsState {
  return { questionId, ...schedule(prev, qualityFromOutcome(correct, unsure), now) }
}

export function reviewTopicSrs(
  prev: TopicSrsState | undefined,
  correct: number,
  total: number,
  now: number,
  topicSlug: string,
): TopicSrsState {
  return {
    topicSlug,
    lastAccuracy: total > 0 ? correct / total : 0,
    ...schedule(prev, qualityFromAccuracy(correct, total), now),
  }
}

export function isDue(state: Scheduling | undefined, now: number): boolean {
  return !!state && state.dueAt <= now
}

/** Dias ate a proxima revisao, arredondado para cima. Negativo vira 0. */
export function daysUntilDue(state: Scheduling, now: number): number {
  return Math.max(0, Math.ceil((state.dueAt - now) / DAY_MS))
}
