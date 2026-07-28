import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type {
  AnswerLetter,
  ExamSession,
  MarkReason,
  Question,
  QuestionMark,
  QuestionsData,
  TopicMeta,
} from '../types'
import { loadQuestions, questionImageUrl, AREA_LABELS } from '../lib/questions'
import { loadTopics, topicLabelMap } from '../lib/topics'
import { isCorrect, pacingSummary, scoreSession, targetSecondsPerQuestion } from '../lib/examLogic'
import { getMarks, getSession, saveMarks } from '../lib/storage'
import {
  REASON_HINTS,
  isOpen,
  markQuestion,
  resolveMark,
  suggestReason,
  unresolveMark,
} from '../lib/marks'
import ReasonChips from '../components/ReasonChips'
import TopicTags from '../components/TopicTags'
import ScratchPad from '../components/ScratchPad'
import { hasContent, loadScratch, type Scratch } from '../lib/scratch'
import { fetchScratch } from '../lib/scratchSync'
import {
  ALTERNATIVES_NOTE,
  MAX_AWAY_SECONDS,
  MAX_TAB_EXITS,
  summarizeAbsences,
} from '../lib/examRules'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`
}

/** Tempo curto no formato "3min26s", que e como se pensa em ritmo de prova. */
function formatPace(seconds: number): string {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const rest = s % 60
  return m > 0 ? `${m}min${String(rest).padStart(2, '0')}s` : `${rest}s`
}

interface TriageCardProps {
  question: Question
  mark: QuestionMark
  response: AnswerLetter | undefined
  correct: boolean
  secondsSpent: number
  onReason: (reason: MarkReason) => void
  onNote: (note: string) => void
  onResolve: () => void
}

/** Uma questao na triagem. O trabalho aqui e curto de proposito -- um clique
 * para confirmar a razao, um campo opcional para a anotacao -- porque triagem
 * longa nao se faz, e marca sem triagem nao serve para estudar depois. */
function TriageCard({
  question,
  mark,
  response,
  correct,
  secondsSpent,
  onReason,
  onNote,
  onResolve,
}: TriageCardProps) {
  const [note, setNote] = useState(mark.note)

  return (
    <li className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <div className="flex gap-3">
        <details className="shrink-0">
          <summary className="cursor-pointer list-none">
            <img
              src={questionImageUrl(question.image)}
              alt={`Questao ${question.number}`}
              className="w-24 h-16 object-cover object-top rounded border border-gray-200 dark:border-gray-800"
            />
            <span className="text-[10px] text-indigo-600 block text-center mt-0.5">ver questao</span>
          </summary>
          <img
            src={questionImageUrl(question.image)}
            alt={`Questao ${question.number}`}
            className="mt-2 w-full max-w-2xl rounded border border-gray-200 dark:border-gray-800"
          />
        </details>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm mb-2">
            <span className="text-gray-500">
              {question.year} · Q{question.number}
            </span>
            <span className={correct ? 'text-green-600' : 'text-red-600'}>
              {question.annulled
                ? 'Anulada'
                : `Voce: ${response ?? '—'} · Gabarito: ${question.answer}`}
            </span>
            {secondsSpent > 0 && (
              <span className="text-gray-400 tabular-nums">{formatPace(secondsSpent)}</span>
            )}
            {mark.timesMarked > 1 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                title="Voce ja tinha marcado e dado esta questao por resolvida antes"
              >
                {mark.timesMarked}ª vez
              </span>
            )}
          </div>

          <ReasonChips value={mark.reason} onChange={onReason} />
          <p className="text-xs text-gray-500 mt-2">{REASON_HINTS[mark.reason]}</p>

          <textarea
            className="w-full mt-2 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-transparent"
            rows={2}
            placeholder="O que faltou? (opcional, mas e o que voce vai querer ler daqui a um mes)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            /* grava ao sair do campo, e nao a cada tecla: cada gravacao
               reserializa o historico e agenda um envio para a nuvem */
            onBlur={() => {
              if (note !== mark.note) onNote(note)
            }}
          />

          <div className="mt-2">
            <button className="text-xs text-gray-500 underline" onClick={onResolve}>
              Entendi, tirar do caderno
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function Results() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [session, setSession] = useState<ExamSession | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [topicMeta, setTopicMeta] = useState<Map<string, TopicMeta>>(new Map())
  const [scratchMap, setScratchMap] = useState<Record<string, Scratch>>({})
  const [marks, setMarks] = useState<Record<string, QuestionMark>>({})
  const seededFor = useRef<string | null>(null)

  useEffect(() => {
    loadQuestions().then(setData)
    loadTopics().then((t) => setTopicMeta(topicLabelMap(t.topics)))
    if (sessionId) {
      setSession(getSession(sessionId) ?? null)
      setMarks(getMarks())
      setScratchMap(loadScratch(sessionId))
      // Revisar no computador a prova feita no celular tem que mostrar as
      // contas que foram rascunhadas la.
      void fetchScratch(sessionId).then((remote) => {
        if (remote) setScratchMap((prev) => (Object.keys(prev).length > 0 ? prev : remote))
      })
    }
  }, [sessionId])

  const questionMap = useMemo(() => {
    if (!data) return new Map<string, Question>()
    return new Map(data.questions.map((q) => [q.id, q]))
  }, [data])

  /** Acertos por tema principal nesta prova. Saber que voce perdeu 4 de 5 em
   * "Grafos" e mais acionavel do que saber que foi mal em "Fundamentos". */
  const byTopic = useMemo(() => {
    if (!session) return []
    const acc = new Map<string, { correct: number; total: number }>()
    for (const id of session.questionIds) {
      const q = questionMap.get(id)
      if (!q || q.topics.length === 0) continue
      const slug = q.topics[0]
      const entry = acc.get(slug) ?? { correct: 0, total: 0 }
      entry.total += 1
      if (isCorrect(q, session.responses[id])) entry.correct += 1
      acc.set(slug, entry)
    }
    return [...acc.entries()]
      .map(([slug, v]) => ({ slug, ...v, rate: v.correct / v.total }))
      .sort((a, b) => a.rate - b.rate || b.total - a.total)
  }, [session, questionMap])

  const pacing = useMemo(
    () => (session ? pacingSummary(session, questionMap) : null),
    [session, questionMap],
  )

  /* Toda estrela que sobreviveu ao envio vira marca no instante em que o
     resultado abre, ja com a razao provavel escolhida. Esperar a confirmacao do
     usuario para so entao gravar perderia justamente as questoes de quem fechou
     a aba -- que sao quase todas. A triagem abaixo entao ajusta ou desfaz, e
     isso e trabalho de um clique. */
  useEffect(() => {
    if (!data || !session || seededFor.current === session.id) return
    seededFor.current = session.id
    const stored = getMarks()
    const finishedAt = session.finishedAt ?? Date.now()
    const reference = targetSecondsPerQuestion(session) ?? pacing?.averageSeconds ?? null
    const seeded: QuestionMark[] = []

    for (const id of session.questionIds) {
      const q = questionMap.get(id)
      if (!q || !session.flagged[id]) continue
      const prev = stored[id]
      // marca ja aberta fica como esta; resolvida antes desta prova e
      // reincidencia, e volta com o contador somando. Resolvida depois do fim
      // da prova e a triagem desta tela: nao ressuscitar.
      if (prev && (prev.resolvedAt === null || prev.updatedAt >= finishedAt)) continue
      seeded.push(
        markQuestion(
          prev,
          {
            questionId: id,
            sessionId: session.id,
            reason: suggestReason(
              isCorrect(q, session.responses[id]),
              session.timePerQuestion?.[id] ?? 0,
              reference,
            ),
          },
          finishedAt,
        ),
      )
    }

    if (seeded.length > 0) saveMarks(seeded)
    setMarks(getMarks())
  }, [data, session, questionMap, pacing])

  /** Altera uma marca ja existente. Editar nunca soma no contador de
   * reincidencia: trocar a razao e a mesma marca, nao uma nova. */
  function editMark(questionId: string, changes: { reason?: MarkReason; note?: string }) {
    const prev = marks[questionId]
    if (!prev) return
    const next = markQuestion(
      { ...prev, resolvedAt: null },
      {
        questionId,
        sessionId: prev.sessionId,
        reason: changes.reason ?? prev.reason,
        note: changes.note ?? prev.note,
      },
      Date.now(),
    )
    saveMarks([next])
    setMarks((m) => ({ ...m, [questionId]: next }))
  }

  /** Marca uma questao que nao tinha estrela. Rever o gabarito e o segundo
   * momento em que se descobre que nao entendeu -- e o primeiro para quem
   * respondeu com confianca e errou mesmo assim. */
  function addMark(questionId: string) {
    const q = questionMap.get(questionId)
    if (!q || !session) return
    const reference = targetSecondsPerQuestion(session) ?? pacing?.averageSeconds ?? null
    const next = markQuestion(
      marks[questionId],
      {
        questionId,
        sessionId: session.id,
        reason: suggestReason(
          isCorrect(q, session.responses[questionId]),
          session.timePerQuestion?.[questionId] ?? 0,
          reference,
        ),
      },
      Date.now(),
    )
    saveMarks([next])
    setMarks((m) => ({ ...m, [questionId]: next }))
  }

  function toggleResolved(questionId: string) {
    const prev = marks[questionId]
    if (!prev) return
    const now = Date.now()
    const next = prev.resolvedAt === null ? resolveMark(prev, now) : unresolveMark(prev, now)
    saveMarks([next])
    setMarks((m) => ({ ...m, [questionId]: next }))
  }

  if (!data || !session) return <p>Carregando...</p>

  /* Entra na triagem o que voce marcou nesta prova e o que ja estava no caderno
     e reapareceu aqui -- e assim que refazer as marcadas fecha o ciclo em vez
     de deixar a marca aberta para sempre. */
  const triage = session.questionIds
    .map((id) => ({ id, question: questionMap.get(id), mark: marks[id] }))
    .filter(
      (item): item is { id: string; question: Question; mark: QuestionMark } =>
        !!item.question && !!item.mark && (!!session.flagged[item.id] || isOpen(item.mark)),
    )
  const stillOpen = triage.filter((t) => t.mark.resolvedAt === null).length

  const summary = scoreSession(session, questionMap)
  const pct = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0
  const weakest = byTopic.filter((t) => t.rate < 1)
  const target = targetSecondsPerQuestion(session)
  const away = summarizeAbsences(session.absences)

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
        <h1 className="text-2xl font-semibold mb-1">{session.label}</h1>
        <p className="text-sm text-gray-500 mb-4">Tempo: {formatDuration(session.elapsedSeconds)}</p>
        <div className="text-5xl font-bold text-indigo-600">{pct}%</div>
        <p className="text-gray-500 mt-1">
          {summary.correct} de {summary.total} corretas · {summary.blank} em branco
        </p>
        <p className="text-xs text-gray-400 mt-3 max-w-xl mx-auto">{ALTERNATIVES_NOTE}</p>
      </section>

      {/* A triagem vem antes de qualquer analise: e o unico momento em que voce
          ainda lembra por que marcou cada questao. Um dia depois, a estrela ja
          nao quer dizer nada. */}
      {triage.length > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-indigo-300 dark:border-indigo-800 rounded-lg p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h2 className="font-semibold">
              Triagem — {triage.length} {triage.length === 1 ? 'questao marcada' : 'questoes marcadas'}
            </h2>
            <Link to="/marcadas" className="text-sm text-indigo-600 underline">
              Abrir caderno de revisao
            </Link>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Ja estao guardadas no caderno com a razao mais provavel. Confirme ou troque enquanto
            lembra — e a razao que decide o que fazer com cada uma depois.
          </p>
          <ul className="space-y-3">
            {triage.map(({ id, question, mark }) =>
              mark.resolvedAt !== null ? (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 text-sm border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-gray-400"
                >
                  <span>
                    {question.year} · Q{question.number} — fora do caderno
                  </span>
                  <button className="text-xs underline" onClick={() => toggleResolved(id)}>
                    Desfazer
                  </button>
                </li>
              ) : (
                <TriageCard
                  key={id}
                  question={question}
                  mark={mark}
                  response={session.responses[id]}
                  correct={isCorrect(question, session.responses[id])}
                  secondsSpent={session.timePerQuestion?.[id] ?? 0}
                  onReason={(reason) => editMark(id, { reason })}
                  onNote={(note) => editMark(id, { note })}
                  onResolve={() => toggleResolved(id)}
                />
              ),
            )}
          </ul>
          {stillOpen > 0 && (
            <p className="text-xs text-gray-400 mt-3">
              Acerto marcado nao conta como acerto na agenda de revisao: o tema volta cedo, como se
              voce tivesse errado. Chutar certo pontua hoje e some na prova.
            </p>
          )}
        </section>
      )}

      {away.count > 0 && (
        <section
          className={`rounded-lg p-4 border ${
            away.wouldBeFlagged
              ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
          }`}
        >
          <h2 className="font-semibold mb-1">Saidas da aba</h2>
          <p className="text-sm">
            {away.count} {away.count === 1 ? 'saida' : 'saidas'} durante a prova, a mais longa de{' '}
            {away.longestSeconds}s
            {away.overLimit > 0 && ` (${away.overLimit} acima de ${MAX_AWAY_SECONDS}s)`}.{' '}
            {away.wouldBeFlagged ? (
              <>
                Esse padrao ja seria infracao na prova real, que permite no maximo{' '}
                {MAX_AWAY_SECONDS}s fora ou {MAX_TAB_EXITS} saidas — e a punicao e eliminacao, nao
                desconto.
              </>
            ) : (
              <>
                Ainda dentro do que a prova real tolera ({MAX_AWAY_SECONDS}s fora, {MAX_TAB_EXITS}{' '}
                saidas), mas o habito custa caro la.
              </>
            )}
          </p>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Desempenho por area</h2>
        <div className="space-y-2">
          {Object.entries(summary.byArea).map(([area, s]) => (
            <div key={area} className="flex items-center gap-3">
              <span className="w-56 text-sm">{AREA_LABELS[area] ?? area}</span>
              <div className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-indigo-600 h-3"
                  style={{ width: `${s.total > 0 ? (s.correct / s.total) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-16 text-right">
                {s.correct}/{s.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      {pacing && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold mb-1">Ritmo</h2>
          <p className="text-sm text-gray-500 mb-4">
            {target !== null ? (
              <>
                Voce gastou <strong>{formatPace(pacing.averageSeconds)}</strong> por questao, contra{' '}
                <strong>{formatPace(target)}</strong> disponiveis por questao neste formato.
              </>
            ) : (
              <>
                Voce gastou <strong>{formatPace(pacing.averageSeconds)}</strong> por questao. Sem
                limite de tempo nesta sessao, entao nao ha ritmo alvo a comparar.
              </>
            )}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
            <div className="border border-gray-200 dark:border-gray-800 rounded p-3">
              <div className="text-xs text-gray-500">Media</div>
              <div className="font-semibold">{formatPace(pacing.averageSeconds)}</div>
            </div>
            <div className="border border-gray-200 dark:border-gray-800 rounded p-3">
              <div className="text-xs text-gray-500">Nas que acertou</div>
              <div className="font-semibold">
                {pacing.averageCorrect !== null ? formatPace(pacing.averageCorrect) : '—'}
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-800 rounded p-3">
              <div className="text-xs text-gray-500">Nas que errou</div>
              <div className="font-semibold">
                {pacing.averageIncorrect !== null ? formatPace(pacing.averageIncorrect) : '—'}
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-800 rounded p-3">
              <div className="text-xs text-gray-500">Tempo medido</div>
              <div className="font-semibold">{formatDuration(pacing.totalSeconds)}</div>
            </div>
          </div>

          {/* o padrao que vale ouro: se as erradas consomem mais tempo que as
              certas, o problema nao e conteudo, e saber a hora de desistir.
              So vale avisar quando a diferenca e grande em minutos tambem:
              proporcao sozinha dispara com segundos de diferenca e vira ruido */}
          {pacing.averageCorrect !== null &&
            pacing.averageIncorrect !== null &&
            pacing.averageIncorrect > pacing.averageCorrect * 1.2 &&
            pacing.averageIncorrect - pacing.averageCorrect >= 60 && (
              <p className="text-sm bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded p-3 mb-4">
                Voce gastou{' '}
                {Math.round((pacing.averageIncorrect / pacing.averageCorrect - 1) * 100)}% mais
                tempo nas questoes que errou do que nas que acertou. Esse tempo saiu de questoes
                que voce resolveria — treine abandonar mais cedo e voltar depois.
              </p>
            )}

          <h3 className="text-sm font-medium mb-2">Questoes mais demoradas</h3>
          <ul className="space-y-1.5">
            {pacing.slowest.map(({ question, seconds, correct }) => (
              <li key={question.id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-gray-500">
                  {question.year} · Q{question.number}
                </span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-sm h-4 overflow-hidden">
                  <div
                    className={`h-4 rounded-sm ${correct ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width: `${(seconds / pacing.slowest[0].seconds) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums w-20 text-right text-gray-500">
                  {formatPace(seconds)}
                </span>
              </li>
            ))}
          </ul>
          {pacing.measured < session.questionIds.length && (
            <p className="text-xs text-gray-400 mt-3">
              {session.questionIds.length - pacing.measured} questoes sem tempo registrado (nunca
              abertas, ou respondidas antes do site passar a medir).
            </p>
          )}
        </section>
      )}

      {weakest.length > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold mb-1">Temas que custaram pontos</h2>
          <p className="text-sm text-gray-500 mb-3">
            Do pior para o melhor aproveitamento nesta prova.{' '}
            <Link to="/topicos" className="text-indigo-600 underline">
              Ver o quanto cada um cai no POSCOMP
            </Link>
            .
          </p>
          <ul className="space-y-2">
            {weakest.map((t) => (
              <li key={t.slug} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{topicMeta.get(t.slug)?.label ?? t.slug}</span>
                <div className="w-24 bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={t.rate < 0.5 ? 'bg-red-500 h-2' : 'bg-amber-500 h-2'}
                    style={{ width: `${t.rate * 100}%` }}
                  />
                </div>
                <span className="text-gray-500 w-12 text-right tabular-nums">
                  {t.correct}/{t.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-3">
        <button className="px-4 py-2 rounded bg-indigo-600 text-white text-sm" onClick={() => setShowReview((v) => !v)}>
          {showReview ? 'Ocultar revisao' : 'Revisar questoes'}
        </button>
        <Link to="/" className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm">
          Voltar ao inicio
        </Link>
      </div>

      {showReview && (
        <section className="space-y-4">
          {session.questionIds.map((id) => {
            const q = questionMap.get(id)
            if (!q) return null
            const resp = session.responses[id]
            const ok = isCorrect(q, resp)
            return (
              <div
                key={id}
                className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${
                  q.annulled
                    ? 'border-amber-400'
                    : ok
                      ? 'border-green-400'
                      : 'border-red-400'
                }`}
              >
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-500">
                    {q.year} · Q{q.number} · {AREA_LABELS[q.area]}
                  </span>
                  {q.annulled ? (
                    <span className="font-medium text-amber-600">ANULADA (conta como acerto)</span>
                  ) : (
                    <span className={`font-medium ${ok ? 'text-green-600' : 'text-red-600'}`}>
                      Sua resposta: {resp ?? '—'} · Gabarito: {q.answer}
                    </span>
                  )}
                </div>
                <img src={questionImageUrl(q.image)} alt={`Questao ${q.number}`} className="w-full rounded border border-gray-200 dark:border-gray-800" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <TopicTags slugs={q.topics} topics={topicMeta} linkToAnalysis={false} />
                  {isOpen(marks[id]) ? (
                    <span className="text-xs text-indigo-600 whitespace-nowrap">
                      ★ no caderno de revisao
                    </span>
                  ) : (
                    <button
                      className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 whitespace-nowrap"
                      onClick={() => addMark(id)}
                    >
                      ☆ Marcar para revisao
                    </button>
                  )}
                </div>
                {/* rever o proprio raciocinio ao lado do erro e o que mostra
                    onde ele comecou -- so o gabarito nao mostra */}
                {hasContent(scratchMap[id]) && (
                  <details className="mt-3">
                    <summary className="text-sm text-indigo-600 cursor-pointer">
                      Ver seu rascunho desta questao
                    </summary>
                    <div className="mt-2">
                      <ScratchPad
                        questionKey={id}
                        scratch={scratchMap[id]}
                        onChange={() => {}}
                        readOnly
                      />
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
