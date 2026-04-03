import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { AudioLibraryItem } from '../../types';
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE, getAudioMetaApi } from '../../services/audioMetaApi';
import { toUserErrorMessage } from '../../lib/errors';
import { endPerfTimer, logMemorySnapshot, startPerfTimer } from '../../lib/performance';

type UseLibraryStateArgs = {
  setStatus: (message: string) => void;
};

const MIN_LIBRARY_WIDTH = 280;
const MAX_LIBRARY_WIDTH = 720;
const LAST_OPENED_PATHS_KEY = 'audioMetaEditor:lastOpenedPaths';
const LAST_ACTIVE_PATH_KEY = 'audioMetaEditor:lastActivePath';
const LAYOUT_LIBRARY_WIDTH_KEY = 'audioMetaEditor:layout:libraryWidth';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateLibraryWidth(items: AudioLibraryItem[]) {
  if (!items.length || typeof document === 'undefined') {
    return 320;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return 320;
  }

  context.font = '600 16px "Space Grotesk", "Segoe UI", sans-serif';
  const longestTitle = items.reduce((max, item) => {
    const title = item.metadata.title || item.name;
    return Math.max(max, context.measureText(title).width);
  }, 0);

  context.font = '400 14px "Space Grotesk", "Segoe UI", sans-serif';
  const longestArtist = items.reduce((max, item) => {
    const artist = item.metadata.artist || 'Unknown artist';
    return Math.max(max, context.measureText(artist).width);
  }, 0);

  const leftColumnWidth = Math.max(longestTitle, longestArtist);
  const rightMetaWidth = 84;
  const buttonPaddingAndGap = 56;
  const listPadding = 40;
  const headingPadding = 16;
  const estimated = leftColumnWidth + rightMetaWidth + buttonPaddingAndGap + listPadding + headingPadding;

  return clamp(Math.ceil(estimated), 320, MAX_LIBRARY_WIDTH);
}

function readStoredLibraryWidth() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(LAYOUT_LIBRARY_WIDTH_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clamp(Math.round(parsed), MIN_LIBRARY_WIDTH, MAX_LIBRARY_WIDTH);
}

