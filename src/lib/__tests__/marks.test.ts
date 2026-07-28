import { describe, expect, it } from 'vitest'
import type { QuestionMark } from '../../types'
import {
  countByReason,
  isOpen,
  markQuestion,
  openMarks,
  resolveMark,
  suggestReason,
  unresolveMark,
} from '../marks'
import { qualityFromOutcome, schedule } from '../srs'

function mark(over: Partial<QuestionMark> = {}): QuestionMark {
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

describe('suggestReason', () => {
  it('trata erro como erro, por mais rapido que tenha sido', () => {
    expect(suggestReason(false, 10, 200)).toBe('erro')
  })

  it('chama de lentidao o acerto que custou o dobro do ritmo alvo', () => {
    expect(suggestReason(true, 500, 200)).toBe('lento')
  })

  it('chama de chute o acerto marcado que veio dentro do tempo', () => {
    // marcou e ainda assim respondeu rapido: a resposta nao veio de convicao
    expect(suggestReason(true, 100, 200)).toBe('chute')
  })

  it('nao inventa lentidao quando a sessao nao tem tempo de referencia', () => {
    expect(suggestReason(true, 9999, null)).toBe('chute')
  })
})

describe('markQuestion', () => {
  it('comeca a contagem em 1 na primeira marcacao', () => {
    const m = markQuestion(undefined, { questionId: 'q1', sessionId: 's1', reason: 'chute' }, 5000)
    expect(m.timesMarked).toBe(1)
    expect(m.createdAt).toBe(5000)
    expect(m.resolvedAt).toBeNull()
  })

  it('nao soma na contagem quando so troca a razao de uma marca aberta', () => {
    const antes = mark({ reason: 'chute', timesMarked: 1 })
    const depois = markQuestion(antes, { questionId: 'q1', sessionId: 's1', reason: 'erro' }, 7000)
    expect(depois.timesMarked).toBe(1)
    expect(depois.reason).toBe('erro')
    // a data de nascimento e o que mede ha quanto tempo a duvida existe
    expect(depois.createdAt).toBe(1000)
  })

  it('soma na contagem quando a questao volta depois de resolvida', () => {
    const resolvida = mark({ resolvedAt: 4000, timesMarked: 1 })
    const devolta = markQuestion(resolvida, { questionId: 'q1', sessionId: 's2', reason: 'erro' }, 9000)
    expect(devolta.timesMarked).toBe(2)
    expect(devolta.resolvedAt).toBeNull()
  })

  it('preserva a anotacao quando a edicao nao mexe nela', () => {
    const comNota = mark({ note: 'esqueci o criterio do teorema mestre' })
    const depois = markQuestion(comNota, { questionId: 'q1', sessionId: 's1', reason: 'duvida' }, 7000)
    expect(depois.note).toBe('esqueci o criterio do teorema mestre')
  })
})

describe('resolver e desfazer', () => {
  it('desfazer nao infla o contador de reincidencia', () => {
    // clique errado nao e duvida que voltou: se contasse, o numero que aponta
    // as questoes cronicas perderia o sentido
    const resolvida = resolveMark(mark({ timesMarked: 1 }), 5000)
    const desfeita = unresolveMark(resolvida, 6000)
    expect(desfeita.timesMarked).toBe(1)
    expect(isOpen(desfeita)).toBe(true)
  })

  it('tira a resolvida da lista de abertas, sem apagar o registro', () => {
    const marks = {
      q1: mark({ questionId: 'q1', createdAt: 2000 }),
      q2: resolveMark(mark({ questionId: 'q2', createdAt: 1000 }), 5000),
    }
    expect(openMarks(marks).map((m) => m.questionId)).toEqual(['q1'])
    expect(Object.keys(marks)).toHaveLength(2)
  })

  it('lista as abertas da mais antiga para a mais nova', () => {
    const marks = {
      novo: mark({ questionId: 'novo', createdAt: 9000 }),
      velho: mark({ questionId: 'velho', createdAt: 100 }),
    }
    expect(openMarks(marks).map((m) => m.questionId)).toEqual(['velho', 'novo'])
  })
})

describe('countByReason', () => {
  it('conta cada razao e zera as ausentes', () => {
    expect(countByReason([mark({ reason: 'chute' }), mark({ reason: 'chute' })])).toEqual({
      chute: 2,
      erro: 0,
      lento: 0,
      duvida: 0,
    })
  })
})

describe('qualidade SM-2 com duvida declarada', () => {
  it('separa acerto confiante de acerto marcado', () => {
    expect(qualityFromOutcome(true, false)).toBe(4)
    expect(qualityFromOutcome(true, true)).toBe(3)
    expect(qualityFromOutcome(false, false)).toBe(1)
  })

  it('faz o acerto marcado voltar mais cedo do que o acerto confiante', () => {
    // as duas avancam (q >= 3), mas a marcada acumula menos facilidade, entao
    // da terceira repeticao em diante o intervalo dela e menor
    const now = 0
    let confiante = schedule(undefined, 4, now)
    let marcada = schedule(undefined, 3, now)
    for (let i = 0; i < 3; i++) {
      confiante = schedule(confiante, 4, now)
      marcada = schedule(marcada, 3, now)
    }
    expect(marcada.intervalDays).toBeLessThan(confiante.intervalDays)
  })

  it('erro zera as repeticoes e traz de volta em um dia', () => {
    const depoisDeAcertar = schedule(undefined, 4, 0)
    const depoisDeErrar = schedule(depoisDeAcertar, qualityFromOutcome(false, false), 0)
    expect(depoisDeErrar.repetitions).toBe(0)
    expect(depoisDeErrar.intervalDays).toBe(1)
  })
})
