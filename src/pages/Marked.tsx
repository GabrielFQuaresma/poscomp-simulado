import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  MarkReason,
  Question,
  QuestionAttemptRecord,
  QuestionMark,
  QuestionsData,
  TopicMeta,
} from '../types'
import { AREA_LABELS, loadQuestions, questionImageUrl } from '../lib/questions'
import { loadTopics, topicLabelMap } from '../lib/topics'
import { buildMarkedExam, buildTopicExam } from '../lib/examLogic'
import { getAttempts, getMarks, saveMarks, upsertSession } from '../lib/storage'
import {
  MARK_REASONS,
  REASON_HINTS,
  REASON_LABELS,
  REASON_SHORT,
  countByReason,
  markQuestion,
  resolveMark,
} from '../lib/marks'
import ReasonChips from '../components/ReasonChips'
import TopicTags from '../components/TopicTags'

type StatusFilter = 'abertas' | 'resolvidas' | 'todas'

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(timestamp: number, now: number): string {
  const days = Math.floor((now - timestamp) / DAY_MS)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `ha ${days} dias`
}

/** Quantas questoes o treino por tema traz. O mesmo padrao da tela de temas:
 * sessao curta o suficiente para ser comecada no dia em que se pensou nela. */
const TOPIC_PRACTICE_COUNT = 15

interface EntryProps {
  mark: QuestionMark
  question: Question
  topicMeta: Map<string, TopicMeta>
  lastAttempt: QuestionAttemptRecord | undefined
  now: number
  onReason: (reason: MarkReason) => void
  onNote: (note: string) => void
  onToggle: () => void
  onTrainTopic: (slug: string) => void
}

