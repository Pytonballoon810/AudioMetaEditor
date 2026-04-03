import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CropIcon,
  FirstBracketIcon,
  RedoIcon,
  SaveIcon,
  ScrollHorizontalIcon,
  ScissorIcon,
  SecondBracketIcon,
  Select02Icon,
  UndoIcon,
} from '@hugeicons/core-free-icons';
import type { AudioLibraryItem } from '../types';
import { formatBitrate, formatDuration } from '../lib/format';
import { useWaveSurfer } from '../hooks/useWaveSurfer';

export type PlayerPaneHandle = {
  playPause: () => void;
};

type PlayerPaneProps = {
  item: AudioLibraryItem | null;
  onExportClip: (startTime: number, endTime: number) => Promise<void>;
  onConvertAudio: (targetFormat: 'mp3' | 'flac') => Promise<void>;
  onEditSelection: (mode: 'trim' | 'cut', startTime: number, endTime: number) => Promise<void>;
  onSplitSelection: (startTime: number, endTime: number, splitMode: 'keep' | 'slice', splitTitle: string) => Promise<void>;
  isExporting: boolean;
  isConverting: boolean;
  isEditingSelection: boolean;
  isSplittingSelection: boolean;
};

type PendingWaveEdit = {
  mode: 'trim' | 'cut';
  startTime: number;
  endTime: number;
  label: string;
};

type RemovedRangeGuide = {
  startTime: number;
  endTime: number;
  label: string;
};

function formatEditTime(seconds: number) {
  return `${formatDuration(seconds)} (${seconds.toFixed(2)}s)`;
}

