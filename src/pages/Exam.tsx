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
import ScratchPad from '../components/ScratchPad'
import { EMPTY_SCRATCH, hasContent, loadScratch, saveScratch, type Scratch } from '../lib/scratch'
import { fetchScratch, uploadScratch } from '../lib/scratchSync'
import { MAX_AWAY_SECONDS, MAX_TAB_EXITS, summarizeAbsences } from '../lib/examRules'

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
  const [scratchMap, setScratchMap] = useState<Record<string, Scratch>>({})
  const [scratchOpen, setScratchOpen] = useState(false)
  const [scratchFull, setScratchFull] = useState(false)
  const [confirmingFinish, setConfirmingFinish] = useState(false)
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
      setScratchMap(loadScratch(s.id))
      /* Retomar no outro aparelho tem que trazer o rascunho junto. Se o
         download demorar e a pessoa ja tiver escrito algo, o que ela escreveu
         vence -- por isso o merge so acontece se o mapa ainda estiver vazio. */
      void fetchScratch(s.id).then((remote) => {
        if (remote) setScratchMap((prev) => (Object.keys(prev).length > 0 ? prev : remote))
      })
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

  /* Na prova real sair da aba e monitorado: mais de 30s fora, ou 3 saidas, ja
     e infracao (edital, item 5.7.13.1). Aqui nao ha punicao -- so o registro,
     para o habito aparecer no relatorio antes de aparecer na prova. Vale so
     para simulado cronometrado: em treino sem tempo, consultar material e
     justamente o que se quer fazer. */
  const awaySinceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!session || session.finishedAt || !session.timeLimitSeconds) return

    function leave() {
      awaySinceRef.current ??= Date.now()
    }
    function comeBack() {
      const since = awaySinceRef.current
      awaySinceRef.current = null
      const current = sessionRef.current
      if (since === null || !current) return
      const seconds = Math.round((Date.now() - since) / 1000)
      // um clique que volta na hora nao e ausencia; contar isso so geraria ruido
      if (seconds < 1) return
      persist({ ...current, absences: [...current.absences, seconds] })
    }
    function onVisibility() {
      if (document.hidden) leave()
      else comeBack()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', leave)
    window.addEventListener('focus', comeBack)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', comeBack)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.finishedAt, session?.timeLimitSeconds])

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

  function updateScratch(next: Scratch) {
    if (!session) return
    const updated = { ...scratchMap, [questionId]: next }
    setScratchMap(updated)
    setScratchFull(!saveScratch(session.id, updated))
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
    // A prova acabou: sobe o rascunho agora, sem esperar o atraso que existe
    // so para nao subir megabytes a cada traco durante a prova.
    void uploadScratch(finished.id)
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
  const away = summarizeAbsences(session.absences)
  const blankCount = session.questionIds.length - answeredCount
  const flaggedCount = Object.values(session.flagged).filter(Boolean).length

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
            <button
              className="px-3 py-1.5 rounded bg-red-600 text-white text-sm"
              onClick={() => setConfirmingFinish(true)}
            >
              Finalizar prova
            </button>
          </div>
        </div>

        {away.count > 0 && (
          <div
            className={`mb-3 text-sm rounded p-3 border ${
              away.wouldBeFlagged
                ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
            }`}
          >
            Voce saiu desta aba {away.count}{' '}
            {away.count === 1 ? 'vez' : 'vezes'} (maior ausencia: {away.longestSeconds}s).{' '}
            {away.wouldBeFlagged
              ? `Na prova real isso ja seria infracao: o limite e ${MAX_AWAY_SECONDS}s fora ou ${MAX_TAB_EXITS} saidas.`
              : `O limite na prova real e ${MAX_AWAY_SECONDS}s fora ou ${MAX_TAB_EXITS} saidas.`}
          </div>
        )}

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
                title="Serve para voltar nela antes de entregar, como na prova real. O que continuar marcado no fim vai para o caderno de revisao."
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

        {/* espaco para rascunho eletronico, como o da plataforma da prova
            (edital POSCOMP, item 5.7.8.3.2). Fica por questao: a conta que
            voce fez na 14 tem que estar la quando voce voltar para a 14 */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 mt-4">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setScratchOpen((v) => !v)}
          >
            <span className="font-semibold text-sm">
              Rascunho
              {hasContent(scratchMap[questionId]) && (
                <span className="ml-2 text-xs font-normal text-indigo-600">
                  com anotacoes nesta questao
                </span>
              )}
            </span>
            <span className="text-gray-400 text-sm">{scratchOpen ? '▾' : '▸'}</span>
          </button>
          {scratchOpen && (
            <div className="mt-3">
              <ScratchPad
                questionKey={questionId}
                scratch={scratchMap[questionId] ?? EMPTY_SCRATCH}
                onChange={updateScratch}
              />
              {scratchFull && (
                <p className="text-sm text-red-600 mt-2">
                  O navegador recusou salvar: o armazenamento local encheu. Limpe desenhos antigos
                  ou apague provas ja finalizadas para liberar espaco.
                </p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                Na prova real voce tambem pode usar ate 3 folhas em branco, vistoriadas pela webcam
                antes de comecar. Calculadora nao e permitida.
              </p>
            </div>
          )}
        </div>
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
            const scratched = hasContent(scratchMap[id])
            return (
              <button
                key={id}
                onClick={() => goTo(i)}
                title={scratched ? `${id} — tem rascunho` : id}
                className={`relative aspect-square rounded text-xs font-medium flex items-center justify-center border ${
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
                {scratched && (
                  <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-600" />
                )}
              </button>
            )
          })}
        </div>
      </aside>

      {/* Na prova real, enviar e um passo obrigatorio: quem nao envia e
          eliminado (edital, item 5.7.10.1). Confirmar aqui treina o gesto e
          evita perder questoes em branco por clique errado. O estouro do
          cronometro nao passa por aqui -- envia direto, como la. */}
      {confirmingFinish && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="font-semibold text-lg mb-2">Enviar a prova?</h2>
            <p className="text-sm text-gray-500 mb-4">
              Depois de enviar nao da para voltar e responder o que ficou faltando.
            </p>
            <ul className="text-sm space-y-1 mb-4">
              <li>
                Respondidas: <strong>{answeredCount}</strong> de {session.questionIds.length}
              </li>
              {blankCount > 0 && (
                <li className="text-red-600">
                  Em branco: <strong>{blankCount}</strong> — cada uma vale 0, entao chutar sempre
                  rende mais do que deixar vazia
                </li>
              )}
              {flaggedCount > 0 && (
                <li className="text-amber-600">
                  Marcadas para revisao: <strong>{flaggedCount}</strong>
                </li>
              )}
            </ul>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm"
                onClick={() => setConfirmingFinish(false)}
              >
                Voltar a prova
              </button>
              <button className="px-4 py-2 rounded bg-red-600 text-white text-sm" onClick={finish}>
                Enviar prova
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
