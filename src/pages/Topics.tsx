import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, CorrectionMode, QuestionsData, TopicsData } from '../types'
import { AREA_LABELS, loadQuestions } from '../lib/questions'
import {
  AREA_SHORT_LABELS,
  MIN_ATTEMPTS_FOR_ACCURACY,
  QUESTIONS_PER_EXAM,
  RECENT_YEARS_WINDOW,
  computeTopicStats,
  loadTopics,
  unclassifiedStats,
  type TopicStats,
} from '../lib/topics'
import { buildTopicExam } from '../lib/examLogic'
import { getAttempts, upsertSession } from '../lib/storage'

type SortKey = 'priority' | 'incidence' | 'recent' | 'trend' | 'accuracy'

const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Prioridade de estudo',
  incidence: 'Mais cai (historico)',
  recent: 'Mais cai (provas recentes)',
  trend: 'Em alta',
  accuracy: 'Meu pior desempenho',
}

const AREA_COLORS: Record<Area, string> = {
  matematica: '#4f46e5',
  fundamentos: '#0891b2',
  tecnologia: '#c026d3',
  desconhecida: '#6b7280',
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function signed(value: number): string {
  const rounded = value.toFixed(2)
  return value > 0 ? `+${rounded}` : rounded
}

/** Mini grafico de barras da incidencia ano a ano, para enxergar de relance se
 * o tema e constante, se sumiu ou se e novidade das ultimas provas. */
function YearSparkline({ stats, years }: { stats: TopicStats; years: number[] }) {
  const max = Math.max(1, ...years.map((y) => stats.countByYear.get(y) ?? 0))
  return (
    <div className="flex items-end gap-[2px] h-8" title="Questoes por ano (mais antigo a esquerda)">
      {years.map((year) => {
        const count = stats.countByYear.get(year) ?? 0
        return (
          <div
            key={year}
            className="w-[6px] bg-indigo-200 dark:bg-indigo-900 rounded-sm relative"
            style={{ height: '100%' }}
            title={`${year}: ${count} ${count === 1 ? 'questao' : 'questoes'}`}
          >
            <div
              className="absolute bottom-0 left-0 right-0 bg-indigo-600 rounded-sm"
              style={{ height: `${(count / max) * 100}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function Topics() {
  const navigate = useNavigate()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [topicsData, setTopicsData] = useState<TopicsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [areaFilter, setAreaFilter] = useState<Area | 'todas'>('todas')
  const [selected, setSelected] = useState<string[]>([])
  const [practiceCount, setPracticeCount] = useState(15)

  useEffect(() => {
    Promise.all([loadQuestions(), loadTopics()])
      .then(([q, t]) => {
        setData(q)
        setTopicsData(t)
      })
      .catch((e) => setError(String(e)))
  }, [])

  const attempts = useMemo(() => getAttempts(), [])

  const stats = useMemo(() => {
    if (!data || !topicsData) return []
    return computeTopicStats({
      questions: data.questions,
      topics: topicsData.topics,
      attempts,
      years: data.years,
    })
  }, [data, topicsData, attempts])

  const coverage = useMemo(() => (data ? unclassifiedStats(data.questions) : null), [data])

  const visible = useMemo(() => {
    const filtered = stats.filter(
      (s) => (areaFilter === 'todas' || s.meta.area === areaFilter) && s.totalCount > 0,
    )
    const sorters: Record<SortKey, (a: TopicStats, b: TopicStats) => number> = {
      priority: (a, b) => b.priority - a.priority,
      incidence: (a, b) => b.primaryCount - a.primaryCount,
      recent: (a, b) => b.perExamRecent - a.perExamRecent,
      trend: (a, b) => b.trend - a.trend,
      // sem historico vai para o fim: nao da para chamar de "pior desempenho"
      // aquilo que voce ainda nem tentou
      accuracy: (a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2),
    }
    return [...filtered].sort(sorters[sortKey])
  }, [stats, areaFilter, sortKey])

  const chartData = useMemo(
    () =>
      visible.slice(0, 12).map((s) => ({
        label: s.meta.label,
        area: s.meta.area,
        value: Number((sortKey === 'recent' ? s.perExamRecent : s.perExam).toFixed(2)),
      })),
    [visible, sortKey],
  )

  const chartMax = useMemo(
    () => Math.max(1, ...chartData.map((d) => d.value)),
    [chartData],
  )

  const topicLabels = useMemo(
    () => new Map((topicsData?.topics ?? []).map((t) => [t.slug, t.label])),
    [topicsData],
  )

  const selectedPoolSize = useMemo(() => {
    if (!data || selected.length === 0) return 0
    return data.questions.filter((q) => q.topics.some((t) => selected.includes(t))).length
  }, [data, selected])

  function toggle(slug: string) {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
  }

  function startPractice(correctionMode: CorrectionMode, slugs: string[] = selected, count = practiceCount) {
    if (!data || slugs.length === 0) return
    const session = buildTopicExam(
      data.questions,
      slugs,
      topicLabels,
      count,
      { excludeAnnulled: true, excludeAlreadyCorrect: false },
      { correctionMode, timeLimitSeconds: null },
    )
    upsertSession(session)
    navigate(`/exam/${session.id}`)
  }

  if (error) return <p className="text-red-600">Erro: {error}</p>
  if (!data || !topicsData || !coverage) return <p>Carregando analise...</p>

  const totalPriority = stats.reduce((sum, s) => sum + s.priority, 0)
  const top3 = [...stats].sort((a, b) => b.priority - a.priority).slice(0, 3)

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h1 className="text-xl font-semibold mb-1">Onde vale mais estudar</h1>
        <p className="text-sm text-gray-500">
          Cada uma das {coverage.total} questoes de {data.years.length} provas ({data.years[0]}–
          {data.years[data.years.length - 1]}) foi classificada por tema a partir do texto do
          caderno original. A prioridade cruza <strong>o quanto o tema cai</strong> com{' '}
          <strong>o quanto voce erra nele</strong>.
        </p>
        {coverage.count > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            {pct(coverage.coverage)} das questoes foram classificadas; {coverage.count} ficaram sem
            tema reconhecido e nao entram nas contas abaixo.
          </p>
        )}
      </section>

      <section className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 rounded-lg p-4">
        <h2 className="font-semibold mb-2">Comece por estes tres</h2>
        <ol className="space-y-2 text-sm">
          {top3.map((s, i) => (
            <li key={s.meta.slug} className="flex items-start gap-2">
              <span className="font-bold text-indigo-600 w-4">{i + 1}.</span>
              <span>
                <strong>{s.meta.label}</strong> — cai {s.perExam.toFixed(1)} vez
                {s.perExam >= 2 ? 'es' : ''} por prova
                {s.accuracy !== null ? (
                  <> e voce acerta {pct(s.accuracy)} delas</>
                ) : (
                  <> e voce ainda nao praticou o tema</>
                )}
                . Ganho estimado: <strong>{s.priority.toFixed(1)} questoes</strong> por prova.
              </span>
            </li>
          ))}
        </ol>
        {totalPriority > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Somando todos os temas, ha cerca de {totalPriority.toFixed(0)} das {QUESTIONS_PER_EXAM}{' '}
            questoes em jogo hoje.
          </p>
        )}
        {/* treinar os tres de uma vez, alternando, e melhor do que tres blocos
            seguidos: a prova nunca avisa de que assunto e a proxima questao */}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            className="px-4 py-2 rounded bg-indigo-600 text-white font-medium text-sm disabled:opacity-50"
            disabled={top3.length === 0}
            onClick={() => startPractice('study', top3.map((s) => s.meta.slug), 21)}
          >
            Treinar os tres intercalados (21q)
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Alterna entre os tres temas, sem duas questoes seguidas do mesmo.
          </span>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-center text-sm mb-4">
          <label className="flex items-center gap-2">
            <span>Ordenar por:</span>
            <select
              className="border rounded px-2 py-1 dark:bg-gray-800"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span>Area:</span>
            <select
              className="border rounded px-2 py-1 dark:bg-gray-800"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value as Area | 'todas')}
            >
              <option value="todas">Todas</option>
              {(['matematica', 'fundamentos', 'tecnologia'] as Area[]).map((a) => (
                <option key={a} value={a}>
                  {AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ol className="space-y-1.5">
          {chartData.map((d) => (
            <li key={d.label} className="flex items-center gap-3 text-sm">
              <span className="w-52 sm:w-64 shrink-0 truncate" title={d.label}>
                {d.label}
              </span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-sm h-4 overflow-hidden">
                <div
                  className="h-4 rounded-sm"
                  style={{
                    width: `${(d.value / chartMax) * 100}%`,
                    backgroundColor: AREA_COLORS[d.area],
                  }}
                />
              </div>
              <span className="tabular-nums w-10 text-right text-gray-500">
                {d.value.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-400 mt-3">
          Media de questoes por prova —{' '}
          {sortKey === 'recent' ? `ultimas ${RECENT_YEARS_WINDOW} provas` : 'historico completo'}.
          Cor indica a area: <span style={{ color: AREA_COLORS.matematica }}>Matematica</span>,{' '}
          <span style={{ color: AREA_COLORS.fundamentos }}>Fundamentos</span>,{' '}
          <span style={{ color: AREA_COLORS.tecnologia }}>Tecnologia</span>.
        </p>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 overflow-x-auto">
        <h2 className="font-semibold mb-3">Todos os temas</h2>
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2 w-8"></th>
              <th className="py-2 font-medium">Tema</th>
              <th className="text-right px-2 whitespace-nowrap">Questoes</th>
              <th
                className="text-right px-2 whitespace-nowrap"
                title="Media de questoes por prova em todas as provas"
              >
                Por prova
              </th>
              <th
                className="text-right px-2 whitespace-nowrap"
                title={`Media nas ultimas ${RECENT_YEARS_WINDOW} provas`}
              >
                Recente
              </th>
              <th
                className="text-right px-2 whitespace-nowrap"
                title="Diferenca entre a media recente e a historica"
              >
                Tendencia
              </th>
              <th className="text-right px-2 whitespace-nowrap">Meu acerto</th>
              <th
                className="text-right px-2 whitespace-nowrap"
                title="Questoes por prova que voce tende a perder neste tema"
              >
                Prioridade
              </th>
              <th className="pl-3 whitespace-nowrap">Por ano</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const maxPriority = Math.max(...visible.map((v) => v.priority), 0.01)
              return (
                <tr
                  key={s.meta.slug}
                  className="border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.meta.slug)}
                      onChange={() => toggle(s.meta.slug)}
                      aria-label={`Selecionar ${s.meta.label}`}
                    />
                  </td>
                  <td className="py-2">
                    <div className="font-medium">{s.meta.label}</div>
                    <div className="text-xs text-gray-400">{AREA_SHORT_LABELS[s.meta.area]}</div>
                  </td>
                  <td className="text-right px-2">
                    {s.primaryCount}
                    {s.totalCount > s.primaryCount && (
                      <span className="text-gray-400" title="Contando questoes em que o tema aparece como assunto secundario">
                        {' '}
                        (+{s.totalCount - s.primaryCount})
                      </span>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums">{s.perExam.toFixed(1)}</td>
                  <td className="text-right px-2 tabular-nums">{s.perExamRecent.toFixed(1)}</td>
                  <td
                    className={`text-right px-2 tabular-nums ${
                      s.trend > 0.15
                        ? 'text-emerald-600'
                        : s.trend < -0.15
                          ? 'text-amber-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {signed(s.trend)}
                  </td>
                  <td className="text-right px-2 tabular-nums">
                    {s.accuracy !== null ? (
                      <span title={`${s.correct}/${s.answered} questoes`}>{pct(s.accuracy)}</span>
                    ) : (
                      <span
                        className="text-gray-400"
                        title={`Responda ao menos ${MIN_ATTEMPTS_FOR_ACCURACY} questoes do tema para medir`}
                      >
                        {s.answered > 0 ? `${s.answered} resp.` : '—'}
                      </span>
                    )}
                  </td>
                  <td className="text-right px-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={s.priorityIsEstimate ? 'bg-indigo-300 h-2' : 'bg-indigo-600 h-2'}
                          style={{ width: `${(s.priority / maxPriority) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums w-8">{s.priority.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="pl-3">
                    <YearSparkline stats={s} years={data.years} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-3">
          Barras de prioridade em tom claro sao estimativas: falta historico seu no tema, entao
          assumimos 50% de acerto ate voce praticar.
        </p>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Praticar os temas selecionados</h2>
        <p className="text-sm text-gray-500 mb-3">
          {selected.length === 0
            ? 'Marque os temas na tabela acima para montar um treino focado.'
            : `${selected.length} ${selected.length === 1 ? 'tema' : 'temas'} · ${selectedPoolSize} questoes disponiveis.`}
          {selected.length > 1 &&
            ' Os temas entram alternados e em partes iguais, sem duas questoes seguidas do mesmo.'}
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2 text-sm">
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
          <button
            className="px-4 py-2 rounded bg-indigo-600 text-white font-medium text-sm disabled:opacity-50"
            disabled={selected.length === 0}
            onClick={() => startPractice('study')}
          >
            Treinar (corrige na hora)
          </button>
          <button
            className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 font-medium text-sm disabled:opacity-50"
            disabled={selected.length === 0}
            onClick={() => startPractice('exam')}
          >
            Simular (corrige ao final)
          </button>
          {selected.length > 0 && (
            <button className="text-sm text-gray-500 underline" onClick={() => setSelected([])}>
              Limpar selecao
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
