import { useEffect, useRef, useState } from 'react'
import type { Scratch } from '../lib/scratch'

/** Resolucao interna do canvas. Fixa (em vez de seguir o devicePixelRatio) para
 * o PNG salvo ter tamanho previsivel: o rascunho vive no localStorage, que tem
 * poucos MB para o site inteiro. O CSS estica para a largura disponivel. */
const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 560

/** Passos de desfazer guardados. Cada um e um PNG inteiro, entao a pilha e
 * curta de proposito. */
const UNDO_LIMIT = 12

const PEN_SIZES = [2, 5, 10]

interface Props {
  scratch: Scratch
  onChange: (next: Scratch) => void
  /** Muda quando a questao muda. Nao usamos `key` para remontar o componente
   * porque isso zeraria a aba escolhida a cada navegacao -- quem esta fazendo
   * conta quer continuar no desenho ao passar para a proxima questao. */
  questionKey: string
  /** Somente leitura na revisao do resultado: o rascunho vira registro. */
  readOnly?: boolean
}

export default function ScratchPad({ scratch, onChange, questionKey, readOnly = false }: Props) {
  const [tab, setTab] = useState<'texto' | 'desenho'>('texto')
  const [penSize, setPenSize] = useState(2)
  const [erasing, setErasing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const undoRef = useRef<string[]>([])
  const [canUndo, setCanUndo] = useState(false)

  // repinta ao trocar de questao ou ao abrir a aba de desenho. Nao depende de
  // scratch.drawing: o proprio traco atualiza esse valor, e repintar no meio
  // do desenho piscaria a tela.
  useEffect(() => {
    undoRef.current = []
    setCanUndo(false)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    if (!scratch.drawing) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0)
    img.src = scratch.drawing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, questionKey])

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    }
  }

  function strokeStyle(ctx: CanvasRenderingContext2D) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (erasing) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = penSize * 6
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = penSize
      ctx.strokeStyle = '#111827'
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    undoRef.current = [...undoRef.current, canvas.toDataURL('image/png')].slice(-UNDO_LIMIT)
    setCanUndo(true)
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const { x, y } = pointAt(e)
    strokeStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // um clique unico tem que deixar ponto, nao so um traco de zero pixels
    ctx.lineTo(x + 0.01, y)
    ctx.stroke()
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointAt(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  /** Salva so ao terminar o traco: serializar o PNG a cada movimento do mouse
   * travaria o desenho. */
  function commit() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx?.closePath()
    onChange({ ...scratch, drawing: isBlank(canvas) ? '' : canvas.toDataURL('image/png') })
  }

  function undo() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const previous = undoRef.current.pop()
    if (!canvas || !ctx || previous === undefined) return
    setCanUndo(undoRef.current.length > 0)
    const img = new Image()
    img.onload = () => {
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      ctx.drawImage(img, 0, 0)
      onChange({ ...scratch, drawing: isBlank(canvas) ? '' : canvas.toDataURL('image/png') })
    }
    img.src = previous
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    undoRef.current = [...undoRef.current, canvas.toDataURL('image/png')].slice(-UNDO_LIMIT)
    setCanUndo(true)
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    onChange({ ...scratch, drawing: '' })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {(['texto', 'desenho'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1 rounded border ${
              tab === t
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            {t === 'texto' ? 'Anotacoes' : 'Desenho'}
            {t === 'texto' && scratch.text.trim() && ' ·'}
            {t === 'desenho' && scratch.drawing && ' ·'}
          </button>
        ))}

        {tab === 'desenho' && !readOnly && (
          <div className="flex items-center gap-2 ml-auto">
            {PEN_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => {
                  setPenSize(size)
                  setErasing(false)
                }}
                title={`Espessura ${size}`}
                className={`w-7 h-7 rounded border flex items-center justify-center ${
                  !erasing && penSize === size
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-gray-300 dark:border-gray-700'
                }`}
              >
                <span
                  className="rounded-full bg-gray-800 dark:bg-gray-200 block"
                  style={{ width: size + 2, height: size + 2 }}
                />
              </button>
            ))}
            <button
              onClick={() => setErasing((v) => !v)}
              className={`text-xs px-2 py-1 rounded border ${
                erasing
                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950'
                  : 'border-gray-300 dark:border-gray-700'
              }`}
            >
              Borracha
            </button>
            <button
              onClick={undo}
              disabled={!canUndo}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40"
            >
              Desfazer
            </button>
            <button
              onClick={clearCanvas}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700"
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      {tab === 'texto' ? (
        <textarea
          value={scratch.text}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...scratch, text: e.target.value })}
          rows={8}
          placeholder={
            readOnly
              ? 'Nenhuma anotacao nesta questao.'
              : 'Contas, hipoteses, por que voce descartou cada alternativa...'
          }
          className="w-full border border-gray-300 dark:border-gray-700 rounded p-2 font-mono text-sm bg-white dark:bg-gray-950 resize-y"
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commit}
          onPointerLeave={commit}
          onPointerCancel={commit}
          className={`w-full border border-gray-300 dark:border-gray-700 rounded bg-white ${
            readOnly ? '' : erasing ? 'cursor-cell' : 'cursor-crosshair'
          }`}
          style={{ touchAction: 'none', aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
        />
      )}
    </div>
  )
}

/** Um canvas so com tracos apagados continua tendo PNG; guardar isso gastaria
 * espaco a toa e faria a questao parecer ter rascunho. */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false
  }
  return true
}
