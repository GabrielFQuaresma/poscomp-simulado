import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Question, QuestionsData } from '../types'
import { AREA_LABELS, loadQuestions, questionImageUrl } from '../lib/questions'
import { getAttempts, getFinishedSessions, getSrsMap } from '../lib/storage'
import { dueSrsQuestions, scoreSession } from '../lib/examLogic'

export default function Stats() {
  const [data, setData] = useState<QuestionsData | null>(null)

  useEffect(() => {
    loadQuestions().then(setData)
  }, [])

  const questionMap = useMemo(() => {
    if (!data) return new Map<string, Question>()
    return new Map(data.questions.map((q) => [q.id, q]))
  }, [data])

  const sessions = getFinishedSessions()
  const attempts = getAttempts()
  const srsMap = getSrsMap()
  const srsTracked = Object.keys(srsMap).length
  const srsDue = data ? dueSrsQuestions(data.questions, srsMap, Date.now()).length : 0

  if (!data) return <p>Carregando...</p>

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">Nenhuma prova finalizada ainda.</p>
        <Link to="/" className="text-indigo-600 font-medium">
          Comecar um simulado
        </Link>
      </div>
    )
  }

  // overall + per-area accuracy from latest attempt per question
  const lastByQuestion = new Map<string, boolean>()
  const wrongCount = new Map<string, number>()
  for (const a of [...attempts].sort((x, y) => x.timestamp - y.timestamp)) {
    lastByQuestion.set(a.questionId, a.correct)
    if (!a.correct) wrongCount.set(a.questionId, (wrongCount.get(a.questionId) ?? 0) + 1)
  }

  const byArea: Record<string, { correct: number; total: number }> = {}
  const byYear: Record<number, { correct: number; total: number }> = {}
  let overallCorrect = 0
  let overallTotal = 0
  for (const [qid, correct] of lastByQuestion) {
    const q = questionMap.get(qid)
    if (!q) continue
    overallTotal += 1
    if (correct) overallCorrect += 1
    byArea[q.area] ??= { correct: 0, total: 0 }
    byArea[q.area].total += 1
    if (correct) byArea[q.area].correct += 1
    byYear[q.year] ??= { correct: 0, total: 0 }
    byYear[q.year].total += 1
    if (correct) byYear[q.year].correct += 1
  }

  const mostWrong = Array.from(wrongCount.entries())
    .map(([qid, count]) => ({ q: questionMap.get(qid), count }))
    .filter((x) => x.q)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const evolution = sessions
    .slice()
    .reverse()
    .map((s) => {
      const summary = scoreSession(s, questionMap)
      return {
        date: new Date(s.finishedAt ?? s.createdAt).toLocaleDateString('pt-BR'),
        pct: summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0,
        label: s.label,
      }
    })

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
        <h2 className="text-sm text-gray-500 mb-1">Aproveitamento geral (ultima tentativa por questao)</h2>
        <div className="text-4xl font-bold text-indigo-600">
          {overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 0}%
        </div>
        <p className="text-gray-500 mt-1">
          {overallCorrect}/{overallTotal} questoes distintas respondidas
        </p>
      </section>

      {srsTracked > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold mb-1">Revisao espacada</h2>
            <p className="text-sm text-gray-500">
              {srsTracked} questoes na agenda de revisao · {srsDue} vencidas agora
            </p>
          </div>
          <Link to="/" className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-medium whitespace-nowrap">
            Ir revisar
          </Link>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Evolucao (nota por simulado)</h2>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={evolution} margin={{ left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => `${v}%`} labelFormatter={(_, p) => p?.[0]?.payload?.label} />
              <Line type="monotone" dataKey="pct" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Desempenho por area</h2>
        <div className="space-y-2">
          {Object.entries(byArea).map(([area, s]) => (
            <div key={area} className="flex items-center gap-3">
              <span className="w-56 text-sm">{AREA_LABELS[area] ?? area}</span>
              <div className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                <div className="bg-indigo-600 h-3" style={{ width: `${s.total > 0 ? (s.correct / s.total) * 100 : 0}%` }} />
              </div>
              <span className="text-sm text-gray-500 w-16 text-right">
                {s.correct}/{s.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Desempenho por ano de prova</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(byYear)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([year, s]) => (
              <div key={year} className="border border-gray-200 dark:border-gray-800 rounded p-3 text-center">
                <div className="text-xs text-gray-500">{year}</div>
                <div className="font-semibold">{s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0}%</div>
                <div className="text-xs text-gray-500">
                  {s.correct}/{s.total}
                </div>
              </div>
            ))}
        </div>
      </section>

      {mostWrong.length > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Questoes mais erradas</h2>
          <div className="flex flex-wrap gap-3">
            {mostWrong.map(({ q, count }) => (
              <div key={q!.id} className="w-40">
                <img src={questionImageUrl(q!.image)} alt={q!.id} className="rounded border border-gray-200 dark:border-gray-800 w-full h-24 object-cover object-top" />
                <div className="text-xs text-gray-500 mt-1">
                  {q!.year} Q{q!.number} — errada {count}x
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Historico de simulados</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2">Data</th>
              <th>Modo</th>
              <th>Nota</th>
              <th>Duracao</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const summary = scoreSession(s, questionMap)
              const pct = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0
              const h = Math.floor(s.elapsedSeconds / 3600)
              const m = Math.floor((s.elapsedSeconds % 3600) / 60)
              return (
                <tr key={s.id} className="border-b border-gray-100 dark:border-gray-900">
                  <td className="py-2">{new Date(s.finishedAt ?? s.createdAt).toLocaleString('pt-BR')}</td>
                  <td>{s.label}</td>
                  <td>
                    <Link to={`/results/${s.id}`} className="text-indigo-600 font-medium">
                      {pct}%
                    </Link>
                  </td>
                  <td>
                    {h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
