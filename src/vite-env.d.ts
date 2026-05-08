/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSWORD: string
  readonly VITE_POSTHOG_KEY: string
  readonly VITE_POSTHOG_DISABLED: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
