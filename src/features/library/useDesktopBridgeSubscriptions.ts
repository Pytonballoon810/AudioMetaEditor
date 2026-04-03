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

function albumCoverGroupKey(item: AudioLibraryItem) {
  const normalizedDirectory = normalizePathForComparison(item.directory);
  const normalizedAlbum = (item.metadata.album || '').trim().toLowerCase();
  return `${normalizedDirectory}::${normalizedAlbum}`;
}

function removeLibraryPaths(items: AudioLibraryItem[], removedPaths: string[]) {
  if (removedPaths.length === 0) {
    return items;
  }

  let nextItems = [...items];

  for (const removedPath of removedPaths) {
    const normalizedRemovedPath = normalizePathForComparison(removedPath);
    const { found, index } = findItemIndexByPath(nextItems, normalizedRemovedPath);
    if (found) {
      nextItems.splice(index, 1);
      continue;
    }

    // Fallback for uncommon watcher payloads that reference a parent path.
    nextItems = nextItems.filter((item) => !isSameOrChildPath(item.path, removedPath));
  }

  return nextItems;
}

function findItemIndexByPath(items: AudioLibraryItem[], normalizedTargetPath: string) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midItem = items[mid];
    const midNormalizedPath = midItem ? normalizePathForComparison(midItem.path) : '';

    if (midNormalizedPath === normalizedTargetPath) {
      return { found: true, index: mid };
    }

    if (!midItem || midNormalizedPath < normalizedTargetPath) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return { found: false, index: low };
}

function mergeIncrementalItems(items: AudioLibraryItem[], incomingItems: AudioLibraryItem[], loadedSourcePaths: string[]) {
  if (incomingItems.length === 0) {
    return items;
  }

  const merged = [...items];
  const canonicalCoverByAlbum = new Map<string, string>();

  for (const item of merged) {
    const coverArt = item.metadata.coverArt;
    if (!coverArt) {
      continue;
    }

    const key = albumCoverGroupKey(item);
    if (!canonicalCoverByAlbum.has(key)) {
      canonicalCoverByAlbum.set(key, coverArt);
    }
  }

  for (const incomingItem of incomingItems) {
    const inferredRoot = incomingItem.openedDirectoryRoot || inferOpenedDirectoryRoot(incomingItem.path, loadedSourcePaths);
    let nextItem = inferredRoot
      ? {
          ...incomingItem,
          openedDirectoryRoot: inferredRoot,
          isInOpenedDirectoryRoot: isSamePath(incomingItem.directory, inferredRoot),
        }
      : incomingItem;

    const albumKey = albumCoverGroupKey(nextItem);
    const canonicalCover = canonicalCoverByAlbum.get(albumKey);
    if (canonicalCover && nextItem.metadata.coverArt && nextItem.metadata.coverArt !== canonicalCover) {
      nextItem = {
        ...nextItem,
        metadata: {
          ...nextItem.metadata,
          coverArt: canonicalCover,
        },
      };
    } else if (!canonicalCover && nextItem.metadata.coverArt) {
      canonicalCoverByAlbum.set(albumKey, nextItem.metadata.coverArt);
    }

    const normalizedPath = normalizePathForComparison(nextItem.path);
    const { found, index } = findItemIndexByPath(merged, normalizedPath);
    if (found) {
      merged[index] = nextItem;
      continue;
    }

    merged.splice(index, 0, nextItem);
  }

  return merged;
}

function findLoadedItemPath(items: AudioLibraryItem[], pathValue: string) {
  const match = items.find((item) => isSamePath(item.path, pathValue) && item.isMetadataLoaded);
  return match?.path ?? null;
}

function pickRelevantActivePath(
  previousLibrary: AudioLibraryItem[],
  nextLibrary: AudioLibraryItem[],
  currentActivePath: string | null,
) {
  if (!currentActivePath) {
    return nextLibrary.find((item) => item.isMetadataLoaded)?.path ?? null;
  }

  const persistedActivePath = findLoadedItemPath(nextLibrary, currentActivePath);
  if (persistedActivePath) {
    return persistedActivePath;
  }

  const previousIndex = previousLibrary.findIndex((item) => isSamePath(item.path, currentActivePath));
  if (previousIndex >= 0) {
    const aboveItem = previousLibrary[previousIndex - 1];
    if (aboveItem) {
      const abovePath = findLoadedItemPath(nextLibrary, aboveItem.path);
      if (abovePath) {
        return abovePath;
      }
    }

    const belowItem = previousLibrary[previousIndex + 1];
    if (belowItem) {
      const belowPath = findLoadedItemPath(nextLibrary, belowItem.path);
      if (belowPath) {
        return belowPath;
      }
    }

    const nearestByIndex = nextLibrary[Math.min(previousIndex, Math.max(0, nextLibrary.length - 1))];
    if (nearestByIndex?.isMetadataLoaded) {
      return nearestByIndex.path;
    }
  }

  return nextLibrary.find((item) => item.isMetadataLoaded)?.path ?? null;
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
            const previousLibrary = libraryRef.current;
            const previousActivePath = activePathRef.current;
            let nextLibrary = removeLibraryPaths(previousLibrary, removedPaths);
            const pathsToRefresh = uniquePaths([...addedPaths, ...changedPaths]);

            if (pathsToRefresh.length > 0) {
              if (!audioMetaApi.loadLibraryIncremental) {
                setStatus('Incremental library refresh is unavailable. Restart the app to apply file updates without full reindexing.');
                continue;
              }

              const refreshedItems = await audioMetaApi.loadLibraryIncremental(pathsToRefresh);
              nextLibrary = mergeIncrementalItems(nextLibrary, refreshedItems, loadedSourcePathsRef.current);
            }

            const nextActivePath = pickRelevantActivePath(previousLibrary, nextLibrary, previousActivePath);
            const previousActiveStillExists = previousActivePath
              ? Boolean(findLoadedItemPath(nextLibrary, previousActivePath))
              : false;
            const didReplaceRemovedActivePath = Boolean(previousActivePath) && !previousActiveStillExists && Boolean(nextActivePath);
            const didClearRemovedActivePath = Boolean(previousActivePath) && !previousActiveStillExists && !nextActivePath;

            libraryRef.current = nextLibrary;
            setLibrary(nextLibrary);
            setActivePath(nextActivePath);
            activePathRef.current = nextActivePath;

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
                ? didReplaceRemovedActivePath
                  ? `Applied incremental library update (${summaryParts.join(' ')}). Selected track was removed, so focus moved to a nearby track.`
                  : didClearRemovedActivePath
                    ? `Applied incremental library update (${summaryParts.join(' ')}). Selected track was removed, so no track is selected.`
                  : `Applied incremental library update (${summaryParts.join(' ')}).`
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

  }, [audioMetaApi, estimateLibraryWidthForItems, setActivePath, setLibrary, setLibraryWidth, setStatus]);
}