function MarkEntry({
  mark,
  question,
  topicMeta,
  lastAttempt,
  now,
  onReason,
  onNote,
  onToggle,
  onTrainTopic,
}: EntryProps) {
  const [note, setNote] = useState(mark.note)
  const open = mark.resolvedAt === null
  const primaryTopic = question.topics[0]

  return (
    <li
      className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${
        open ? 'border-gray-200 dark:border-gray-800' : 'border-gray-100 dark:border-gray-900 opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 text-sm">
        <span className="font-medium">
          {question.year} · Q{question.number}
        </span>
        <span className="text-gray-500">{AREA_LABELS[question.area]}</span>
        <span className="text-xs px-2 py-0.5 rounded-full border border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300">
          {REASON_SHORT[mark.reason]}
        </span>
        <span className="text-gray-400 text-xs">marcada {daysAgo(mark.createdAt, now)}</span>
        {mark.timesMarked > 1 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
            title="Voce ja tinha dado esta questao por resolvida e ela voltou"
          >
            {mark.timesMarked}ª vez
          </span>
        )}
        {!open && <span className="text-xs text-gray-400">resolvida</span>}
      </div>

      <img
        src={questionImageUrl(question.image)}
        alt={`Questao ${question.number}`}
        className="w-full rounded border border-gray-200 dark:border-gray-800"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-sm">
        <TopicTags slugs={question.topics} topics={topicMeta} linkToAnalysis={false} />
        {question.annulled ? (
          <span className="text-amber-600 text-xs">Anulada</span>
        ) : (
          <span className="text-xs text-gray-500">
            Gabarito: <strong>{question.answer}</strong>
            {lastAttempt && (
              <>
                {' '}
                · ultima resposta sua:{' '}
                <strong className={lastAttempt.correct ? 'text-green-600' : 'text-red-600'}>
                  {lastAttempt.answer ?? 'em branco'}
                </strong>
              </>
            )}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <ReasonChips value={mark.reason} onChange={onReason} />
          <p className="text-xs text-gray-500">{REASON_HINTS[mark.reason]}</p>
          <textarea
            className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-transparent"
            rows={2}
            placeholder="O que faltou nesta questao?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== mark.note) onNote(note)
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
        <button
          className={`px-3 py-1.5 rounded text-sm ${
            open
              ? 'bg-emerald-600 text-white'
              : 'border border-gray-300 dark:border-gray-700 text-gray-500'
          }`}
          onClick={onToggle}
        >
          {open ? 'Ja entendi, resolver' : 'Marcar de novo'}
        </button>
        {open && primaryTopic && (
          <button
            className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm"
            onClick={() => onTrainTopic(primaryTopic)}
            title="Treina o assunto com outras questoes, em vez de reencontrar esta"
          >
            Treinar {topicMeta.get(primaryTopic)?.label ?? primaryTopic}
          </button>
        )}
        <Link to={`/results/${mark.sessionId}`} className="text-xs text-gray-500 underline">
          Ver a prova de origem
        </Link>
      </div>
    </li>
  )
}

export default function Marked() {
  const navigate = useNavigate()
  const [data, setData] = useState<QuestionsData | null>(null)
  const [topicMeta, setTopicMeta] = useState<Map<string, TopicMeta>>(new Map())
  const [marks, setMarks] = useState<Record<string, QuestionMark>>({})
  const [status, setStatus] = useState<StatusFilter>('abertas')
  const [reasonFilter, setReasonFilter] = useState<MarkReason | 'todas'>('todas')

  useEffect(() => {
    loadQuestions().then(setData)
    loadTopics().then((t) => setTopicMeta(topicLabelMap(t.topics)))
    setMarks(getMarks())
  }, [])

  const attempts = useMemo(() => getAttempts(), [])

  /** Ultima resposta de cada questao, para o caderno mostrar o que voce marcou
   * da ultima vez e nao so o gabarito. */
  const lastAttempts = useMemo(() => {
    const map = new Map<string, QuestionAttemptRecord>()
    for (const a of attempts) {
      const prev = map.get(a.questionId)
      if (!prev || a.timestamp > prev.timestamp) map.set(a.questionId, a)
    }
    return map
  }, [attempts])

  const questionMap = useMemo(() => {
    if (!data) return new Map<string, Question>()
    return new Map(data.questions.map((q) => [q.id, q]))
  }, [data])

  const topicLabels = useMemo(
    () => new Map([...topicMeta].map(([slug, meta]) => [slug, meta.label])),
    [topicMeta],
  )

  const all = useMemo(
    () =>
      Object.values(marks)
        .filter((m) => questionMap.has(m.questionId))
        .sort((a, b) => a.createdAt - b.createdAt),
    [marks, questionMap],
  )
  const open = all.filter((m) => m.resolvedAt === null)
  const counts = countByReason(open)

  const visible = all.filter((m) => {
    const byStatus =
      status === 'todas' ||
      (status === 'abertas' ? m.resolvedAt === null : m.resolvedAt !== null)
    return byStatus && (reasonFilter === 'todas' || m.reason === reasonFilter)
  })

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

  function toggle(questionId: string) {
    const prev = marks[questionId]
    if (!prev) return
    const now = Date.now()
    // reabrir aqui e uma decisao consciente ("nao entendi mesmo"), entao passa
    // pelo markQuestion e soma no contador de reincidencia
    const next =
      prev.resolvedAt === null
        ? resolveMark(prev, now)
        : markQuestion(prev, { questionId, sessionId: prev.sessionId, reason: prev.reason }, now)
    saveMarks([next])
    setMarks((m) => ({ ...m, [questionId]: next }))
  }

  function startMarkedExam() {
    if (!data) return
    const session = buildMarkedExam(data.questions, marks, {
      correctionMode: 'study',
      timeLimitSeconds: null,
    })
    if (session.questionIds.length === 0) return
    upsertSession(session)
    navigate(`/exam/${session.id}`)
  }

  function startTopicPractice(slugs: string[]) {
    if (!data || slugs.length === 0) return
    const session = buildTopicExam(
      data.questions,
      slugs,
      topicLabels,
      TOPIC_PRACTICE_COUNT,
      { excludeAnnulled: true, excludeAlreadyCorrect: false, attempts },
      { correctionMode: 'study', timeLimitSeconds: null },
    )
    upsertSession(session)
    navigate(`/exam/${session.id}`)
  }

  if (!data) return <p>Carregando...</p>

  /** Temas principais das questoes em aberto, do mais frequente para o menos:
   * tres marcas no mesmo tema nao sao tres duvidas, sao um buraco. */
  const topicsOfOpen = [
    ...open.reduce((acc, m) => {
      const slug = questionMap.get(m.questionId)?.topics[0]
      if (slug) acc.set(slug, (acc.get(slug) ?? 0) + 1)
      return acc
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1])

  if (all.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h1 className="text-xl font-semibold mb-2">Caderno de revisao</h1>
        <p className="text-sm text-gray-500 mb-4">
          Vazio por enquanto. Marque as questoes com a estrela durante a prova, do jeito que voce ja
          faria para voltar nelas antes de entregar: ao terminar, elas caem aqui com a razao que
          voce confirmar na triagem do resultado. Voce tambem pode marcar qualquer questao ao
          revisar o gabarito.
        </p>
        <Link to="/" className="text-indigo-600 font-medium text-sm">
          Comecar um simulado
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h1 className="text-xl font-semibold mb-1">Caderno de revisao</h1>
        <p className="text-sm text-gray-500 mb-3">
          {open.length === 0 ? (
            <>Nenhuma questao em aberto — as {all.length} ja foram resolvidas.</>
          ) : (
            <>
              <strong>{open.length}</strong> {open.length === 1 ? 'questao' : 'questoes'} em aberto:{' '}
              {MARK_REASONS.filter((r) => counts[r] > 0)
                .map((r) => `${counts[r]} de ${REASON_SHORT[r].toLowerCase()}`)
                .join(' · ')}
              .
            </>
          )}
        </p>

        {open.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3">
              <button
                className="px-4 py-2 rounded bg-indigo-600 text-white font-medium text-sm"
                onClick={startMarkedExam}
                title="Refaz as proprias questoes marcadas, das mais antigas para as mais novas"
              >
                Refazer as marcadas
              </button>
              {topicsOfOpen.length > 0 && (
                <button
                  className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 font-medium text-sm"
                  onClick={() => startTopicPractice(topicsOfOpen.slice(0, 3).map(([slug]) => slug))}
                >
                  Treinar os temas das marcadas ({TOPIC_PRACTICE_COUNT}q)
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Refazer prova que voce resolveu a duvida naquela questao; treinar o tema prova que voce
              aprendeu o assunto. So o segundo cai de novo na prova — refazer sozinho acaba testando
              a memoria do enunciado.
            </p>
            {topicsOfOpen.length > 0 && topicsOfOpen[0][1] > 1 && (
              <p className="text-sm mt-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded p-3">
                {topicsOfOpen[0][1]} das suas marcas sao de{' '}
                <strong>{topicMeta.get(topicsOfOpen[0][0])?.label ?? topicsOfOpen[0][0]}</strong>.
                Isso nao e duvida solta, e um buraco de conteudo: vale estudar o tema antes de
                refazer as questoes.
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-wrap gap-4 items-center text-sm">
        <label className="flex items-center gap-2">
          <span>Mostrar:</span>
          <select
            className="border rounded px-2 py-1 dark:bg-gray-800"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="abertas">Em aberto ({open.length})</option>
            <option value="resolvidas">Resolvidas ({all.length - open.length})</option>
            <option value="todas">Todas ({all.length})</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span>Razao:</span>
          <select
            className="border rounded px-2 py-1 dark:bg-gray-800"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value as MarkReason | 'todas')}
          >
            <option value="todas">Todas</option>
            {MARK_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </section>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma questao com esses filtros.</p>
      ) : (
        <ul className="space-y-4">
          {visible.map((mark) => {
            const question = questionMap.get(mark.questionId)
            if (!question) return null
            return (
              <MarkEntry
                key={mark.questionId}
                mark={mark}
                question={question}
                topicMeta={topicMeta}
                lastAttempt={lastAttempts.get(mark.questionId)}
                now={Date.now()}
                onReason={(reason) => editMark(mark.questionId, { reason })}
                onNote={(note) => editMark(mark.questionId, { note })}
                onToggle={() => toggle(mark.questionId)}
                onTrainTopic={(slug) => startTopicPractice([slug])}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
