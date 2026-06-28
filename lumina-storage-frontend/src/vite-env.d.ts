/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PREFIX: string;
  readonly VITE_SSO_SERVICE_URL?: string;
  readonly VITE_SSO_AUTO_REDIRECT?: string;
  readonly VITE_SSO_APP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "*.csv" {
  const content: string;
  export default content;
}
