import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AnswerLetter, ExamSession, Question, QuestionsData, TopicMeta } from '../types'
import { loadQuestions, questionImageUrl, AREA_LABELS } from '../lib/questions'
import { loadTopics, topicLabelMap } from '../lib/topics'
import { buildAttemptRecords, buildSrsUpdates, buildTopicSrsUpdates, isCorrect, paceDelta } from '../lib/examLogic'
import {
  addAttempts,
  getSession,
  getSrsMap,
  getTopicSrsMap,
  saveSrsStates,
  saveTopicSrsStates,
  upsertSession,
} from '../lib/storage'
import TopicTags from '../components/TopicTags'

const LETTERS: AnswerLetter[] = ['A', 'B', 'C', 'D', 'E']

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

function formatMinutes(seconds: number): string {
  const m = Math.round(Math.abs(seconds) / 60)
  return m < 1 ? 'menos de 1 min' : `${m} min`
}

/** Abaixo disso o desvio e ruido de uma questao mais lenta, nao um problema de
 * ritmo -- avisar a cada oscilacao so ensinaria a ignorar o aviso. */
const PACE_TOLERANCE_SECONDS = 120

function PaceBadge({ delta }: { delta: number }) {
  const onTrack = Math.abs(delta) < PACE_TOLERANCE_SECONDS
  const behind = delta > 0
  return (
    <span
      className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
        onTrack
          ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          : behind
            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`}
      title="Comparacao entre o tempo ja gasto e o ritmo necessario para responder todas as questoes dentro do limite"
    >
      {onTrack ? 'no ritmo' : `${formatMinutes(delta)} ${behind ? 'atrasado' : 'adiantado'}`}
    </span>
  )
}

export default function Exam() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [topicMeta, setTopicMeta] = useState<Map<string, TopicMeta>>(new Map())
  const [session, setSession] = useState<ExamSession | null>(null)
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const elapsedRef = useRef(0)
  // interval callbacks close over stale `session` state, so we always read/write
  // through this ref to avoid clobbering responses saved between renders
  const sessionRef = useRef<ExamSession | null>(null)
  // segundos por questao, acumulados pelo tick de 1s na questao que esta na
  // tela. Fica fora do state pelo mesmo motivo do elapsed: o intervalo veria
  // um valor congelado no primeiro render.
  const timeRef = useRef<Record<string, number>>({})
  const currentIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    loadQuestions().then(setData)
    loadTopics().then((t) => setTopicMeta(topicLabelMap(t.topics)))
    const s = sessionId ? getSession(sessionId) : undefined
    if (s) {
      setSession(s)
      sessionRef.current = s
      elapsedRef.current = s.elapsedSeconds
      timeRef.current = { ...s.timePerQuestion }
    }
  }, [sessionId])

  useEffect(() => {
    currentIdRef.current = sessionRef.current?.questionIds[index]
  }, [index, session?.id])

  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!session || session.finishedAt) return
    const interval = setInterval(() => {
      elapsedRef.current += 1
      const onScreen = currentIdRef.current
      if (onScreen) timeRef.current[onScreen] = (timeRef.current[onScreen] ?? 0) + 1
      forceTick((t) => t + 1)
      if (elapsedRef.current % 5 === 0 && sessionRef.current) {
        persist({ ...sessionRef.current, elapsedSeconds: elapsedRef.current })
      }
      const limit = sessionRef.current?.timeLimitSeconds
      if (limit && elapsedRef.current >= limit) {
        finish()
      }
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.finishedAt])

  const questionMap = useMemo(() => {
    if (!data) return new Map<string, Question>()
    return new Map(data.questions.map((q) => [q.id, q]))
  }, [data])

  function persist(updated: ExamSession) {
    const withTime: ExamSession = { ...updated, timePerQuestion: { ...timeRef.current } }
    setSession(withTime)
    sessionRef.current = withTime
    upsertSession(withTime)
  }

  if (!data || !session) return <p>Carregando...</p>

  const questionId = session.questionIds[index]
  const question = questionMap.get(questionId)
  const response = session.responses[questionId]
  const flagged = !!session.flagged[questionId]

  function answer(letter: AnswerLetter) {
    if (!session || !question) return
    const updated: ExamSession = {
      ...session,
      responses: { ...session.responses, [questionId]: letter },
      elapsedSeconds: elapsedRef.current,
    }
    persist(updated)
    if (session.correctionMode === 'study') setShowAnswer(true)
  }

  function toggleFlag() {
    if (!session) return
    persist({ ...session, flagged: { ...session.flagged, [questionId]: !flagged }, elapsedSeconds: elapsedRef.current })
  }

  function goTo(i: number) {
    setIndex(i)
    setShowAnswer(session?.correctionMode === 'study' && !!session.responses[session.questionIds[i]])
  }

  function finish() {
    const latest = sessionRef.current
    if (!latest || !data) return
    const finished: ExamSession = {
      ...latest,
      finishedAt: Date.now(),
      elapsedSeconds: elapsedRef.current,
      timePerQuestion: { ...timeRef.current },
    }
    sessionRef.current = finished
    upsertSession(finished)
    const qmap = new Map(data.questions.map((q) => [q.id, q]))
    const now = Date.now()
    addAttempts(buildAttemptRecords(finished, qmap))
    saveSrsStates(buildSrsUpdates(finished, qmap, getSrsMap(), now))
    saveTopicSrsStates(buildTopicSrsUpdates(finished, qmap, getTopicSrsMap(), now))
    navigate(`/results/${finished.id}`)
  }

  const remaining = session.timeLimitSeconds ? session.timeLimitSeconds - elapsedRef.current : null
  const answeredCount = Object.keys(session.responses).length
  const pace = paceDelta(session, elapsedRef.current, answeredCount)
  const onQuestionSeconds = timeRef.current[questionId] ?? 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-500">
            {session.label} — questao {index + 1} de {session.questionIds.length}
          </div>
          <div className="flex items-center gap-3">
            {pace !== null && answeredCount > 0 && <PaceBadge delta={pace} />}
            {remaining !== null ? (
              <span className={`font-mono text-sm ${remaining < 300 ? 'text-red-600' : ''}`}>{formatTime(remaining)}</span>
            ) : (
              <span className="font-mono text-sm text-gray-500">{formatTime(elapsedRef.current)}</span>
            )}
            <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={finish}>
              Finalizar prova
            </button>
          </div>
        </div>

        {question && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                {question.year} · {AREA_LABELS[question.area]}
                <span
                  className="ml-2 font-mono normal-case tracking-normal"
                  title="Tempo nesta questao"
                >
                  {formatTime(onQuestionSeconds)}
                </span>
              </span>
              <button
                className={`text-xs px-2 py-1 rounded border ${flagged ? 'bg-yellow-100 border-yellow-400 text-yellow-800' : 'border-gray-300 text-gray-500'}`}
                onClick={toggleFlag}
              >
                {flagged ? '★ Marcada para revisao' : '☆ Marcar para revisao'}
              </button>
            </div>
            <img
              src={questionImageUrl(question.image)}
              alt={`Questao ${question.number}`}
              className="w-full border border-gray-200 dark:border-gray-800 rounded mb-4"
            />
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {LETTERS.map((letter) => {
                const selected = response === letter
                const correct = showAnswer && question.answer === letter
                const wrong = showAnswer && selected && !correct && !question.annulled
                return (
                  <button
                    key={letter}
                    onClick={() => answer(letter)}
                    className={`py-3 rounded-lg border font-semibold text-lg transition-colors ${
                      correct
                        ? 'bg-green-100 border-green-500 text-green-800'
                        : wrong
                          ? 'bg-red-100 border-red-500 text-red-800'
                          : selected
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {letter}
                  </button>
                )
              })}
            </div>
            {showAnswer && question.annulled && (
              <p className="mt-3 text-sm text-amber-600 font-medium">Questao anulada — conta como acerto.</p>
            )}
            {showAnswer && !question.annulled && (
              <p className="mt-3 text-sm text-gray-500">
                {isCorrect(question, response) ? 'Voce acertou.' : `Voce errou. Gabarito: ${question.answer}`}
              </p>
            )}
            {/* so depois de corrigir: saber o tema de antemao entrega parte da
                resposta e tiraria o realismo do simulado */}
            {showAnswer && (
              <div className="mt-2">
                <TopicTags slugs={question.topics} topics={topicMeta} />
              </div>
            )}
            <div className="flex justify-between mt-4">
              <button
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
              >
                Anterior
              </button>
              <button
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40"
                disabled={index === session.questionIds.length - 1}
                onClick={() => goTo(index + 1)}
              >
                Proxima
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 h-fit">
        <div className="text-sm text-gray-500 mb-2">
          {answeredCount}/{session.questionIds.length} respondidas
        </div>
        <div className="grid grid-cols-6 lg:grid-cols-5 gap-1.5">
          {session.questionIds.map((id, i) => {
            const answered = !!session.responses[id]
            const isFlagged = !!session.flagged[id]
            const isCurrent = i === index
            return (
              <button
                key={id}
                onClick={() => goTo(i)}
                title={id}
                className={`aspect-square rounded text-xs font-medium flex items-center justify-center border ${
                  isCurrent
                    ? 'ring-2 ring-indigo-600'
                    : ''
                } ${
                  isFlagged
                    ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                    : answered
                      ? 'bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-700 dark:text-indigo-200'
                      : 'border-gray-300 dark:border-gray-700 text-gray-500'
                }`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
