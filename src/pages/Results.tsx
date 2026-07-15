import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { ExamSession, Question, QuestionsData } from '../types'
import { loadQuestions, questionImageUrl, AREA_LABELS } from '../lib/questions'
import { isCorrect, scoreSession } from '../lib/examLogic'
import { getSession } from '../lib/storage'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`
}

export default function Results() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [session, setSession] = useState<ExamSession | null>(null)
  const [showReview, setShowReview] = useState(false)

  useEffect(() => {
    loadQuestions().then(setData)
    if (sessionId) setSession(getSession(sessionId) ?? null)
  }, [sessionId])

  const questionMap = useMemo(() => {
    if (!data) return new Map<string, Question>()
    return new Map(data.questions.map((q) => [q.id, q]))
  }, [data])

  if (!data || !session) return <p>Carregando...</p>

  const summary = scoreSession(session, questionMap)
  const pct = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
        <h1 className="text-2xl font-semibold mb-1">{session.label}</h1>
        <p className="text-sm text-gray-500 mb-4">Tempo: {formatDuration(session.elapsedSeconds)}</p>
        <div className="text-5xl font-bold text-indigo-600">{pct}%</div>
        <p className="text-gray-500 mt-1">
          {summary.correct} de {summary.total} corretas · {summary.blank} em branco
        </p>
      </section>

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
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
