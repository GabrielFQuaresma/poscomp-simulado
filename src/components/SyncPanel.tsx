import { useState } from 'react'
import { sendMagicLink, signOut, syncNow } from '../lib/sync'
import { useSyncState } from '../lib/useSync'

function whenSynced(at: number | null): string {
  if (at === null) return ''
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return 'agora mesmo'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `ha ${minutes} min`
  const hours = Math.round(minutes / 60)
  return `ha ${hours}h`
}

export default function SyncPanel() {
  const sync = useSyncState()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  // Site publicado sem as variaveis do Supabase: nem interface de login
  // aparece, e o app segue local como sempre foi.
  if (sync.phase === 'disabled') return null

  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setLinkError(null)
    try {
      await sendMagicLink(email.trim())
      setSent(email.trim())
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  if (sync.phase === 'signed-out') {
    return (
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Sincronizar entre dispositivos</h2>
        <p className="text-sm text-gray-500 mb-3">
          Entre com o e-mail para encontrar o mesmo historico no computador e no celular. Sem entrar,
          o progresso continua salvo so neste navegador.
        </p>
        {sent ? (
          <div className="text-sm">
            <p className="text-emerald-600 font-medium">Link enviado para {sent}.</p>
            <p className="text-gray-500 mt-1">
              Abra o link <strong>neste mesmo navegador</strong> — por seguranca ele so vale aqui.
            </p>
            <button className="text-xs text-gray-400 underline mt-2" onClick={() => setSent(null)}>
              Usar outro e-mail
            </button>
          </div>
        ) : (
          <form className="flex flex-wrap items-center gap-2" onSubmit={requestLink}>
            <input
              type="email"
              required
              placeholder="voce@exemplo.com"
              className="border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm dark:bg-gray-800 flex-1 min-w-56"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {sending ? 'Enviando...' : 'Enviar link de acesso'}
            </button>
          </form>
        )}
        {linkError && <p className="text-sm text-red-600 mt-2">Nao deu para enviar: {linkError}</p>}
      </section>
    )
  }

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="font-semibold mb-1">Sincronia</h2>
      <p className="text-sm text-gray-500 mb-3">
        Conectado como <strong>{sync.email}</strong>.{' '}
        {sync.phase === 'syncing'
          ? 'Sincronizando...'
          : sync.phase === 'error'
            ? 'A ultima sincronia falhou.'
            : sync.lastSyncedAt
              ? `Sincronizado ${whenSynced(sync.lastSyncedAt)}.`
              : 'Ainda nao sincronizou nesta sessao.'}
      </p>
      {sync.phase === 'error' && sync.error && (
        <p className="text-sm text-red-600 mb-3">
          {sync.error} — o progresso continua salvo neste navegador e sobe sozinho quando a conexao
          voltar.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-50"
          disabled={sync.phase === 'syncing'}
          onClick={() => void syncNow()}
        >
          Sincronizar agora
        </button>
        <button
          className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm"
          onClick={() => void signOut()}
        >
          Sair
        </button>
      </div>
    </section>
  )
}
