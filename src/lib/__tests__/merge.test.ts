import { describe, expect, it } from 'vitest'
import type {
  AppData,
  ExamSession,
  QuestionAttemptRecord,
  QuestionMark,
  SrsState,
} from '../../types'
import { emptyData, mergeAppData } from '../merge'

function session(id: string, over: Partial<ExamSession> = {}): ExamSession {
  return {
    id,
    mode: 'random',
    label: `Prova ${id}`,
    createdAt: 1000,
    finishedAt: null,
    correctionMode: 'exam',
    timeLimitSeconds: null,
    questionIds: ['q1', 'q2'],
    responses: {},
    flagged: {},
    elapsedSeconds: 0,
    timePerQuestion: {},
    absences: [],
    updatedAt: 1000,
    ...over,
  }
}

function attempt(over: Partial<QuestionAttemptRecord> = {}): QuestionAttemptRecord {
  return {
    questionId: 'q1',
    sessionId: 's1',
    timestamp: 5000,
    answer: 'A',
    correct: true,
    secondsSpent: 30,
    ...over,
  }
}

function srs(questionId: string, lastReviewedAt: number): SrsState {
  return {
    questionId,
    repetitions: 1,
    intervalDays: 1,
    easeFactor: 2.5,
    dueAt: lastReviewedAt + 86400000,
    lastReviewedAt,
  }
}

