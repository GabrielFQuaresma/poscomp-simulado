import { describe, expect, it } from 'vitest'
import type { ExamSession, Question, QuestionMark } from '../../types'
import { buildMarkedExam, buildSrsUpdates, buildTopicSrsUpdates } from '../examLogic'

function question(id: string, over: Partial<Question> = {}): Question {
  return {
    id,
    year: 2019,
    number: 1,
    area: 'matematica',
    image: `${id}.png`,
    answer: 'A',
    annulled: false,
    topics: ['grafos'],
    ...over,
  }
}

function session(over: Partial<ExamSession> = {}): ExamSession {
  return {
    id: 's1',
    mode: 'random',
    label: 'Simulado',
    createdAt: 1000,
    finishedAt: 2000,
    correctionMode: 'exam',
    timeLimitSeconds: null,
    questionIds: ['q1'],
    responses: { q1: 'A' },
    flagged: {},
    elapsedSeconds: 100,
    timePerQuestion: {},
    absences: [],
    updatedAt: 2000,
    ...over,
  }
}

function mark(questionId: string, over: Partial<QuestionMark> = {}): QuestionMark {
  return {
    questionId,
    reason: 'erro',
    note: '',
    sessionId: 's1',
    createdAt: 1000,
    updatedAt: 1000,
    resolvedAt: null,
    timesMarked: 1,
    ...over,
  }
}

const qmap = new Map([
  ['q1', question('q1')],
  ['q2', question('q2', { number: 2, topics: ['grafos'] })],
])

describe('a estrela da prova entra no agendamento', () => {
  it('agenda o acerto marcado mais cedo do que o acerto confiante', () => {
    const confiante = buildSrsUpdates(session(), qmap, {}, 0)[0]
    const marcada = buildSrsUpdates(session({ flagged: { q1: true } }), qmap, {}, 0)[0]

    // acertar chutando nao pode produzir o mesmo agendamento de quem sabia
    expect(marcada.easeFactor).toBeLessThan(confiante.easeFactor)
  })

  it('nao penaliza a questao cuja estrela foi retirada antes de entregar', () => {
    const semEstrela = buildSrsUpdates(session(), qmap, {}, 0)[0]
    const estrelaRetirada = buildSrsUpdates(session({ flagged: { q1: false } }), qmap, {}, 0)[0]
    expect(estrelaRetirada.easeFactor).toBe(semEstrela.easeFactor)
  })

  it('nao conta acerto marcado como acerto do tema', () => {
    const s = session({
      questionIds: ['q1', 'q2'],
      responses: { q1: 'A', q2: 'A' },
      flagged: { q2: true },
    })
    const [tema] = buildTopicSrsUpdates(s, qmap, {}, 0)

    // duas acertadas, uma delas no chute: 50% de acerto real no tema
    expect(tema.topicSlug).toBe('grafos')
    expect(tema.lastAccuracy).toBe(0.5)
  })

  it('ignora questao em branco, marcada ou nao', () => {
    const s = session({ responses: {}, flagged: { q1: true } })
    expect(buildSrsUpdates(s, qmap, {}, 0)).toEqual([])
  })
})

describe('buildMarkedExam', () => {
  it('traz as marcadas ha mais tempo primeiro', () => {
    const marks = {
      q2: mark('q2', { createdAt: 500 }),
      q1: mark('q1', { createdAt: 100 }),
    }
    const s = buildMarkedExam([question('q1'), question('q2')], marks, {
      correctionMode: 'study',
      timeLimitSeconds: null,
    })
    expect(s.questionIds).toEqual(['q1', 'q2'])
    expect(s.mode).toBe('marked')
  })

  it('deixa de fora o que ja foi resolvido', () => {
    const marks = { q1: mark('q1', { resolvedAt: 9000 }), q2: mark('q2') }
    const s = buildMarkedExam([question('q1'), question('q2')], marks, {
      correctionMode: 'study',
      timeLimitSeconds: null,
    })
    expect(s.questionIds).toEqual(['q2'])
  })

  it('respeita o teto diario e anuncia quantas ficaram de fora', () => {
    const questions = Array.from({ length: 5 }, (_, i) => question(`q${i}`))
    const marks = Object.fromEntries(questions.map((q, i) => [q.id, mark(q.id, { createdAt: i })]))
    const s = buildMarkedExam(
      questions,
      marks,
      { correctionMode: 'study', timeLimitSeconds: null },
      3,
    )
    expect(s.questionIds).toHaveLength(3)
    expect(s.label).toContain('de 5')
  })

  it('ignora marca de questao que nao existe mais no banco', () => {
    const s = buildMarkedExam([question('q1')], { fantasma: mark('fantasma') }, {
      correctionMode: 'study',
      timeLimitSeconds: null,
    })
    expect(s.questionIds).toEqual([])
  })
})
