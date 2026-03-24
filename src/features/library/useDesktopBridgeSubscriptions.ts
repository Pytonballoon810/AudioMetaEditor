import { useEffect } from 'react';
import type { ApiLogPayload, AudioMetaApi } from '../../ipc/contracts';
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE } from '../../services/audioMetaApi';

type UseDesktopBridgeSubscriptionsArgs = {
  audioMetaApi: AudioMetaApi | undefined;
  loadPaths: (paths: string[], preferredActivePath?: string | null) => Promise<void>;
  setStatus: (message: string) => void;
};

export function useDesktopBridgeSubscriptions({
  audioMetaApi,
  loadPaths,
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
}
