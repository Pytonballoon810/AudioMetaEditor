import type { AudioMetaApi } from '../ipc/contracts';

export const DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE =
  'Desktop bridge is unavailable. Restart the app to reload the preload script.';

export function getAudioMetaApi(): AudioMetaApi | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as Window & { audioMetaApi?: AudioMetaApi }).audioMetaApi;
}

export function requireAudioMetaApi(): AudioMetaApi {
  const api = getAudioMetaApi();
  if (!api) {
    throw new Error(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE);
  }

  return api;
}
