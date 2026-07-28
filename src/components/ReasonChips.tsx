import type { MarkReason } from '../types'
import { MARK_REASONS, REASON_HINTS, REASON_LABELS } from '../lib/marks'

interface Props {
  value: MarkReason | null
  onChange: (reason: MarkReason) => void
}

/** Escolha da razao da marca em um clique. Sao quatro opcoes fixas de proposito:
 * campo livre viraria quatro jeitos de escrever "nao sei", e ai nada pode ser
 * filtrado nem contado depois. */
export default function ReasonChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MARK_REASONS.map((reason) => {
        const selected = value === reason
        return (
          <button
            key={reason}
            type="button"
            onClick={() => onChange(reason)}
            title={REASON_HINTS[reason]}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              selected
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {REASON_LABELS[reason]}
          </button>
        )
      })}
    </div>
  )
}
