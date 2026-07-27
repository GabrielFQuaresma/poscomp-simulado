import { Link } from 'react-router-dom'
import type { TopicMeta } from '../types'

interface Props {
  slugs: string[]
  topics: Map<string, TopicMeta>
  /** Link para a analise de temas, para o usuario ver o quanto o tema cai. */
  linkToAnalysis?: boolean
}

/** Etiquetas dos temas de uma questao. O primeiro slug e o tema principal e vem
 * destacado; os seguintes sao assuntos secundarios que a questao tambem exige. */
export default function TopicTags({ slugs, topics, linkToAnalysis = true }: Props) {
  if (slugs.length === 0) {
    return <span className="text-xs text-gray-400">Tema nao identificado</span>
  }

  const tags = slugs.map((slug, i) => {
    const label = topics.get(slug)?.label ?? slug
    const primary = i === 0
    return (
      <span
        key={slug}
        className={`text-xs px-2 py-0.5 rounded-full border ${
          primary
            ? 'bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-950/60 dark:border-indigo-800 dark:text-indigo-200'
            : 'border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400'
        }`}
        title={primary ? 'Tema principal' : 'Assunto secundario da questao'}
      >
        {label}
      </span>
    )
  })

  return (
    <span className="inline-flex flex-wrap gap-1.5 items-center">
      {tags}
      {linkToAnalysis && (
        <Link to="/topicos" className="text-xs text-indigo-600 underline">
          ver incidencia
        </Link>
      )}
    </span>
  )
}
