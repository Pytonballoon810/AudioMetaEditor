import { useEffect, useRef } from 'react';

const LAST_OPENED_PATHS_KEY = 'audioMetaEditor:lastOpenedPaths';
const LAST_ACTIVE_PATH_KEY = 'audioMetaEditor:lastActivePath';

type UseSessionRestoreArgs = {
  activePath: string | null;
  loadPaths: (paths: string[], preferredActivePath?: string | null) => Promise<void>;
};

export function useSessionRestore({ activePath, loadPaths }: UseSessionRestoreArgs) {
  const restoredSessionRef = useRef(false);

  useEffect(() => {
    if (restoredSessionRef.current) {
      return;
    }

    restoredSessionRef.current = true;

    const rawPaths = localStorage.getItem(LAST_OPENED_PATHS_KEY);
    if (!rawPaths) {
      return;
    }

    try {
      const parsed = JSON.parse(rawPaths);
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
        return;
      }

      const savedActivePath = localStorage.getItem(LAST_ACTIVE_PATH_KEY);
      void loadPaths(parsed, savedActivePath);
    } catch {
      // Ignore malformed persisted values.
    }
  }, [loadPaths]);

  useEffect(() => {
    if (activePath) {
      localStorage.setItem(LAST_ACTIVE_PATH_KEY, activePath);
    }
  }, [activePath]);
}
