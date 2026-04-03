import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ApiLogPayload, AudioMetaApi, LibraryChangedPayload, LibraryProgressPayload } from '../../ipc/contracts';
import type { AudioLibraryItem } from '../../types';
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE } from '../../services/audioMetaApi';
import { toUserErrorMessage } from '../../lib/errors';

type UseDesktopBridgeSubscriptionsArgs = {
  audioMetaApi: AudioMetaApi | undefined;
  library: AudioLibraryItem[];
  loadPaths: (paths: string[], preferredActivePath?: string | null) => Promise<void>;
  loadedSourcePaths: string[];
  activePath: string | null;
  isLoadingLibrary: boolean;
  setLibrary: Dispatch<SetStateAction<AudioLibraryItem[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setLibraryWidth: (width: number) => void;
  estimateLibraryWidthForItems: (items: AudioLibraryItem[]) => number;
  setStatus: (message: string) => void;
  onApiLogPayload?: (payload: ApiLogPayload) => void;
  onLibraryProgressPayload?: (payload: LibraryProgressPayload) => void;
};

function normalizePathForComparison(pathValue: string) {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function isSamePath(leftPath: string, rightPath: string) {
  return normalizePathForComparison(leftPath) === normalizePathForComparison(rightPath);
}

function isSameOrChildPath(candidatePath: string, maybeParentPath: string) {
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  const normalizedParent = normalizePathForComparison(maybeParentPath);

  if (!normalizedCandidate || !normalizedParent) {
    return false;
  }

  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function uniquePaths(paths: string[]) {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const rawPath of paths) {
    const pathValue = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!pathValue) {
      continue;
    }

    const normalized = normalizePathForComparison(pathValue);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(pathValue);
  }

  return unique;
}

function inferOpenedDirectoryRoot(filePath: string, loadedSourcePaths: string[]) {
  const matchingRoots = loadedSourcePaths.filter((sourcePath) => {
    const normalizedSource = normalizePathForComparison(sourcePath);
    const normalizedFile = normalizePathForComparison(filePath);

    if (!normalizedSource || !normalizedFile || normalizedSource === normalizedFile) {
      return false;
    }

    return normalizedFile.startsWith(`${normalizedSource}/`);
  });

  if (matchingRoots.length === 0) {
    return null;
  }

  return matchingRoots.sort((left, right) => right.length - left.length)[0] ?? null;
}

function removeLibraryPaths(items: AudioLibraryItem[], removedPaths: string[]) {
  if (removedPaths.length === 0) {
    return items;
  }

  return items.filter((item) => !removedPaths.some((removedPath) => isSameOrChildPath(item.path, removedPath)));
}

function mergeIncrementalItems(items: AudioLibraryItem[], incomingItems: AudioLibraryItem[], loadedSourcePaths: string[]) {
  if (incomingItems.length === 0) {
    return items;
  }

  const merged = new Map<string, AudioLibraryItem>();

  for (const item of items) {
    merged.set(normalizePathForComparison(item.path), item);
  }

  for (const incomingItem of incomingItems) {
    const inferredRoot = incomingItem.openedDirectoryRoot || inferOpenedDirectoryRoot(incomingItem.path, loadedSourcePaths);
    const nextItem = inferredRoot
      ? {
          ...incomingItem,
          openedDirectoryRoot: inferredRoot,
          isInOpenedDirectoryRoot: isSamePath(incomingItem.directory, inferredRoot),
        }
      : incomingItem;

    merged.set(normalizePathForComparison(nextItem.path), nextItem);
  }

  return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
}

export function useDesktopBridgeSubscriptions({
  audioMetaApi,
  library,
  loadPaths,
  loadedSourcePaths,
  activePath,
  isLoadingLibrary,
  setLibrary,
  setActivePath,
  setLibraryWidth,
  estimateLibraryWidthForItems,
  setStatus,
  onApiLogPayload,
  onLibraryProgressPayload,
}: UseDesktopBridgeSubscriptionsArgs) {
  const libraryRef = useRef(library);
  const loadedSourcePathsRef = useRef(loadedSourcePaths);
  const activePathRef = useRef(activePath);
  const isLoadingLibraryRef = useRef(isLoadingLibrary);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    loadedSourcePathsRef.current = loadedSourcePaths;
  }, [loadedSourcePaths]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    isLoadingLibraryRef.current = isLoadingLibrary;
  }, [isLoadingLibrary]);

  useEffect(() => {
    if (!audioMetaApi?.onOpenPaths) {
      setStatus(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE);
      return;
    }

    const dispose = audioMetaApi.onOpenPaths((paths: string[]) => {
      void loadPaths(paths);
    });

    return dispose;
  }, [audioMetaApi, loadPaths, setStatus]);

  useEffect(() => {
    if (!audioMetaApi?.onApiLog) {
      return;
    }

    const dispose = audioMetaApi.onApiLog((payload: ApiLogPayload) => {
      setStatus(payload.message);
      onApiLogPayload?.(payload);
    });

    return dispose;
  }, [audioMetaApi, onApiLogPayload, setStatus]);

  useEffect(() => {
    if (!audioMetaApi?.onLibraryProgress) {
      return;
    }

    const dispose = audioMetaApi.onLibraryProgress((payload: LibraryProgressPayload) => {
      const phase = payload.phase ?? 'indexing';
      onLibraryProgressPayload?.(payload);

      setLibrary(payload.items);
      setLibraryWidth(estimateLibraryWidthForItems(payload.items));
      setActivePath((current) => {
        if (current && payload.items.some((item) => item.path === current && item.isMetadataLoaded)) {
          return current;
        }

        return payload.items.find((item) => item.isMetadataLoaded)?.path ?? null;
      });

      if (phase === 'discovering') {
        setStatus(`Discovered ${payload.total} track(s). Preparing index...`);
        return;
      }

      setStatus(`Indexing track metadata... ${payload.loaded}/${payload.total}`);
    });

    return dispose;
  }, [
    audioMetaApi,
    estimateLibraryWidthForItems,
    onLibraryProgressPayload,
    setActivePath,
    setLibrary,
    setLibraryWidth,
    setStatus,
  ]);

  useEffect(() => {
    if (!audioMetaApi?.onLibraryChanged) {
      return;
    }

    const queuedPayloads: LibraryChangedPayload[] = [];
    let isApplyingChanges = false;
    let isDisposed = false;

    const applyQueuedChanges = async () => {
      if (isApplyingChanges || isDisposed || queuedPayloads.length === 0) {
        return;
      }

      isApplyingChanges = true;

      try {
        while (!isDisposed && queuedPayloads.length > 0) {
          const nextBatch = queuedPayloads.splice(0, queuedPayloads.length);
          const addedPaths = uniquePaths(nextBatch.flatMap((payload) => payload.addedPaths ?? []));
          const removedPaths = uniquePaths(nextBatch.flatMap((payload) => payload.removedPaths ?? []));
          const changedPaths = uniquePaths(nextBatch.flatMap((payload) => payload.changedPaths ?? []));

          // Backward-compatible fallback when older payload shape is received.
          if (addedPaths.length === 0 && removedPaths.length === 0 && changedPaths.length === 0) {
            const fallbackChangedPaths = uniquePaths(nextBatch.map((payload) => payload.changedPath));
            changedPaths.push(...fallbackChangedPaths);
          }

          if (addedPaths.length === 0 && removedPaths.length === 0 && changedPaths.length === 0) {
            continue;
          }

          try {
            let nextLibrary = removeLibraryPaths(libraryRef.current, removedPaths);
            const pathsToRefresh = uniquePaths([...addedPaths, ...changedPaths]);

            if (pathsToRefresh.length > 0) {
              if (!audioMetaApi.loadLibraryIncremental) {
                setStatus(`Detected library file changes at ${nextBatch[0]?.changedPath || '(unknown path)'}. Refreshing...`);
                await loadPaths(loadedSourcePathsRef.current, activePathRef.current);
                continue;
              }

              const refreshedItems = await audioMetaApi.loadLibraryIncremental(pathsToRefresh);
              nextLibrary = mergeIncrementalItems(nextLibrary, refreshedItems, loadedSourcePathsRef.current);
            }

            libraryRef.current = nextLibrary;
            setLibrary(nextLibrary);
            setLibraryWidth(estimateLibraryWidthForItems(nextLibrary));
            setActivePath((currentPath) => {
              if (currentPath && nextLibrary.some((item) => item.path === currentPath && item.isMetadataLoaded)) {
                return currentPath;
              }

              return nextLibrary.find((item) => item.isMetadataLoaded)?.path ?? null;
            });

            const summaryParts: string[] = [];
            if (addedPaths.length > 0) {
              summaryParts.push(`+${addedPaths.length}`);
            }
            if (removedPaths.length > 0) {
              summaryParts.push(`-${removedPaths.length}`);
            }
            if (changedPaths.length > 0) {
              summaryParts.push(`~${changedPaths.length}`);
            }

            setStatus(
              summaryParts.length > 0
                ? `Applied incremental library update (${summaryParts.join(' ')}).`
                : 'Applied incremental library update.',
            );
          } catch (error) {
            setStatus(toUserErrorMessage(error, 'Unable to apply incremental library update.'));
          }
        }
      } finally {
        isApplyingChanges = false;
      }
    };

    const dispose = audioMetaApi.onLibraryChanged((payload: LibraryChangedPayload) => {
      if (loadedSourcePathsRef.current.length === 0 || isLoadingLibraryRef.current) {
        return;
      }

      queuedPayloads.push(payload);
      void applyQueuedChanges();
    });

    return () => {
      isDisposed = true;
      dispose();
    };

  }, [audioMetaApi, estimateLibraryWidthForItems, loadPaths, setActivePath, setLibrary, setLibraryWidth, setStatus]);
}
