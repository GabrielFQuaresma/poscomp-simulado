import type { Question, QuestionsData } from '../types'

let cache: QuestionsData | null = null

export async function loadQuestions(): Promise<QuestionsData> {
  if (cache) return cache
  const res = await fetch(`${import.meta.env.BASE_URL}data/questions.json`)
  if (!res.ok) throw new Error(`Falha ao carregar questions.json: ${res.status}`)
  cache = (await res.json()) as QuestionsData
  return cache
}

export function questionImageUrl(image: string): string {
  return `${import.meta.env.BASE_URL}questions/${image.replace(/^questions\//, '')}`
}

export const AREA_LABELS: Record<string, string> = {
  matematica: 'Matematica',
  fundamentos: 'Fundamentos da Computacao',
  tecnologia: 'Tecnologia da Computacao',
  desconhecida: 'Desconhecida',
}

export function byYear(questions: Question[], year: number): Question[] {
  return questions
    .filter((q) => q.year === year)
    .sort((a, b) => a.number - b.number)
}

export function questionMap(questions: Question[]): Map<string, Question> {
  return new Map(questions.map((q) => [q.id, q]))
}
