import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ApiLogPayload, AudioMetaApi, LibraryProgressPayload } from '../../ipc/contracts';
import type { AudioLibraryItem } from '../../types';
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE } from '../../services/audioMetaApi';

type UseDesktopBridgeSubscriptionsArgs = {
  audioMetaApi: AudioMetaApi | undefined;
  loadPaths: (paths: string[], preferredActivePath?: string | null) => Promise<void>;
  setLibrary: Dispatch<SetStateAction<AudioLibraryItem[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setLibraryWidth: (width: number) => void;
  estimateLibraryWidthForItems: (items: AudioLibraryItem[]) => number;
  setStatus: (message: string) => void;
};

export function useDesktopBridgeSubscriptions({
  audioMetaApi,
  loadPaths,
  setLibrary,
  setActivePath,
  setLibraryWidth,
  estimateLibraryWidthForItems,
  setStatus,
}: UseDesktopBridgeSubscriptionsArgs) {
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
    });

    return dispose;
  }, [audioMetaApi, setStatus]);

  useEffect(() => {
    if (!audioMetaApi?.onLibraryProgress) {
      return;
    }

    const dispose = audioMetaApi.onLibraryProgress((payload: LibraryProgressPayload) => {
      setLibrary(payload.items);
      setLibraryWidth(estimateLibraryWidthForItems(payload.items));
      setActivePath((current) => {
        if (current && payload.items.some((item) => item.path === current)) {
          return current;
        }

        return payload.items[0]?.path ?? null;
      });
      setStatus(`Scanning audio files... ${payload.loaded}/${payload.total}`);
    });

    return dispose;
  }, [audioMetaApi, estimateLibraryWidthForItems, setActivePath, setLibrary, setLibraryWidth, setStatus]);
}
