const IS_PERF_ENABLED = import.meta.env.DEV;

type PerformanceMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
};

function getPerformanceMemory(): PerformanceMemory | null {
  if (typeof performance === 'undefined') {
    return null;
  }

  const maybeMemory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!maybeMemory) {
    return null;
  }

  if (
    typeof maybeMemory.usedJSHeapSize !== 'number' ||
    typeof maybeMemory.jsHeapSizeLimit !== 'number' ||
    maybeMemory.jsHeapSizeLimit <= 0
  ) {
    return null;
  }

  return maybeMemory;
}

export function startPerfTimer(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function endPerfTimer(label: string, startedAt: number): number {
  if (!IS_PERF_ENABLED) {
    return 0;
  }

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, finishedAt - startedAt);
  console.info(`[perf] ${label}: ${durationMs.toFixed(1)}ms`);
  return durationMs;
}

export function logMemorySnapshot(label: string) {
  if (!IS_PERF_ENABLED) {
    return;
  }

  const memory = getPerformanceMemory();
  if (!memory) {
    return;
  }

  const usedMb = memory.usedJSHeapSize / (1024 * 1024);
  const limitMb = memory.jsHeapSizeLimit / (1024 * 1024);
  const usagePercent = (usedMb / limitMb) * 100;

  console.info(
    `[perf] memory:${label} used=${usedMb.toFixed(1)}MB limit=${limitMb.toFixed(1)}MB (${usagePercent.toFixed(1)}%)`,
  );
}
