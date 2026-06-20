/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_CLIENT_ID?: string;
  readonly VITE_AUTH_AUTHORITY?: string;
  readonly VITE_AUTH_SCOPE?: string;
  readonly VITE_AUTH_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
