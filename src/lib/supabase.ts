import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url: string = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** Portao de tudo que depende de rede. O site publicado e construido sem estas
 * variaveis ate os segredos existirem no GitHub, e nesse estado ele tem que
 * funcionar exatamente como antes: sem login, sem erro no console, offline
 * inteiro. Todo caminho de sincronia fecha por aqui.
 *
 * A chave anonima ser publica nao e descuido: ela vai no bundle JavaScript de
 * qualquer forma. Quem protege os dados e o RLS, nao o segredo da chave. */
export function isSyncConfigured(): boolean {
  return url.length > 0 && anonKey.length > 0
}

export const supabase: SupabaseClient | null = isSyncConfigured()
  ? createClient(url, anonKey, {
      auth: {
        /* O app usa HashRouter. O fluxo implicito devolveria os tokens no
           fragmento (#access_token=...), que o roteador tentaria interpretar
           como rota. O PKCE devolve ?code=... na query string e nao encosta no
           fragmento. */
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/** Para onde o link do e-mail deve voltar. Bate com as URLs cadastradas em
 * Authentication -> URL Configuration, tanto em producao quanto no dev local,
 * porque `BASE_URL` ja carrega o /poscomp-simulado/. */
export function redirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}
