import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, CorrectionMode, QuestionsData } from '../types'
import { loadQuestions, AREA_LABELS } from '../lib/questions'
import {
  buildAreaExam,
  buildRandomExam,
  buildWrongExam,
  buildYearExam,
} from '../lib/examLogic'
import {
  deleteSession,
  exportData,
  getInProgressSessions,
  importData,
  resetAll,
  upsertSession,
} from '../lib/storage'
import type { ExamSession } from '../types'

const FOUR_HOURS = 4 * 60 * 60

export default function Home() {
  const navigate = useNavigate()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inProgress, setInProgress] = useState<ExamSession[]>([])

  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>('exam')
  const [timerEnabled, setTimerEnabled] = useState(true)
  const [excludeAnnulled, setExcludeAnnulled] = useState(false)
  const [excludeAlreadyCorrect, setExcludeAlreadyCorrect] = useState(false)

  const [practiceAreas, setPracticeAreas] = useState<Area[]>(['matematica'])
  const [practiceCount, setPracticeCount] = useState(20)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  useEffect(() => {
    loadQuestions()
      .then(setData)
      .catch((e) => setError(String(e)))
    setInProgress(getInProgressSessions())
  }, [])

  function opts() {
    return {
      correctionMode,
      timeLimitSeconds: timerEnabled ? FOUR_HOURS : null,
    }
  }

  function startSession(session: ExamSession) {
    upsertSession(session)
    navigate(`/exam/${session.id}`)
  }

  function startYear(year: number) {
    if (!data) return
    startSession(buildYearExam(data.questions, year, opts()))
  }

  function startRandom() {
    if (!data) return
    startSession(
      buildRandomExam(data.questions, { excludeAnnulled, excludeAlreadyCorrect }, opts()),
    )
  }

  function startPractice() {
    if (!data) return
    startSession(
      buildAreaExam(
        data.questions,
        practiceAreas,
        practiceCount,
        { excludeAnnulled, excludeAlreadyCorrect },
        opts(),
      ),
    )
  }

  function startWrong() {
    if (!data) return
    startSession(buildWrongExam(data.questions, { ...opts(), timeLimitSeconds: null }))
  }

  function handleExport() {
    const json = exportData()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `poscomp-progresso-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((text) => {
      try {
        const result = importData(text)
        setImportMsg(`Importado: ${result.sessions} provas, ${result.attempts} respostas.`)
        setInProgress(getInProgressSessions())
      } catch (err) {
        setImportMsg(`Erro ao importar: ${String(err)}`)
      }
    })
    e.target.value = ''
  }

  function handleReset() {
    if (!confirm('Isso vai apagar todo o progresso salvo neste navegador. Continuar?')) return
    resetAll()
    setInProgress([])
    setImportMsg(null)
  }

  if (error) return <p className="text-red-600">Erro: {error}</p>
  if (!data) return <p>Carregando questoes...</p>

  return (
    <div className="space-y-8">
      {inProgress.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg p-4">
          <h2 className="font-semibold mb-2">Provas em andamento</h2>
          <ul className="space-y-2">
            {inProgress.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>
                  {s.label} — {Object.keys(s.responses).length}/{s.questionIds.length} respondidas
                </span>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 rounded bg-indigo-600 text-white text-sm"
                    onClick={() => navigate(`/exam/${s.id}`)}
                  >
                    Retomar
                  </button>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 text-sm"
                    onClick={() => {
                      deleteSession(s.id)
                      setInProgress(getInProgressSessions())
                    }}
                  >
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Configuracoes da prova</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <span>Modo de correcao:</span>
            <select
              className="border rounded px-2 py-1 dark:bg-gray-800"
              value={correctionMode}
              onChange={(e) => setCorrectionMode(e.target.value as CorrectionMode)}
            >
              <option value="exam">Prova (corrige ao final)</option>
              <option value="study">Estudo (corrige na hora)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={timerEnabled} onChange={(e) => setTimerEnabled(e.target.checked)} />
            Timer de 4h
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeAnnulled}
              onChange={(e) => setExcludeAnnulled(e.target.checked)}
            />
            Excluir anuladas do sorteio
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeAlreadyCorrect}
              onChange={(e) => setExcludeAlreadyCorrect(e.target.checked)}
            />
            Excluir ja respondidas corretamente
          </label>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Simulado aleatorio (70 questoes)</h2>
        <p className="text-sm text-gray-500 mb-3">20 Matematica + 30 Fundamentos + 20 Tecnologia, sorteadas de todos os anos.</p>
        <button className="px-4 py-2 rounded bg-indigo-600 text-white font-medium" onClick={startRandom}>
          Iniciar simulado padrao
        </button>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Pratica por area</h2>
        <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
          {(Object.keys(AREA_LABELS) as Area[])
            .filter((a) => a !== 'desconhecida')
            .map((area) => (
              <label key={area} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={practiceAreas.includes(area)}
                  onChange={(e) => {
                    setPracticeAreas((prev) =>
                      e.target.checked ? [...prev, area] : prev.filter((a) => a !== area),
                    )
                  }}
                />
                {AREA_LABELS[area]}
              </label>
            ))}
          <label className="flex items-center gap-2">
            Quantidade:
            <input
              type="number"
              min={1}
              max={100}
              className="border rounded px-2 py-1 w-20 dark:bg-gray-800"
              value={practiceCount}
              onChange={(e) => setPracticeCount(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          className="px-4 py-2 rounded bg-indigo-600 text-white font-medium disabled:opacity-50"
          disabled={practiceAreas.length === 0}
          onClick={startPractice}
        >
          Iniciar pratica
        </button>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Refazer erradas</h2>
        <button className="px-4 py-2 rounded bg-indigo-600 text-white font-medium" onClick={startWrong}>
          Refazer questoes que ja errei
        </button>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Prova por ano</h2>
        <div className="flex flex-wrap gap-2">
          {data.years.map((year) => (
            <button
              key={year}
              onClick={() => startYear(year)}
              className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-medium"
            >
              {year}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Progresso</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm" onClick={handleExport}>
            Exportar progresso (.json)
          </button>
          <button
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Importar progresso
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
          <button className="px-3 py-2 rounded border border-red-400 text-red-600 text-sm" onClick={handleReset}>
            Resetar tudo
          </button>
        </div>
        {importMsg && <p className="text-sm text-gray-500 mt-2">{importMsg}</p>}
      </section>
    </div>
  )
}
