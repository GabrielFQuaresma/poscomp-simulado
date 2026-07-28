import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, CorrectionMode, QuestionsData } from '../types'
import { loadQuestions, AREA_LABELS } from '../lib/questions'
import { loadTopics } from '../lib/topics'
import {
  buildAreaExam,
  buildMarkedExam,
  buildRandomExam,
  buildSrsExam,
  buildTopicSrsExam,
  buildYearExam,
  dueSrsQuestions,
  dueTopicSlugs,
} from '../lib/examLogic'
import { DAILY_REVIEW_LIMIT, daysUntilDue } from '../lib/srs'
import { ALTERNATIVES_NOTE } from '../lib/examRules'
import { MARK_REASONS, REASON_SHORT, countByReason, openMarks } from '../lib/marks'
import {
  deleteSession,
  exportData,
  getAttempts,
  getInProgressSessions,
  getMarks,
  getSrsMap,
  getTopicSrsMap,
  importData,
  resetAll,
  upsertSession,
} from '../lib/storage'
import type { ExamSession } from '../types'
import SyncPanel from '../components/SyncPanel'
import { useSyncState } from '../lib/useSync'

const FOUR_HOURS = 4 * 60 * 60

export default function Home() {
  const navigate = useNavigate()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inProgress, setInProgress] = useState<ExamSession[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [trackedCount, setTrackedCount] = useState(0)
  const [topicLabels, setTopicLabels] = useState<Map<string, string>>(new Map())
  const [dueTopics, setDueTopics] = useState<string[]>([])
  const [scheduledTopics, setScheduledTopics] = useState(0)
  const [nextTopicInDays, setNextTopicInDays] = useState<number | null>(null)
  const [markedCount, setMarkedCount] = useState(0)
  const [markedByReason, setMarkedByReason] = useState(countByReason([]))

  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>('exam')
  const [timerEnabled, setTimerEnabled] = useState(true)
  const [excludeAnnulled, setExcludeAnnulled] = useState(false)
  const [excludeAlreadyCorrect, setExcludeAlreadyCorrect] = useState(false)

  const [practiceAreas, setPracticeAreas] = useState<Area[]>(['matematica'])
  const [practiceCount, setPracticeCount] = useState(20)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const sync = useSyncState()

  useEffect(() => {
    Promise.all([loadQuestions(), loadTopics()])
      .then(([d, t]) => {
        setData(d)
        setTopicLabels(new Map(t.topics.map((x) => [x.slug, x.label])))
      })
      .catch((e) => setError(String(e)))
  }, [])

  /* Tudo que sai do progresso salvo e recalculado tambem quando a sincronia
     termina: sem isto, a prova finalizada no celular so apareceria aqui depois
     de recarregar a pagina na mao. */
  useEffect(() => {
    if (!data) return
    const now = Date.now()
    const srsMap = getSrsMap()
    setDueCount(dueSrsQuestions(data.questions, srsMap, now).length)
    setTrackedCount(Object.keys(srsMap).length)

    const topicMap = getTopicSrsMap()
    const scheduled = Object.values(topicMap)
    setScheduledTopics(scheduled.length)
    setDueTopics(dueTopicSlugs(topicMap, now).map((s) => s.topicSlug))
    const upcoming = scheduled.filter((s) => s.dueAt > now).sort((a, b) => a.dueAt - b.dueAt)[0]
    setNextTopicInDays(upcoming ? daysUntilDue(upcoming, now) : null)

    const open = openMarks(getMarks())
    setMarkedCount(open.length)
    setMarkedByReason(countByReason(open))

    setInProgress(getInProgressSessions())
  }, [data, sync.lastSyncedAt])

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
      buildRandomExam(data.questions, { excludeAnnulled, excludeAlreadyCorrect, attempts: getAttempts() }, opts()),
    )
  }

  function startPractice() {
    if (!data) return
    startSession(
      buildAreaExam(
        data.questions,
        practiceAreas,
        practiceCount,
        { excludeAnnulled, excludeAlreadyCorrect, attempts: getAttempts() },
        opts(),
      ),
    )
  }

  /** Revisao sempre corrige na hora e sem cronometro: o ponto e o feedback
   * imediato depois de tentar lembrar, nao simular a pressao da prova. */
  const reviewOpts = { correctionMode: 'study' as CorrectionMode, timeLimitSeconds: null }

  function startTopicReview() {
    if (!data) return
    startSession(
      buildTopicSrsExam(data.questions, getTopicSrsMap(), getAttempts(), topicLabels, reviewOpts),
    )
  }

  function startSrsReview() {
    if (!data) return
    startSession(buildSrsExam(data.questions, getSrsMap(), reviewOpts))
  }

  function startMarkedReview() {
    if (!data) return
    startSession(buildMarkedExam(data.questions, getMarks(), reviewOpts))
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
    const warning =
      sync.phase === 'idle' || sync.phase === 'syncing' || sync.phase === 'error'
        ? 'Isso vai apagar todo o progresso: neste navegador e na sua conta, ou seja, tambem nos outros dispositivos. Continuar?'
        : 'Isso vai apagar todo o progresso salvo neste navegador. Continuar?'
    if (!confirm(warning)) return
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
        <p className="text-xs text-gray-400 mt-3">{ALTERNATIVES_NOTE}</p>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Simulado aleatorio (70 questoes)</h2>
        <p className="text-sm text-gray-500 mb-3">20 Matematica + 30 Fundamentos + 20 Tecnologia, sorteadas de todos os anos.</p>
        <button className="px-4 py-2 rounded bg-indigo-600 text-white font-medium" onClick={startRandom}>
          Iniciar simulado padrao
        </button>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Pratica por tema</h2>
        <p className="text-sm text-gray-500 mb-3">
          Veja quanto cada tema caiu nas {data.years.length} provas ja aplicadas, cruzado com o seu
          desempenho, e treine os que mais valem pontos.
        </p>
        <button
          className="px-4 py-2 rounded bg-indigo-600 text-white font-medium"
          onClick={() => navigate('/topicos')}
        >
          Ver analise de temas
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

      {markedCount > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-indigo-300 dark:border-indigo-800 rounded-lg p-4">
          <h2 className="font-semibold mb-1">Caderno de revisao</h2>
          <p className="text-sm text-gray-500 mb-3">
            <strong>
              {markedCount} {markedCount === 1 ? 'questao marcada' : 'questoes marcadas'}
            </strong>{' '}
            esperando:{' '}
            {MARK_REASONS.filter((r) => markedByReason[r] > 0)
              .map((r) => `${markedByReason[r]} de ${REASON_SHORT[r].toLowerCase()}`)
              .join(' · ')}
            . Sao as que voce mesmo separou — nenhuma agenda escolhe melhor do que isso o que
            revisar hoje.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="px-4 py-2 rounded bg-indigo-600 text-white font-medium text-sm"
              onClick={startMarkedReview}
            >
              Refazer as marcadas ({Math.min(markedCount, DAILY_REVIEW_LIMIT)}
              {markedCount > DAILY_REVIEW_LIMIT && ` de ${markedCount}`})
            </button>
            <button
              className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 font-medium text-sm"
              onClick={() => navigate('/marcadas')}
            >
              Abrir caderno
            </button>
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Revisao espacada</h2>
        {scheduledTopics === 0 ? (
          <p className="text-sm text-gray-500 mb-3">
            Termine qualquer prova para montar a agenda. Cada tema que aparecer entra no calendario
            (algoritmo SM-2, tipo Anki): o que voce errar volta amanha, o que acertar espaca cada
            vez mais.
          </p>
        ) : dueTopics.length === 0 ? (
          <p className="text-sm text-gray-500 mb-3">
            Nenhum tema vencido — {scheduledTopics} na agenda
            {nextTopicInDays !== null && (
              <>
                , o proximo em {nextTopicInDays} {nextTopicInDays === 1 ? 'dia' : 'dias'}
              </>
            )}
            . Revisar antes da hora custa tempo e rende pouco; use o dia para tema novo.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-2">
              <strong>
                {dueTopics.length} {dueTopics.length === 1 ? 'tema vencido' : 'temas vencidos'}
              </strong>{' '}
              de {scheduledTopics} na agenda. A revisao traz questoes <strong>ineditas</strong> de
              cada tema, intercaladas, com no maximo {DAILY_REVIEW_LIMIT} por sessao.
            </p>
            <p className="text-xs text-gray-400 mb-3">
              {dueTopics
                .slice(0, 6)
                .map((slug) => topicLabels.get(slug) ?? slug)
                .join(' · ')}
              {dueTopics.length > 6 && ` · +${dueTopics.length - 6}`}
            </p>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="px-4 py-2 rounded bg-indigo-600 text-white font-medium disabled:opacity-50"
            disabled={dueTopics.length === 0}
            onClick={startTopicReview}
          >
            Revisar temas
          </button>
          {dueCount > 0 && (
            <button
              className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm"
              onClick={startSrsReview}
              title="Reapresenta as questoes exatas que voce ja respondeu, para conferir se a duvida pontual foi resolvida"
            >
              Rever as mesmas questoes ({Math.min(dueCount, DAILY_REVIEW_LIMIT)}
              {dueCount > DAILY_REVIEW_LIMIT && ` de ${dueCount}`})
            </button>
          )}
        </div>
        {trackedCount > 0 && (
          <p className="text-xs text-gray-400 mt-3">
            Revisar o <strong>tema</strong> e o modo principal: com {trackedCount} questoes ja
            respondidas, reencontrar a mesma imagem testa a memoria daquela questao, nao o assunto.
          </p>
        )}
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

      <SyncPanel />

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