function questionMark(over: Partial<QuestionMark> = {}): QuestionMark {
  return {
    questionId: 'q1',
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

function data(over: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...over }
}

describe('mergeAppData', () => {
  it('mantem as duas provas quando cada dispositivo terminou a sua offline', () => {
    const local = data({ sessions: [session('a', { finishedAt: 2000, updatedAt: 2000 })] })
    const remote = data({ sessions: [session('b', { finishedAt: 3000, updatedAt: 3000 })] })

    const ids = mergeAppData(local, remote)
      .sessions.map((s) => s.id)
      .sort()

    expect(ids).toEqual(['a', 'b'])
  })

  it('nao deixa a copia velha de uma prova em andamento vencer a nova', () => {
    // O mesmo simulado retomado no celular: la ele avancou, aqui ficou parado.
    // Sem updatedAt os dois teriam so o createdAt, empatariam, e a copia velha
    // do outro dispositivo apagaria as respostas mais recentes.
    const antiga = session('a', { responses: { q1: 'A' }, updatedAt: 1000 })
    const nova = session('a', { responses: { q1: 'A', q2: 'B' }, updatedAt: 9000 })

    expect(mergeAppData(data({ sessions: [nova] }), data({ sessions: [antiga] })).sessions[0]).toBe(
      nova,
    )
    expect(mergeAppData(data({ sessions: [antiga] }), data({ sessions: [nova] })).sessions[0]).toBe(
      nova,
    )
  })

  it('nao ressuscita prova apagada no outro dispositivo', () => {
    const apagouAqui = data({ deletedSessions: { a: 5000 } })
    const aindaTem = data({ sessions: [session('a')] })

    expect(mergeAppData(apagouAqui, aindaTem).sessions).toEqual([])
    expect(mergeAppData(aindaTem, apagouAqui).sessions).toEqual([])
  })

  it('propaga a marcacao de exclusao para o proximo merge', () => {
    const merged = mergeAppData(data({ deletedSessions: { a: 5000 } }), data({ sessions: [session('a')] }))
    // A marcacao tem que sobreviver: sem ela, o terceiro dispositivo que ainda
    // tiver a prova a traria de volta na sincronia seguinte.
    expect(merged.deletedSessions).toEqual({ a: 5000 })
  })

  it('preserva as respostas ja registradas de uma prova apagada', () => {
    // Apagar a prova nao apaga o fato de a questao ter sido respondida um dia:
    // e disso que vivem as estatisticas e a agenda de revisao.
    const merged = mergeAppData(
      data({ attempts: [attempt({ sessionId: 'a' })], deletedSessions: { a: 5000 } }),
      data({ sessions: [session('a')] }),
    )
    expect(merged.attempts).toHaveLength(1)
  })

  it('nao duplica a mesma resposta vinda dos dois lados', () => {
    const registro = attempt()
    const merged = mergeAppData(data({ attempts: [registro] }), data({ attempts: [{ ...registro }] }))
    expect(merged.attempts).toHaveLength(1)
  })

  it('junta respostas diferentes da mesma questao em sessoes diferentes', () => {
    const merged = mergeAppData(
      data({ attempts: [attempt({ sessionId: 's1', timestamp: 1 })] }),
      data({ attempts: [attempt({ sessionId: 's2', timestamp: 2 })] }),
    )
    expect(merged.attempts).toHaveLength(2)
  })

  it('mantem a revisao mais recente de cada questao', () => {
    const merged = mergeAppData(
      data({ srs: { q1: srs('q1', 9000), q2: srs('q2', 1000) } }),
      data({ srs: { q1: srs('q1', 2000), q3: srs('q3', 3000) } }),
    )
    expect(merged.srs.q1.lastReviewedAt).toBe(9000)
    expect(merged.srs.q2.lastReviewedAt).toBe(1000)
    expect(merged.srs.q3.lastReviewedAt).toBe(3000)
  })

  it('junta os cadernos de revisao dos dois dispositivos', () => {
    const merged = mergeAppData(
      data({ marks: { q1: questionMark({ questionId: 'q1' }) } }),
      data({ marks: { q2: questionMark({ questionId: 'q2' }) } }),
    )
    expect(Object.keys(merged.marks).sort()).toEqual(['q1', 'q2'])
  })

  it('deixa a decisao mais recente sobre a marca vencer, nos dois sentidos', () => {
    // Resolver e uma edicao, nao uma remocao: por isso a marca resolvida no
    // celular nao reaparece aberta ao sincronizar com o computador.
    const aberta = questionMark({ updatedAt: 2000, resolvedAt: null })
    const resolvida = questionMark({ updatedAt: 8000, resolvedAt: 8000 })

    expect(mergeAppData(data({ marks: { q1: aberta } }), data({ marks: { q1: resolvida } })).marks.q1.resolvedAt).toBe(8000)
    expect(mergeAppData(data({ marks: { q1: resolvida } }), data({ marks: { q1: aberta } })).marks.q1.resolvedAt).toBe(8000)
  })

  it('deixa a remarcacao posterior reabrir a marca resolvida antes', () => {
    const resolvida = questionMark({ updatedAt: 3000, resolvedAt: 3000, timesMarked: 1 })
    const remarcada = questionMark({ updatedAt: 9000, resolvedAt: null, timesMarked: 2 })

    const merged = mergeAppData(data({ marks: { q1: resolvida } }), data({ marks: { q1: remarcada } }))
    expect(merged.marks.q1.resolvedAt).toBeNull()
    expect(merged.marks.q1.timesMarked).toBe(2)
  })

  it('aceita dados gravados antes da sincronia existir', () => {
    // Formato v3: sem deletedSessions, sem updatedAt nas sessoes e sem caderno.
    const antigo = {
      version: 3,
      sessions: [{ ...session('a'), updatedAt: undefined, finishedAt: 4000 }],
      attempts: [{ ...attempt(), secondsSpent: undefined }],
      srs: {},
      topicSrs: {},
    } as unknown as AppData

    const merged = mergeAppData(antigo, emptyData())

    expect(merged.version).toBe(5)
    expect(merged.deletedSessions).toEqual({})
    expect(merged.marks).toEqual({})
    expect(merged.sessions[0].updatedAt).toBe(4000)
    expect(merged.attempts[0].secondsSpent).toBe(0)
  })

  it('e idempotente: mesclar o resultado de novo nao muda nada', () => {
    const local = data({
      sessions: [session('a', { finishedAt: 2000, updatedAt: 2000 })],
      attempts: [attempt({ sessionId: 'a' })],
      srs: { q1: srs('q1', 2000) },
      marks: { q1: questionMark() },
      deletedSessions: { z: 100 },
    })
    const remote = data({ sessions: [session('b', { finishedAt: 3000, updatedAt: 3000 })] })

    const once = mergeAppData(local, remote)
    const twice = mergeAppData(structuredClone(once), structuredClone(once))

    expect(twice).toEqual(once)
  })
})
