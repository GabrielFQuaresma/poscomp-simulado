/** Regras da prova real, do Edital de Abertura nº 001/2026 do POSCOMP.
 * Ficam juntas aqui para que o simulado e os avisos da interface citem a mesma
 * fonte, em vez de espalhar numeros soltos pelas telas. */

/** Item 5.7.13.1: sair da aba por mais de 30s e infracao. */
export const MAX_AWAY_SECONDS = 30

/** Item 5.7.13.1: clicar fora da aba 3 vezes e infracao. */
export const MAX_TAB_EXITS = 3

/** Item 5.2: a partir de 2026 a prova tem 4 alternativas (A a D). Todas as
 * provas do banco, de 2002 a 2025, tem 5 (A a E). */
export const ALTERNATIVES_2026 = 4
export const ALTERNATIVES_LEGACY = 5

/** Nota que o chute puro renderia em cada formato: 20% contra 25%. Por isso a
 * porcentagem de um simulado feito com o banco antigo subestima levemente o
 * que o mesmo conhecimento renderia na prova nova. */
export const GUESS_RATE_LEGACY = 1 / ALTERNATIVES_LEGACY
export const GUESS_RATE_2026 = 1 / ALTERNATIVES_2026

export const ALTERNATIVES_NOTE =
  `A partir de 2026 a prova tem ${ALTERNATIVES_2026} alternativas (A a D); ` +
  `as provas de 2002 a 2025, que formam este banco, tem ${ALTERNATIVES_LEGACY}. ` +
  `Chutar acerta ${Math.round(GUESS_RATE_2026 * 100)}% la contra ` +
  `${Math.round(GUESS_RATE_LEGACY * 100)}% aqui, entao sua nota real tende a ser ` +
  `um pouco melhor que a daqui.`

export interface AbsenceSummary {
  count: number
  longestSeconds: number
  overLimit: number
  /** true quando o padrao ja bastaria para eliminar na prova real. */
  wouldBeFlagged: boolean
}

export function summarizeAbsences(absences: number[]): AbsenceSummary {
  const overLimit = absences.filter((s) => s > MAX_AWAY_SECONDS).length
  return {
    count: absences.length,
    longestSeconds: absences.length === 0 ? 0 : Math.max(...absences),
    overLimit,
    wouldBeFlagged: overLimit > 0 || absences.length >= MAX_TAB_EXITS,
  }
}