function formatDigitalSelectionTime(seconds: number) {
  const totalHundredths = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(totalHundredths / 6000);
  const remainingHundredths = totalHundredths % 6000;
  const wholeSeconds = Math.floor(remainingHundredths / 100);
  const hundredths = remainingHundredths % 100;

  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function formatStepLabel(stepSeconds: number) {
  if (stepSeconds < 1) {
    const precision = stepSeconds < 0.5 ? 2 : 1;
    return `${stepSeconds.toFixed(precision)}s`;
  }

  if (stepSeconds >= 60 && stepSeconds % 60 === 0) {
    return `${Math.round(stepSeconds / 60)}m`;
  }

  return `${Math.round(stepSeconds)}s`;
}

function formatTimelineTickLabel(seconds: number, stepSeconds: number) {
  if (stepSeconds >= 1) {
    return formatDuration(seconds);
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, seconds - minutes * 60);
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function pickRulerTickStepSeconds(visibleSpanSeconds: number, preferredStepSeconds: number) {
  if (visibleSpanSeconds <= 6) {
    return 0.5;
  }

  if (visibleSpanSeconds <= 14) {
    return 1;
  }

  if (visibleSpanSeconds <= 28) {
    return 2;
  }

  if (visibleSpanSeconds <= 60) {
    return 5;
  }

  return Math.max(5, preferredStepSeconds);
}

const MIN_VOLUME_DB = -48;

function perceivedSliderToGain(sliderValue: number) {
  const clampedSlider = Math.max(0, Math.min(1, sliderValue));
  if (clampedSlider <= 0) {
    return 0;
  }

  // Map linear slider travel to dB, then convert dB to amplitude gain.
  const dbValue = MIN_VOLUME_DB + clampedSlider * Math.abs(MIN_VOLUME_DB);
  return Math.pow(10, dbValue / 20);
}

function buildRemovedRanges(edit: PendingWaveEdit, trackDuration: number): RemovedRangeGuide[] {
  const normalizedStart = Math.max(0, Math.min(edit.startTime, trackDuration));
  const normalizedEnd = Math.max(normalizedStart, Math.min(edit.endTime, trackDuration));

  if (normalizedEnd <= normalizedStart) {
    return [];
  }

  if (edit.mode === 'cut') {
    return [
      {
        startTime: normalizedStart,
        endTime: normalizedEnd,
        label: `${edit.label} (${formatEditTime(normalizedStart)} - ${formatEditTime(normalizedEnd)})`,
      },
    ];
  }

  const removedRanges: RemovedRangeGuide[] = [];
  if (normalizedStart > 0.01) {
    removedRanges.push({
      startTime: 0,
      endTime: normalizedStart,
      label: `Trim removes start (${formatEditTime(0)} - ${formatEditTime(normalizedStart)})`,
    });
  }

  if (normalizedEnd < trackDuration - 0.01) {
    removedRanges.push({
      startTime: normalizedEnd,
      endTime: trackDuration,
      label: `Trim removes end (${formatEditTime(normalizedEnd)} - ${formatEditTime(trackDuration)})`,
    });
  }

  return removedRanges;
}

export const PlayerPane = forwardRef<PlayerPaneHandle, PlayerPaneProps>(function PlayerPane(
  {
    item,
    onExportClip,
    onConvertAudio,
    onEditSelection,
    onSplitSelection,
    isExporting,
    isConverting,
    isEditingSelection,
    isSplittingSelection,
  },
  ref,
) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isConvertMenuOpen, setIsConvertMenuOpen] = useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<'keep' | 'slice'>('keep');
  const [splitTrackTitle, setSplitTrackTitle] = useState('');
  const [pendingEdits, setPendingEdits] = useState<PendingWaveEdit[]>([]);
  const [redoPendingEdits, setRedoPendingEdits] = useState<PendingWaveEdit[]>([]);
  const audioUrl = item ? item.path : null;

  const handleReady = useCallback((loadedDuration: number) => {
    setDuration(loadedDuration);
    setCurrentTime(0);
  }, []);

  const {
    containerRef,
    isPlaying,
    isWaveformLoading,
    playPause,
    selection,
    setSelection,
    seekTo,
    reloadWaveform,
    isAutoScrollEnabled,
    toggleAutoScroll,
    setVolume: setWaveSurferVolume,
    visibleTimeframe,
  } = useWaveSurfer({
    audioUrl,
    onReady: handleReady,
    onTimeUpdate: setCurrentTime,
  });

  useImperativeHandle(
    ref,
    () => ({
      playPause,
    }),
    [playPause],
  );

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    setWaveSurferVolume(perceivedSliderToGain(newVolume));
  };

  useEffect(() => {
    if (!item) {
      setCurrentTime(0);
      setDuration(0);
      setPendingEdits([]);
      setRedoPendingEdits([]);
    }
  }, [item]);

  useEffect(() => {
    setPendingEdits([]);
    setRedoPendingEdits([]);
  }, [item?.path]);

  const normalizedSelectionStart = Math.max(0, selection.start);
  const normalizedSelectionEnd = Math.max(normalizedSelectionStart, selection.end);
  const hasValidSelection = normalizedSelectionEnd > normalizedSelectionStart + 0.01;
  const effectiveDuration = duration || item?.metadata.duration || 0;
  const splitStartTime = normalizedSelectionStart;
  const splitEndTime = normalizedSelectionEnd;
  const defaultSplitTrackTitle = item ? `${item.metadata.title || item.name} (Split)` : 'Split track';
  const splitTrackTitleTrimmed = splitTrackTitle.trim();
  const canSplitTrackType = Boolean(item);
  const isFullTrackSelection =
    effectiveDuration > 0.01 &&
    normalizedSelectionStart <= 0.01 &&
    normalizedSelectionEnd >= effectiveDuration - 0.01;
  const canCutSelection =
    hasValidSelection && duration > 0.01 && !(normalizedSelectionStart <= 0.01 && normalizedSelectionEnd >= duration - 0.01);
  const canSplitSelection = hasValidSelection && (effectiveDuration <= 0.01 || !isFullTrackSelection);
  const splitDisabledReason = !item
    ? 'No active track'
    : !hasValidSelection
        ? 'Selection is too small'
        : isFullTrackSelection
          ? 'Selection covers full track'
          : isSplittingSelection
            ? 'Split already in progress'
            : isConverting
              ? 'Conversion in progress'
              : null;
  const clampedPlayhead = Math.max(0, Math.min(currentTime, effectiveDuration));
  const canCutBeforePlayhead = Boolean(item) && effectiveDuration > 0.01 && clampedPlayhead > 0.01;
  const canCutAfterPlayhead = Boolean(item) && effectiveDuration > 0.01 && clampedPlayhead < effectiveDuration - 0.01;
  const rulerStart = item ? Math.max(0, visibleTimeframe.start) : 0;
  const fallbackRulerEnd = effectiveDuration > 0.01 ? effectiveDuration : 0;
  const rulerEnd = item
    ? Math.max(rulerStart, visibleTimeframe.end > rulerStart ? visibleTimeframe.end : fallbackRulerEnd)
    : 0;
  const rulerSpan = Math.max(0.01, rulerEnd - rulerStart);
  const preferredTickStepSeconds = Math.max(0.5, visibleTimeframe.tickStepSeconds || 5);
  const baseTickStepSeconds = pickRulerTickStepSeconds(rulerSpan, preferredTickStepSeconds);
  const estimatedTickCount = Math.floor(rulerSpan / baseTickStepSeconds) + 1;
  const tickRenderStride = estimatedTickCount > 36 ? Math.ceil(estimatedTickCount / 36) : 1;
  const renderedTickStepSeconds = baseTickStepSeconds * tickRenderStride;
  const firstTick = Math.ceil(rulerStart / baseTickStepSeconds) * baseTickStepSeconds;
  const timelineTicks: number[] = [];

  if (item && rulerEnd > rulerStart + 0.01) {
    for (let tick = firstTick, index = 0; tick <= rulerEnd + 0.0001; tick += baseTickStepSeconds, index += 1) {
      if (index % tickRenderStride !== 0) {
        continue;
      }

      timelineTicks.push(Number(tick.toFixed(4)));
    }
  }

  if (item && timelineTicks.length === 0 && rulerEnd >= rulerStart) {
    timelineTicks.push(Number(rulerStart.toFixed(4)));
    if (rulerEnd - rulerStart > 0.2) {
      timelineTicks.push(Number(rulerEnd.toFixed(4)));
    }
  }

  const setSelectionStartToPlayhead = () => {
    const nextStart = Math.max(0, Math.min(currentTime, selection.end));
    setSelection(nextStart, Math.max(nextStart, selection.end));
  };

  const setSelectionEndToPlayhead = () => {
    const nextEnd = Math.max(selection.start, Math.min(currentTime, duration || selection.end));
    setSelection(selection.start, nextEnd);
  };

  const setSelectionToFullTrack = () => {
    const fullDuration = duration || item?.metadata.duration || 0;
    setSelection(0, fullDuration);
  };

  useEffect(() => {
    if (isSplittingSelection) {
      return;
    }

    setIsSplitModalOpen(false);
  }, [isSplittingSelection]);

  const queueEdit = (mode: 'trim' | 'cut', startTime: number, endTime: number, label: string) => {
    if (!item || endTime <= startTime + 0.01) {
      return;
    }

    setPendingEdits((current) => [
      ...current,
      {
        mode,
        startTime,
        endTime,
        label,
      },
    ]);
    setRedoPendingEdits([]);
  };

  const undoPendingEdit = () => {
    if (pendingEdits.length === 0 || isEditingSelection) {
      return;
    }

    const nextPending = pendingEdits.slice(0, -1);
    const removedEdit = pendingEdits[pendingEdits.length - 1];
    if (!removedEdit) {
      return;
    }

    setPendingEdits(nextPending);
    setRedoPendingEdits((current) => [...current, removedEdit]);
  };

  const redoPendingEdit = () => {
    if (redoPendingEdits.length === 0 || isEditingSelection) {
      return;
    }

    const nextRedo = redoPendingEdits.slice(0, -1);
    const restoredEdit = redoPendingEdits[redoPendingEdits.length - 1];
    if (!restoredEdit) {
      return;
    }

    setRedoPendingEdits(nextRedo);
    setPendingEdits((current) => [...current, restoredEdit]);
  };

  const savePendingEdit = async () => {
    if (pendingEdits.length === 0 || isEditingSelection) {
      return;
    }

    const [nextEdit, ...remaining] = pendingEdits;
    if (!nextEdit) {
      return;
    }

    await onEditSelection(nextEdit.mode, nextEdit.startTime, nextEdit.endTime);
    setPendingEdits(remaining);
  };

  const firstPendingEdit = pendingEdits.length > 0 ? pendingEdits[0] : null;

  const removedRangeGuides = effectiveDuration
    ? pendingEdits.flatMap((edit) => buildRemovedRanges(edit, effectiveDuration))
    : [];

  const confirmSplitSelection = () => {
    if (!item || !canSplitTrackType || !canSplitSelection || !splitTrackTitleTrimmed) {
      return;
    }

    setIsSplitModalOpen(false);
    void onSplitSelection(splitStartTime, splitEndTime, splitMode, splitTrackTitleTrimmed);
  };

  return (
    <section className="panel player-panel">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Now playing</p>
          <h1>{item?.metadata.title || item?.name || 'AudioMetaEditor'}</h1>
          <p className="hero-subtitle">
            {item
              ? `${item.metadata.artist || 'Unknown artist'} • ${item.directory}`
              : 'Load a file or a directory to start playback and editing.'}
          </p>
        </div>
        <div className="hero-stats">
          <span>{item?.extension.toUpperCase() || '--'}</span>
          <span>{item ? formatBitrate(item.metadata.bitrate) : 'No file'}</span>
          <span>{item ? `${item.metadata.sampleRate || 0} Hz` : 'Waveform idle'}</span>
        </div>
      </div>

      <div aria-label="Waveform editing toolbar" className="wave-edit-toolbar" role="toolbar">
        <div className="daw-toolbar-group">
          <button
            aria-label="Set selection start at playhead"
            className="daw-tool-button"
            disabled={!item}
            onClick={setSelectionStartToPlayhead}
            title="Set selection start at playhead"
            type="button"
          >
            <HugeiconsIcon icon={FirstBracketIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Set selection end at playhead"
            className="daw-tool-button"
            disabled={!item}
            onClick={setSelectionEndToPlayhead}
            title="Set selection end at playhead"
            type="button"
          >
            <HugeiconsIcon icon={SecondBracketIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Select full track"
            className="daw-tool-button"
            disabled={!item}
            onClick={setSelectionToFullTrack}
            title="Select full track"
            type="button"
          >
            <HugeiconsIcon icon={Select02Icon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <span aria-hidden="true" className="daw-toolbar-divider" />

        <div className="daw-toolbar-group">
          <button
            aria-label="Undo last pending waveform edit"
            className="daw-tool-button"
            disabled={pendingEdits.length === 0 || isEditingSelection}
            onClick={undoPendingEdit}
            title={pendingEdits.length > 0 ? 'Undo last pending edit' : 'No pending edit to undo'}
            type="button"
          >
            <HugeiconsIcon icon={UndoIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Redo last undone waveform edit"
            className="daw-tool-button"
            disabled={redoPendingEdits.length === 0 || isEditingSelection}
            onClick={redoPendingEdit}
            title={redoPendingEdits.length > 0 ? 'Redo last undone edit' : 'No undone edit to redo'}
            type="button"
          >
            <HugeiconsIcon icon={RedoIcon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <span aria-hidden="true" className="daw-toolbar-divider" />

        <div className="daw-toolbar-group">
          <button
            aria-label={isEditingSelection ? 'Processing trim operation' : 'Trim to selection'}
            className="daw-tool-button daw-tool-button-accent"
            disabled={!item || !hasValidSelection || isEditingSelection}
            onClick={() => queueEdit('trim', selection.start, selection.end, 'Trim to selection')}
            title={isEditingSelection ? 'Processing trim operation' : 'Trim to selection'}
            type="button"
          >
            <HugeiconsIcon icon={CropIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label={isEditingSelection ? 'Processing cut operation' : 'Cut selection out'}
            className="daw-tool-button daw-tool-button-accent"
            disabled={!item || !canCutSelection || isEditingSelection}
            onClick={() => queueEdit('cut', selection.start, selection.end, 'Cut selection out')}
            title={isEditingSelection ? 'Processing cut operation' : 'Cut selection out'}
            type="button"
          >
            <HugeiconsIcon icon={ScissorIcon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <span aria-hidden="true" className="daw-toolbar-divider" />

        <div className="daw-toolbar-group">
          <button
            aria-label={isEditingSelection ? 'Processing cut operation' : 'Remove audio before playhead'}
            className="daw-tool-button daw-tool-button-accent"
            disabled={!canCutBeforePlayhead || isEditingSelection}
            onClick={() => queueEdit('cut', 0, clampedPlayhead, 'Remove audio before playhead')}
            title={isEditingSelection ? 'Processing cut operation' : 'Remove audio before playhead'}
            type="button"
          >
            <HugeiconsIcon icon={FirstBracketIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label={isEditingSelection ? 'Processing cut operation' : 'Remove audio after playhead'}
            className="daw-tool-button daw-tool-button-accent"
            disabled={!canCutAfterPlayhead || isEditingSelection}
            onClick={() => queueEdit('cut', clampedPlayhead, effectiveDuration, 'Remove audio after playhead')}
            title={isEditingSelection ? 'Processing cut operation' : 'Remove audio after playhead'}
            type="button"
          >
            <HugeiconsIcon icon={SecondBracketIcon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <span aria-hidden="true" className="daw-toolbar-divider" />

        <div className="daw-toolbar-group">
          <button
            aria-label={isEditingSelection ? 'Saving next pending waveform edit' : 'Save next pending waveform edit'}
            className="daw-tool-button daw-tool-button-save"
            disabled={pendingEdits.length === 0 || isEditingSelection}
            onClick={() => void savePendingEdit()}
            title={firstPendingEdit ? `Save next pending edit: ${firstPendingEdit.label}` : 'No pending edit to save'}
            type="button"
          >
            <HugeiconsIcon icon={SaveIcon} size={18} strokeWidth={1.8} />
          </button>
          <div className="daw-toolbar-pending-wrap" role="status" aria-live="polite">
            <span className="daw-toolbar-pending">
              {pendingEdits.length === 0
                ? 'No pending edits'
                : pendingEdits.length === 1 && firstPendingEdit
                  ? `Pending: ${firstPendingEdit.label}`
                  : `Pending edits: ${pendingEdits.length}`}
            </span>
            {pendingEdits.length > 0 ? (
              <div className="daw-toolbar-pending-popover">
                {pendingEdits.map((edit, index) => (
                  <div key={`${edit.mode}-${edit.startTime}-${edit.endTime}-${index}`} className="daw-pending-row">
                    <strong>
                      {index + 1}. {edit.label}
                    </strong>
                    <span>
                      {edit.mode.toUpperCase()} {formatEditTime(edit.startTime)} - {formatEditTime(edit.endTime)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="daw-toolbar-group daw-toolbar-group-right">
          <button
            aria-label={isAutoScrollEnabled ? 'Disable auto-scroll with playhead' : 'Enable auto-scroll with playhead'}
            className={`daw-tool-button${isAutoScrollEnabled ? ' daw-tool-button-active' : ''}`}
            disabled={!item}
            onClick={toggleAutoScroll}
            title={isAutoScrollEnabled ? 'Auto-scroll: on' : 'Auto-scroll: off'}
            type="button"
          >
            <HugeiconsIcon icon={ScrollHorizontalIcon} size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label={isWaveformLoading ? 'Reloading waveform' : 'Reload waveform'}
            className="daw-tool-button"
            disabled={!item || isWaveformLoading}
            onClick={reloadWaveform}
            title={isWaveformLoading ? 'Reloading waveform' : 'Reload waveform'}
            type="button"
          >
            <HugeiconsIcon icon={RedoIcon} size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="wave-shell">
        <div className="wave-topline">
          <span>{formatDuration(currentTime)}</span>
          <span className="wave-topline-meta">
            View {formatDuration(rulerStart)} - {formatDuration(rulerEnd)} • step {formatStepLabel(renderedTickStepSeconds)}
          </span>
          <span>{item ? formatDuration(duration || item.metadata.duration) : '00:00'}</span>
        </div>
        {item ? (
          <div className="wave-time-ruler" aria-hidden="true">
            {timelineTicks.map((tick) => {
              const leftPercent = ((tick - rulerStart) / rulerSpan) * 100;
              const shouldShowLabel = renderedTickStepSeconds >= 1 || Math.abs(tick - Math.round(tick)) < 0.001;

              return (
                <div className="wave-time-tick" key={tick} style={{ left: `${Math.max(0, Math.min(100, leftPercent))}%` }}>
                  {shouldShowLabel ? <span>{formatTimelineTickLabel(tick, renderedTickStepSeconds)}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="wave-area">
          <div className="waveform" ref={containerRef} />
          {removedRangeGuides.length > 0 ? (
            <div className="wave-edit-guides" aria-hidden="true">
              {removedRangeGuides.map((guide, index) => {
                const left = (guide.startTime / effectiveDuration) * 100;
                const width = ((guide.endTime - guide.startTime) / effectiveDuration) * 100;

                return (
                  <div
                    key={`${guide.startTime}-${guide.endTime}-${index}`}
                    className="wave-edit-guide-segment"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={guide.label}
                  />
                );
              })}
            </div>
          ) : null}
          {item && isWaveformLoading ? (
            <div className="waveform-loading" role="status" aria-live="polite">
              <div className="waveform-spinner" aria-hidden="true" />
              <span>Loading waveform...</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="transport-row">
        <button className="primary-button transport-play-button" disabled={!item} onClick={playPause} type="button">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button className="secondary-button" disabled={!item} onClick={() => seekTo(selection.start)} type="button">
          Jump to selection
        </button>
        <div className="selection-grid">
          <label className="selection-tech-field">
            <span className="selection-tech-label">Start</span>
            <span className="selection-tech-readout">{formatDigitalSelectionTime(selection.start)}</span>
          </label>

          <label className="selection-tech-field">
            <span className="selection-tech-label">End</span>
            <span className="selection-tech-readout">{formatDigitalSelectionTime(selection.end)}</span>
          </label>
        </div>
        <div
          className="convert-format-dropdown"
          onBlur={() => window.setTimeout(() => setIsConvertMenuOpen(false), 100)}
          tabIndex={0}
        >
          <button
            className="accent-button convert-format-trigger"
            disabled={!item || isConverting}
            onClick={() => setIsConvertMenuOpen((open) => !open)}
            type="button"
          >
            <span>{isConverting ? 'Converting...' : 'Convert to...'}</span>
            <span aria-hidden="true" className={`convert-format-chevron${isConvertMenuOpen ? ' open' : ''}`}>
              ▾
            </span>
          </button>

          {isConvertMenuOpen && item && !isConverting ? (
            <div className="convert-format-menu" role="listbox">
              <button
                className={`convert-format-option${item.extension.toLowerCase() === 'mp3' ? ' active' : ''}`}
                disabled={item.extension.toLowerCase() === 'mp3'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void onConvertAudio('mp3');
                  setIsConvertMenuOpen(false);
                }}
                type="button"
              >
                Convert to MP3
              </button>
              <button
                className={`convert-format-option${item.extension.toLowerCase() === 'flac' ? ' active' : ''}`}
                disabled={item.extension.toLowerCase() === 'flac'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void onConvertAudio('flac');
                  setIsConvertMenuOpen(false);
                }}
                type="button"
              >
                Convert to FLAC
              </button>
            </div>
          ) : null}
        </div>
        <button
          className="accent-button"
          disabled={!item || !canSplitSelection || !canSplitTrackType || isSplittingSelection || isConverting}
          onClick={() => {
            setSplitMode('keep');
            setSplitTrackTitle(defaultSplitTrackTitle);
            setIsSplitModalOpen(true);
          }}
          title={splitDisabledReason ?? 'Split selected segment into a new track'}
          type="button"
        >
          {isSplittingSelection ? 'Splitting track...' : 'Split to new track'}
        </button>
        <button
          className="accent-button"
          disabled={!item || selection.end <= selection.start || isExporting || isConverting}
          onClick={() => void onExportClip(selection.start, selection.end)}
          type="button"
        >
          {isExporting ? 'Exporting clip...' : 'Export selection'}
        </button>
      </div>

      <div className="detail-strip">
        <span>Codec: {item?.metadata.codec || 'Unknown'}</span>
        <span>Duration: {item ? formatDuration(item.metadata.duration) : '--'}</span>
        <span>Composer: {item?.metadata.composer || '—'}</span>
        <span>Producer: {item?.metadata.producer || '—'}</span>
        <div className="volume-control">
          <label htmlFor="volume-slider">Volume</label>
          <input
            id="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            disabled={!item}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      </div>

      {isSplitModalOpen ? (
        <div
          className="download-dialog-backdrop"
          onClick={() => {
            if (isSplittingSelection) {
              return;
            }

            setIsSplitModalOpen(false);
          }}
          role="presentation"
        >
          <div
            className="download-dialog split-options-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Split track options"
          >
            <div className="download-dialog-heading">
              <h2>Split to separate track</h2>
              <p>Choose how the original file should be handled after creating the split track.</p>
            </div>

            <label className="split-title-field">
              New track title
              <input
                autoFocus
                disabled={isSplittingSelection}
                onChange={(event) => setSplitTrackTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && item && canSplitTrackType && canSplitSelection && splitTrackTitleTrimmed) {
                    event.preventDefault();
                    confirmSplitSelection();
                  }
                }}
                placeholder="Split track title"
                type="text"
                value={splitTrackTitle}
              />
            </label>

            <div className="split-options-group" role="radiogroup" aria-label="Original file behavior">
              <label className={splitMode === 'keep' ? 'split-option-card split-option-card-selected' : 'split-option-card'}>
                <input
                  checked={splitMode === 'keep'}
                  onChange={() => setSplitMode('keep')}
                  name="split-mode"
                  type="radio"
                  value="keep"
                />
                <span className="split-option-copy">
                  <strong>Keep original</strong>
                  <span>Create the split track and leave the source file unchanged.</span>
                </span>
              </label>

              <label className={splitMode === 'slice' ? 'split-option-card split-option-card-selected' : 'split-option-card'}>
                <input
                  checked={splitMode === 'slice'}
                  onChange={() => setSplitMode('slice')}
                  name="split-mode"
                  type="radio"
                  value="slice"
                />
                <span className="split-option-copy">
                  <strong>Slice from original</strong>
                  <span>Create the split track and remove the selected range from the source file.</span>
                </span>
              </label>
            </div>

            <p className="split-options-meta">
              Range: {formatEditTime(splitStartTime)} - {formatEditTime(splitEndTime)}
            </p>

            <div className="download-dialog-actions">
              <button
                className="secondary-button"
                disabled={isSplittingSelection}
                onClick={() => setIsSplitModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!item || !canSplitTrackType || !canSplitSelection || isSplittingSelection || !splitTrackTitleTrimmed}
                onClick={confirmSplitSelection}
                type="button"
              >
                {isSplittingSelection ? 'Splitting...' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
});
