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

const MAX_AUDIO_BLOB_CACHE_ENTRIES = 24;
const audioBlobCache = new Map<string, string>();
const inflightAudioBlobLoads = new Map<string, Promise<string>>();

function setCachedAudioBlob(filePath: string, dataUrl: string) {
  if (audioBlobCache.has(filePath)) {
    audioBlobCache.delete(filePath);
  }

  audioBlobCache.set(filePath, dataUrl);

  if (audioBlobCache.size > MAX_AUDIO_BLOB_CACHE_ENTRIES) {
    const oldestKey = audioBlobCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      audioBlobCache.delete(oldestKey);
    }
  }
}

export function getCachedAudioBlob(filePath: string) {
  const cached = audioBlobCache.get(filePath);
  if (!cached) {
    return null;
  }

  // Refresh recency for LRU behavior.
  audioBlobCache.delete(filePath);
  audioBlobCache.set(filePath, cached);
  return cached;
}

export async function preloadAudioBlob(filePath: string) {
  const cached = getCachedAudioBlob(filePath);
  if (cached) {
    return cached;
  }

  const inflight = inflightAudioBlobLoads.get(filePath);
  if (inflight) {
    return inflight;
  }

  const loadPromise = requireAudioMetaApi()
    .loadAudioBlob(filePath)
    .then((dataUrl) => {
      setCachedAudioBlob(filePath, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      inflightAudioBlobLoads.delete(filePath);
    });

  inflightAudioBlobLoads.set(filePath, loadPromise);
  return loadPromise;
}