export function useLibraryState({ setStatus }: UseLibraryStateArgs) {
  const [library, setLibrary] = useState<AudioLibraryItem[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadedSourcePaths, setLoadedSourcePaths] = useState<string[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const initialLibraryWidthRef = useRef<number | null>(readStoredLibraryWidth());
  const hasUserLayoutPreferenceRef = useRef(initialLibraryWidthRef.current !== null);
  const [libraryWidth, setLibraryWidth] = useState(initialLibraryWidthRef.current ?? 320);
  const [isLibraryResizing, setIsLibraryResizing] = useState(false);
  const layoutRef = useRef<HTMLElement | null>(null);
  const isLoadingLibraryRef = useRef(false);
  const activeLoadSignatureRef = useRef<string | null>(null);
  const inFlightLoadPromiseRef = useRef<Promise<void> | null>(null);
  const queuedLoadRequestRef = useRef<{ paths: string[]; preferredActivePath: string | null; signature: string } | null>(
    null,
  );
  const audioMetaApi = getAudioMetaApi();

  useEffect(() => {
    isLoadingLibraryRef.current = isLoadingLibrary;
  }, [isLoadingLibrary]);

  const runLibraryLoad = useCallback(
    async (paths: string[], preferredActivePath?: string | null) => {
      if (!audioMetaApi?.loadLibrary) {
        setStatus(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE);
        return;
      }

      setIsLoadingLibrary(true);
      setStatus('Scanning audio files...');
      const loadStartedAt = startPerfTimer();
      logMemorySnapshot('library:load:start');

      try {
        const items = await audioMetaApi.loadLibrary(paths);
        const preferredExists = preferredActivePath && items.some((item) => item.path === preferredActivePath);
        const nextActivePath = preferredExists ? preferredActivePath : (items.find((item) => item.isMetadataLoaded)?.path ?? null);

        setLibrary(items);
        setLoadedSourcePaths(paths);
        if (!hasUserLayoutPreferenceRef.current) {
          setLibraryWidth(estimateLibraryWidth(items));
        }
        setActivePath(nextActivePath);
        setStatus(
          items.length > 0
            ? `Loaded ${items.length} audio file${items.length === 1 ? '' : 's'}.`
            : 'No supported files were found.',
        );

        localStorage.setItem(LAST_OPENED_PATHS_KEY, JSON.stringify(paths));
        if (nextActivePath) {
          localStorage.setItem(LAST_ACTIVE_PATH_KEY, nextActivePath);
        }

        endPerfTimer('library:load', loadStartedAt);
        logMemorySnapshot('library:load:end');
      } catch (error) {
        endPerfTimer('library:load:error', loadStartedAt);
        logMemorySnapshot('library:load:error');
        setStatus(toUserErrorMessage(error, 'Unable to load the selected paths.'));
      } finally {
        setIsLoadingLibrary(false);
      }
    },
    [audioMetaApi, setStatus],
  );

  const loadPaths = useCallback(
    async (paths: string[], preferredActivePath?: string | null) => {
      if (paths.length === 0) {
        return;
      }

      if (!audioMetaApi?.loadLibrary) {
        setStatus(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE);
        return;
      }

      const signature = JSON.stringify({ paths, preferredActivePath: preferredActivePath ?? null });

      if (isLoadingLibraryRef.current) {
        if (activeLoadSignatureRef.current === signature && inFlightLoadPromiseRef.current) {
          return inFlightLoadPromiseRef.current;
        }

        queuedLoadRequestRef.current = {
          paths: [...paths],
          preferredActivePath: preferredActivePath ?? null,
          signature,
        };
        return inFlightLoadPromiseRef.current ?? Promise.resolve();
      }

      activeLoadSignatureRef.current = signature;

      const inFlightPromise = runLibraryLoad(paths, preferredActivePath)
        .finally(() => {
          inFlightLoadPromiseRef.current = null;
          activeLoadSignatureRef.current = null;
        })
        .then(async () => {
          const queued = queuedLoadRequestRef.current;
          queuedLoadRequestRef.current = null;
          if (!queued || queued.signature === signature) {
            return;
          }

          await loadPaths(queued.paths, queued.preferredActivePath);
        });

      inFlightLoadPromiseRef.current = inFlightPromise;
      return inFlightPromise;
    },
    [audioMetaApi, runLibraryLoad, setStatus],
  );

  const startLibraryResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    hasUserLayoutPreferenceRef.current = true;
    setIsLibraryResizing(true);
  }, []);

  const resetLibraryWidth = useCallback(() => {
    hasUserLayoutPreferenceRef.current = true;
    setLibraryWidth(estimateLibraryWidth(library));
  }, [library]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LAYOUT_LIBRARY_WIDTH_KEY, String(Math.round(libraryWidth)));
  }, [libraryWidth]);

  useEffect(() => {
    if (!isLibraryResizing) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }

      const bounds = layout.getBoundingClientRect();
      const maxByViewport = Math.max(MIN_LIBRARY_WIDTH, bounds.width - 540);
      const maxWidth = Math.min(MAX_LIBRARY_WIDTH, maxByViewport);
      const nextWidth = clamp(event.clientX - bounds.left, MIN_LIBRARY_WIDTH, maxWidth);
      setLibraryWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsLibraryResizing(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isLibraryResizing]);

  const layoutStyle = useMemo(
    () =>
      ({
        '--library-width': `${libraryWidth}px`,
      }) as CSSProperties,
    [libraryWidth],
  );

  return {
    audioMetaApi,
    library,
    setLibrary,
    activePath,
    setActivePath,
    loadedSourcePaths,
    setLoadedSourcePaths,
    isLoadingLibrary,
    libraryWidth,
    setLibraryWidth,
    isLibraryResizing,
    layoutRef,
    layoutStyle,
    loadPaths,
    startLibraryResize,
    resetLibraryWidth,
    estimateLibraryWidthForItems: estimateLibraryWidth,
  };
}
