import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
import { getCachedAudioBlob, preloadAudioBlob } from '../services/audioMetaApi';
import { endPerfTimer, logMemorySnapshot, startPerfTimer } from '../lib/performance';

const IS_DEV = import.meta.env.DEV;

function debugLog(...args: unknown[]) {
  if (IS_DEV) {
    console.log(...args);
  }
}

function isAbortLikeError(error: unknown) {
  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const name = error instanceof Error ? error.name.toLowerCase() : '';

  return name.includes('abort') || lower.includes('abort');
}

function isTransientWaveLoadError(error: unknown) {
  if (isAbortLikeError(error)) {
    return true;
  }

  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes('pipeline_error_read') ||
    lower.includes('net::err_file_not_found') ||
    lower.includes('err_file_not_found') ||
    (lower.includes('blob:') && lower.includes('not found'))
  );
}

type UseWaveSurferOptions = {
  audioUrl: string | null;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
};

const ZOOM_STEP_PX_PER_SEC = 20;
const MAX_ZOOM_PX_PER_SEC = 400;
const HORIZONTAL_SCROLL_SENSITIVITY = 1;
const SELECTION_SNAP_TO_PLAYHEAD_SECONDS = 0.12;
const DEFAULT_TIME_RULER_STEP_SECONDS = 5;

function pickTimeRulerStepSeconds(visibleDuration: number) {
  if (visibleDuration <= 45) {
    return 5;
  }

  if (visibleDuration <= 120) {
    return 10;
  }

  if (visibleDuration <= 360) {
    return 30;
  }

  return 60;
}

function applyPersistentScrollbarStyle(waveSurfer: WaveSurfer) {
  const wrapper = (waveSurfer as WaveSurfer & { getWrapper?: () => HTMLElement }).getWrapper?.();
  if (!wrapper) {
    return;
  }

  const root = wrapper.getRootNode();
  if (!(root instanceof ShadowRoot)) {
    return;
  }

  if (!root.getElementById('audio-meta-wave-scrollbar-style')) {
    const style = document.createElement('style');
    style.id = 'audio-meta-wave-scrollbar-style';
    style.textContent = `
      :host .scroll {
        overflow-x: scroll;
        scrollbar-gutter: stable both-edges;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 94, 168, 0.9) rgba(255, 255, 255, 0.08);
      }
      :host .scroll::-webkit-scrollbar {
        height: 11px;
      }
      :host .scroll::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.08);
      }
      :host .scroll::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, rgba(255, 94, 168, 0.92), rgba(117, 201, 255, 0.9));
        border-radius: 999px;
        border: 2px solid rgba(16, 20, 22, 0.85);
      }
    `;
    root.appendChild(style);
  }

  const scrollElement = root.querySelector<HTMLElement>('[part="scroll"]');
  if (scrollElement) {
    scrollElement.style.overflowX = 'scroll';
  }
}

