import type { AppData } from '../types'
import { mergeAppData } from './merge'
import { setScratchListener } from './scratch'
import {
  deleteRemoteScratch,
  flushScratchUploads,
  scheduleScratchUpload,
  setScratchUser,
  wipeRemoteScratch,
} from './scratchSync'
import { applyRemoteData, loadData, setStorageListeners } from './storage'
import { isSyncConfigured, redirectUrl, supabase } from './supabase'

/** O historico e minusculo (1,4 MB depois de 100 simulados), entao o atraso
 * aqui existe so para nao subir 12 vezes por minuto durante a prova, onde o
 * Exam grava a cada 5 segundos. */
const HISTORY_DELAY_MS = 4000

export type SyncPhase = 'disabled' | 'signed-out' | 'syncing' | 'idle' | 'error'

export interface SyncState {
  phase: SyncPhase
  email: string | null
  lastSyncedAt: number | null
  error: string | null
}

let state: SyncState = {
  phase: isSyncConfigured() ? 'signed-out' : 'disabled',
  email: null,
  lastSyncedAt: null,
  error: null,
}

const subscribers = new Set<(s: SyncState) => void>()

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const fn of subscribers) fn(state)
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

let userId: string | null = null
let historyTimer: ReturnType<typeof setTimeout> | null = null
/** O StrictMode monta os efeitos duas vezes em desenvolvimento. Sem esta
 * trava, seriam dois registros de listener e duas sincronias completas. */
let started = false

export function startSync(): void {
  if (started || !supabase) return
  started = true

  setStorageListeners({
    changed: scheduleHistoryUpload,
    sessionDeleted: (sessionId) => void deleteRemoteScratch(sessionId),
    reset: () => void wipeRemote(),
  })
  setScratchListener(scheduleScratchUpload)

  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null
    const switched = next?.id !== userId
    userId = next?.id ?? null
    setScratchUser(userId)

    if (!next) {
      cancelHistoryUpload()
      setState({ phase: 'signed-out', email: null, error: null })
      return
    }
    setState({ email: next.email ?? null })
    // TOKEN_REFRESHED chega de tempos em tempos com o mesmo usuario; sincronizar
    // de novo a cada renovacao seria trabalho a toa.
    if (switched) void syncNow()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush()
  })
  window.addEventListener('beforeunload', flush)
}

/** Baixa, mescla, grava e sobe. Sempre merge: "o remoto vence" ou "o local
 * vence" fariam um dos dispositivos perder o que fez offline. */
export async function syncNow(): Promise<void> {
  const client = supabase
  const uid = userId
  if (!client || !uid) return
  setState({ phase: 'syncing', error: null })
  try {
    const { data, error } = await client
      .from('user_data')
      .select('data')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) throw error

    const remote = (data?.data ?? null) as AppData | null
    const merged = remote ? mergeAppData(loadData(), remote) : loadData()
    applyRemoteData(merged)
    await upload(merged)
    setState({ phase: 'idle', lastSyncedAt: Date.now() })
  } catch (e) {
    setState({ phase: 'error', error: describe(e) })
  }
}

async function upload(data: AppData): Promise<void> {
  const client = supabase
  const uid = userId
  if (!client || !uid) return
  const { error } = await client
    .from('user_data')
    .upsert({ user_id: uid, data, updated_at: new Date().toISOString() })
  if (error) throw error
}

function scheduleHistoryUpload(): void {
  if (!supabase || !userId) return
  cancelHistoryUpload()
  historyTimer = setTimeout(() => {
    historyTimer = null
    void pushLocal()
  }, HISTORY_DELAY_MS)
}

function cancelHistoryUpload(): void {
  if (historyTimer !== null) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
}

async function pushLocal(): Promise<void> {
  if (!userId) return
  setState({ phase: 'syncing', error: null })
  try {
    await upload(loadData())
    setState({ phase: 'idle', lastSyncedAt: Date.now() })
  } catch (e) {
    setState({ phase: 'error', error: describe(e) })
  }
}

/** Fechar a aba ou trocar de app nao pode deixar para tras o que ainda estava
 * no atraso. No celular o visibilitychange e o unico dos dois que dispara de
 * forma confiavel. */
function flush(): void {
  if (historyTimer !== null) {
    cancelHistoryUpload()
    void pushLocal()
  }
  flushScratchUploads()
}

async function wipeRemote(): Promise<void> {
  const client = supabase
  const uid = userId
  if (!client || !uid) return
  cancelHistoryUpload()
  setState({ phase: 'syncing', error: null })
  try {
    const { error } = await client.from('user_data').delete().eq('user_id', uid)
    if (error) throw error
    await wipeRemoteScratch()
    setState({ phase: 'idle', lastSyncedAt: Date.now() })
  } catch (e) {
    setState({ phase: 'error', error: describe(e) })
  }
}

export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Sincronia nao configurada neste site')
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl() },
  })
  if (error) throw error
}

/** Sair nao apaga o localStorage: os dados locais continuam valendo em modo
 * offline, como antes de existir login. */
export async function signOut(): Promise<void> {
  if (!supabase) return
  cancelHistoryUpload()
  try {
    await upload(loadData())
  } catch {
    // sair tem que funcionar mesmo sem rede
  }
  flushScratchUploads()
  await supabase.auth.signOut()
}
