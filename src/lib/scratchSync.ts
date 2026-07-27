import { applyRemoteScratch, loadScratch, type Scratch } from './scratch'
import { supabase } from './supabase'

const BUCKET = 'scratch'

/** Uma prova inteira desenhada passa de 1,5 MB -- mais que todo o historico.
 * Por isso a espera aqui e bem maior que a do historico: enquanto a prova esta
 * aberta, o que importa e nao subir a cada traco. */
const UPLOAD_DELAY_MS = 15000

/** O caminho comeca pelo user_id porque e ele que a policy do bucket compara
 * com auth.uid(). Mudar a convencao de caminho quebra o isolamento. */
function objectPath(userId: string, sessionId: string): string {
  return `${userId}/${sessionId}.json`
}

let userId: string | null = null

export function setScratchUser(id: string | null): void {
  if (id !== userId) cancelAll()
  userId = id
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleScratchUpload(sessionId: string): void {
  if (!supabase || !userId) return
  const existing = timers.get(sessionId)
  if (existing) clearTimeout(existing)
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId)
      void uploadScratch(sessionId)
    }, UPLOAD_DELAY_MS),
  )
}

export function flushScratchUploads(): void {
  for (const [sessionId, timer] of timers) {
    clearTimeout(timer)
    void uploadScratch(sessionId)
  }
  timers.clear()
}

function cancelAll(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}

/** Sobe o rascunho inteiro da sessao num objeto so. Sem rascunho nenhum, o
 * objeto e removido -- deixar um `{}` no bucket so gastaria cota. */
export async function uploadScratch(sessionId: string): Promise<void> {
  if (!supabase || !userId) return
  const path = objectPath(userId, sessionId)
  const map = loadScratch(sessionId)
  if (Object.keys(map).length === 0) {
    await supabase.storage.from(BUCKET).remove([path])
    return
  }
  const body = new Blob([JSON.stringify(map)], { type: 'application/json' })
  await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: 'application/json',
  })
}

/** Busca sob demanda, ao abrir uma prova cujo rascunho nao existe aqui. Baixar
 * tudo no login custaria megabytes que quase nunca serao olhados.
 *
 * Retorna null quando ja existe rascunho local (nada a fazer) ou quando o
 * objeto nao existe no servidor -- em nenhum dos dois casos a tela muda. */
export async function fetchScratch(sessionId: string): Promise<Record<string, Scratch> | null> {
  if (!supabase || !userId) return null
  if (Object.keys(loadScratch(sessionId)).length > 0) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(userId, sessionId))
  if (error || !data) return null
  try {
    const map = JSON.parse(await data.text()) as Record<string, Scratch>
    applyRemoteScratch(sessionId, map)
    return map
  } catch {
    return null
  }
}

export async function deleteRemoteScratch(sessionId: string): Promise<void> {
  if (!supabase || !userId) return
  const timer = timers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(sessionId)
  }
  await supabase.storage.from(BUCKET).remove([objectPath(userId, sessionId)])
}

/** Usado pelo "Resetar tudo": apaga a pasta inteira do usuario. */
export async function wipeRemoteScratch(): Promise<void> {
  if (!supabase || !userId) return
  cancelAll()
  const { data } = await supabase.storage.from(BUCKET).list(userId)
  if (!data || data.length === 0) return
  await supabase.storage.from(BUCKET).remove(data.map((f) => `${userId}/${f.name}`))
}
