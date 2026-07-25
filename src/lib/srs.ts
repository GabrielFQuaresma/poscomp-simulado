import type { SrsState } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

/** SM-2 (algoritmo do Anki), simplificado para feedback binario certo/errado
 * em vez da nota 0-5 de autoavaliacao do SM-2 original. */
export function reviewSrs(prev: SrsState | undefined, correct: boolean, now: number, questionId: string): SrsState {
  const quality = correct ? 4 : 1
  let easeFactor = prev?.easeFactor ?? 2.5
  let repetitions = prev?.repetitions ?? 0
  let intervalDays: number

  if (quality < 3) {
    repetitions = 0
    intervalDays = 1
  } else {
    repetitions += 1
    if (repetitions === 1) intervalDays = 1
    else if (repetitions === 2) intervalDays = 6
    else intervalDays = Math.round((prev?.intervalDays ?? 1) * easeFactor)
  }

  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))

  return {
    questionId,
    repetitions,
    intervalDays,
    easeFactor,
    dueAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
  }
}

export function isDue(state: SrsState | undefined, now: number): boolean {
  return !!state && state.dueAt <= now
}
