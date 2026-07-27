/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Ausentes no build publico ate que os segredos existam: sem elas o site
   * roda em modo local, sem login e sem sincronia. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