export function useWaveSurfer({ audioUrl, onReady, onTimeUpdate }: UseWaveSurferOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const durationRef = useRef(0);
  const lastLoopAtRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const loadingStartedAtRef = useRef(0);
  const hideSpinnerTimerRef = useRef<number | null>(null);
  const zoomPxPerSecRef = useRef(0);
  const autoScrollEnabledRef = useRef(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(false);
  const [visibleTimeframe, setVisibleTimeframe] = useState({
    start: 0,
    end: 0,
    tickStepSeconds: DEFAULT_TIME_RULER_STEP_SECONDS,
  });

  function clearWaveform(waveSurfer: WaveSurfer) {
    (waveSurfer as WaveSurfer & { empty?: () => void }).empty?.();
  }

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const containerElement = containerRef.current;

    const regionsPlugin = RegionsPlugin.create();
    regionsPluginRef.current = regionsPlugin;

    const waveSurfer = WaveSurfer.create({
      container: containerElement,
      height: 240,
      waveColor: '#6eb6ff',
      progressColor: '#ff5ea8',
      cursorColor: '#f4f1de',
      barGap: 2,
      barWidth: 2,
      barRadius: 999,
      normalize: true,
      dragToSeek: true,
      autoScroll: autoScrollEnabledRef.current,
      autoCenter: autoScrollEnabledRef.current,
      plugins: [regionsPlugin],
    });

    waveSurferRef.current = waveSurfer;
    applyPersistentScrollbarStyle(waveSurfer);

    const updateVisibleTimeframe = () => {
      if (waveSurferRef.current !== waveSurfer) {
        return;
      }

      const duration = durationRef.current;
      if (duration <= 0) {
        setVisibleTimeframe({
          start: 0,
          end: 0,
          tickStepSeconds: DEFAULT_TIME_RULER_STEP_SECONDS,
        });
        return;
      }

      const scrollAwareWaveSurfer = waveSurfer as WaveSurfer & {
        getScroll?: () => number;
        getWidth?: () => number;
      };

      const zoomPxPerSec = zoomPxPerSecRef.current;
      if (zoomPxPerSec <= 0) {
        setVisibleTimeframe({
          start: 0,
          end: duration,
          tickStepSeconds: pickTimeRulerStepSeconds(duration),
        });
        return;
      }

      const scrollLeft = scrollAwareWaveSurfer.getScroll ? scrollAwareWaveSurfer.getScroll() : 0;
      const viewportWidth = scrollAwareWaveSurfer.getWidth ? scrollAwareWaveSurfer.getWidth() : containerElement.clientWidth;
      const visibleSpan = Math.max(0.01, viewportWidth / zoomPxPerSec);

      let start = Math.max(0, scrollLeft / zoomPxPerSec);
      const end = Math.min(duration, start + visibleSpan);

      if (end - start < visibleSpan) {
        start = Math.max(0, end - visibleSpan);
      }

      setVisibleTimeframe({
        start,
        end,
        tickStepSeconds: pickTimeRulerStepSeconds(Math.max(0.01, end - start)),
      });
    };

    waveSurfer.on('ready', () => {
      if (waveSurferRef.current !== waveSurfer || regionsPluginRef.current !== regionsPlugin) {
        return;
      }

      const duration = waveSurfer.getDuration();
      durationRef.current = duration;
      regionsPlugin.clearRegions();
      try {
        regionsPlugin.addRegion({
          id: 'selection',
          start: 0,
          end: duration,
          drag: true,
          resize: true,
          color: 'rgba(255, 94, 168, 0.2)',
        });
      } catch (error) {
        // Ready can race with teardown on rapid track switches.
        console.warn('[useWaveSurfer] Ignoring stale region initialization:', error);
        return;
      }
      const fullSelection = { start: 0, end: duration };
      selectionRef.current = fullSelection;
      setSelection(fullSelection);
      updateVisibleTimeframe();
      onReady?.(duration);
    });

    waveSurfer.on('error', (error) => {
      if (isTransientWaveLoadError(error)) {
        debugLog('[useWaveSurfer] Ignoring transient waveform source error during reload/switch:', error);
        return;
      }

      console.error('[useWaveSurfer] WaveSurfer error:', error);
    });

    waveSurfer.on('timeupdate', () => {
      const currentTime = waveSurfer.getCurrentTime();
      const { start, end } = selectionRef.current;
      const duration = durationRef.current;
      const epsilon = 0.03;
      const hasPartialSelection = duration > epsilon && start > epsilon && end < duration - epsilon;

      if (hasPartialSelection && end > start + epsilon && currentTime >= end - epsilon) {
        const now = Date.now();
        if (now - lastLoopAtRef.current > 60) {
          lastLoopAtRef.current = now;
          waveSurfer.seekTo(start / duration);
          if (!waveSurfer.isPlaying()) {
            void waveSurfer.play();
          }
          onTimeUpdate?.(start);
          return;
        }
      }

      onTimeUpdate?.(currentTime);
    });

    waveSurfer.on('play', () => setIsPlaying(true));
    waveSurfer.on('pause', () => setIsPlaying(false));
    waveSurfer.on('finish', () => setIsPlaying(false));

    const handleRegionChange = (region: Region) => {
      if (region.id !== 'selection') {
        return;
      }

      const playhead = waveSurfer.getCurrentTime();
      const shouldSnapStart = Math.abs(region.start - playhead) <= SELECTION_SNAP_TO_PLAYHEAD_SECONDS;
      const shouldSnapEnd = Math.abs(region.end - playhead) <= SELECTION_SNAP_TO_PLAYHEAD_SECONDS;

      let nextStart = shouldSnapStart ? playhead : region.start;
      let nextEnd = shouldSnapEnd ? playhead : region.end;

      if (nextEnd < nextStart) {
        const normalizedStart = Math.max(0, nextEnd);
        nextEnd = nextStart;
        nextStart = normalizedStart;
      }

      const hasSnapAdjustment = Math.abs(nextStart - region.start) > 0.0001 || Math.abs(nextEnd - region.end) > 0.0001;
      if (hasSnapAdjustment) {
        try {
          region.setOptions({ start: nextStart, end: nextEnd });
        } catch (error) {
          debugLog('[useWaveSurfer] Ignoring stale region snap update:', error);
        }
      }

      const nextSelection = { start: nextStart, end: nextEnd };
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
    };

    regionsPlugin.on('region-update', handleRegionChange);
    regionsPlugin.on('region-updated', handleRegionChange);
    waveSurfer.on('zoom', updateVisibleTimeframe);
    waveSurfer.on('scroll', updateVisibleTimeframe);

    const handleWheelInteraction = (event: WheelEvent) => {
      if (waveSurferRef.current !== waveSurfer || durationRef.current <= 0) {
        return;
      }

      const hasHorizontalDelta = Math.abs(event.deltaX) > 0.01;
      const useShiftAsHorizontal = !hasHorizontalDelta && event.shiftKey && Math.abs(event.deltaY) > 0.01;
      if (hasHorizontalDelta || useShiftAsHorizontal) {
        const delta = (hasHorizontalDelta ? event.deltaX : event.deltaY) * HORIZONTAL_SCROLL_SENSITIVITY;
        const scrollableWaveSurfer = waveSurfer as WaveSurfer & {
          getScroll?: () => number;
          setScroll?: (value: number) => void;
        };
        if (scrollableWaveSurfer.getScroll && scrollableWaveSurfer.setScroll) {
          event.preventDefault();
          const currentScroll = scrollableWaveSurfer.getScroll();
          const nextScroll = Math.max(0, currentScroll + delta);
          scrollableWaveSurfer.setScroll(nextScroll);
          return;
        }
      }

      if (event.deltaY === 0) {
        return;
      }

      event.preventDefault();

      const direction = event.deltaY < 0 ? 1 : -1;
      const step = event.shiftKey ? ZOOM_STEP_PX_PER_SEC * 2 : ZOOM_STEP_PX_PER_SEC;
      const currentZoom = zoomPxPerSecRef.current;
      let nextZoom = currentZoom + direction * step;

      if (nextZoom < ZOOM_STEP_PX_PER_SEC / 2) {
        nextZoom = 0;
      }

      nextZoom = Math.max(0, Math.min(MAX_ZOOM_PX_PER_SEC, nextZoom));
      zoomPxPerSecRef.current = nextZoom;
      waveSurfer.zoom(nextZoom);
      updateVisibleTimeframe();
    };

    containerElement.addEventListener('wheel', handleWheelInteraction, { passive: false });

    return () => {
      if (hideSpinnerTimerRef.current !== null) {
        window.clearTimeout(hideSpinnerTimerRef.current);
        hideSpinnerTimerRef.current = null;
      }
      containerElement.removeEventListener('wheel', handleWheelInteraction);
      waveSurfer.destroy();
      waveSurferRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [onReady, onTimeUpdate]);

  const reloadWaveformSource = useCallback((sourceUrl: string | null) => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) {
      return;
    }

    loadSequenceRef.current += 1;

    // Clear old waveform immediately when switching tracks.
    clearWaveform(waveSurfer);
    regionsPluginRef.current?.clearRegions();
    waveSurfer.stop();
    waveSurfer.seekTo(0);
    const clearedSelection = { start: 0, end: 0 };
    selectionRef.current = clearedSelection;
    durationRef.current = 0;
    setSelection(clearedSelection);
    setIsPlaying(false);
    setVisibleTimeframe({
      start: 0,
      end: 0,
      tickStepSeconds: DEFAULT_TIME_RULER_STEP_SECONDS,
    });

    if (!sourceUrl) {
      if (hideSpinnerTimerRef.current !== null) {
        window.clearTimeout(hideSpinnerTimerRef.current);
        hideSpinnerTimerRef.current = null;
      }
      setIsWaveformLoading(false);
      return;
    }

    const currentLoadSequence = loadSequenceRef.current;
    if (hideSpinnerTimerRef.current !== null) {
      window.clearTimeout(hideSpinnerTimerRef.current);
      hideSpinnerTimerRef.current = null;
    }
    loadingStartedAtRef.current = Date.now();
    setIsWaveformLoading(true);

    const loadAudio = async () => {
      const loadStartedAt = startPerfTimer();
      logMemorySnapshot('waveform:load:start');

      try {
        debugLog('[useWaveSurfer] Loading audio:', sourceUrl);
        const mediaUrl = getCachedAudioBlob(sourceUrl) || (await preloadAudioBlob(sourceUrl));

        // Abort stale loads as soon as possible (rapid track switching can race here).
        if (currentLoadSequence !== loadSequenceRef.current) {
          debugLog('[useWaveSurfer] Stale preload result after track switch; skipping load');
          return;
        }

        const currentWaveSurfer = waveSurferRef.current;
        if (!currentWaveSurfer) {
          debugLog('[useWaveSurfer] WaveSurfer destroyed before load; skipping');
          return;
        }

        debugLog('[useWaveSurfer] Media URL ready, loading into WaveSurfer');
        await currentWaveSurfer.load(mediaUrl);

        if (currentLoadSequence !== loadSequenceRef.current) {
          return;
        }

        const elapsedMs = Date.now() - loadingStartedAtRef.current;
        const minVisibleMs = 220;
        const hideDelayMs = Math.max(0, minVisibleMs - elapsedMs);
        hideSpinnerTimerRef.current = window.setTimeout(() => {
          if (currentLoadSequence === loadSequenceRef.current) {
            endPerfTimer('waveform:load', loadStartedAt);
            logMemorySnapshot('waveform:load:end');
            setIsWaveformLoading(false);
          }
        }, hideDelayMs);
      } catch (error) {
        if (isTransientWaveLoadError(error)) {
          debugLog('[useWaveSurfer] Ignoring transient waveform load error during switch:', error);
          if (currentLoadSequence === loadSequenceRef.current) {
            setIsWaveformLoading(false);
          }
          return;
        }

        if (currentLoadSequence === loadSequenceRef.current) {
          endPerfTimer('waveform:load:error', loadStartedAt);
          logMemorySnapshot('waveform:load:error');
          setIsWaveformLoading(false);
        }
        console.error('[useWaveSurfer] Failed to load audio:', error);
      }
    };

    void loadAudio();
  }, []);

  useEffect(() => {
    reloadWaveformSource(audioUrl);
  }, [audioUrl, reloadWaveformSource]);

  const toggleAutoScroll = useCallback(() => {
    const nextAutoScroll = !autoScrollEnabledRef.current;
    autoScrollEnabledRef.current = nextAutoScroll;
    setIsAutoScrollEnabled(nextAutoScroll);

    const configurableWaveSurfer = waveSurferRef.current as
      | (WaveSurfer & {
          setOptions?: (options: { autoScroll?: boolean; autoCenter?: boolean }) => void;
        })
      | null;
    configurableWaveSurfer?.setOptions?.({
      autoScroll: nextAutoScroll,
      autoCenter: nextAutoScroll,
    });
  }, []);

  return {
    containerRef,
    isPlaying,
    isWaveformLoading,
    isAutoScrollEnabled,
    visibleTimeframe,
    selection,
    playPause: () => {
      const waveSurfer = waveSurferRef.current;
      if (!waveSurfer) {
        return;
      }

      const duration = durationRef.current;
      const { start, end } = selectionRef.current;
      const epsilon = 0.03;
      const hasPartialSelection = duration > epsilon && start > epsilon && end < duration - epsilon;

      if (!waveSurfer.isPlaying() && hasPartialSelection) {
        const currentTime = waveSurfer.getCurrentTime();
        if (currentTime < start || currentTime > end) {
          waveSurfer.seekTo(start / duration);
        }
      }

      waveSurfer.playPause();
    },
    seekTo: (time: number) => {
      const waveSurfer = waveSurferRef.current;
      if (!waveSurfer) {
        return;
      }

      const duration = waveSurfer.getDuration();
      if (!duration) {
        return;
      }

      waveSurfer.seekTo(time / duration);
    },
    setSelection: (start: number, end: number) => {
      const region = regionsPluginRef.current?.getRegions().find((item: Region) => item.id === 'selection');
      if (!region) {
        return;
      }

      const nextStart = Math.max(0, Math.min(start, end));
      const nextEnd = Math.max(nextStart, end);

      try {
        region.setOptions({ start: nextStart, end: nextEnd });
      } catch (error) {
        debugLog('[useWaveSurfer] Ignoring stale region update:', error);
        return;
      }

      const nextSelection = { start: nextStart, end: nextEnd };
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
    },
    getVolume: () => waveSurferRef.current?.getVolume() ?? 0.5,
    setVolume: (volume: number) => {
      waveSurferRef.current?.setVolume(Math.max(0, Math.min(1, volume)));
    },
    reloadWaveform: () => {
      reloadWaveformSource(audioUrl);
    },
    toggleAutoScroll,
  };
}
