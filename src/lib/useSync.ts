import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync, type SyncState } from './sync'

/** O estado da sincronia vive fora do React (o motor roda em modulo, nao em
 * componente). useSyncExternalStore e o jeito de ler isso sem duplicar a
 * verdade num useState que precisaria ser mantido em dia na mao. */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}
