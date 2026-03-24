/// <reference types="vite/client" />

import type { AudioMetaApi } from './ipc/contracts';

declare global {
  interface Window {
    audioMetaApi: AudioMetaApi;
  }
}

export {};
