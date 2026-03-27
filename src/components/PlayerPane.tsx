import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CropIcon,
  FirstBracketIcon,
  RedoIcon,
  SaveIcon,
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
  isExporting: boolean;
  isConverting: boolean;
  isEditingSelection: boolean;
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
  { item, onExportClip, onConvertAudio, onEditSelection, isExporting, isConverting, isEditingSelection },
  ref,
) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isConvertMenuOpen, setIsConvertMenuOpen] = useState(false);
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
    setVolume: setWaveSurferVolume,
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
    setWaveSurferVolume(newVolume);
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

  const hasValidSelection = selection.end > selection.start + 0.01;
  const canCutSelection =
    hasValidSelection && duration > 0.01 && !(selection.start <= 0.01 && selection.end >= duration - 0.01);
  const effectiveDuration = duration || item?.metadata.duration || 0;
  const clampedPlayhead = Math.max(0, Math.min(currentTime, effectiveDuration));
  const canCutBeforePlayhead = Boolean(item) && effectiveDuration > 0.01 && clampedPlayhead > 0.01;
  const canCutAfterPlayhead = Boolean(item) && effectiveDuration > 0.01 && clampedPlayhead < effectiveDuration - 0.01;

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
      </div>

      <div className="wave-shell">
        <div className="wave-topline">
          <span>{formatDuration(currentTime)}</span>
          <span>{item ? formatDuration(duration || item.metadata.duration) : '00:00'}</span>
        </div>
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
          <label>
            Start
            <input
              min={0}
              step={0.01}
              type="number"
              value={selection.start.toFixed(2)}
              onChange={(event) =>
                setSelection(Number(event.target.value), Math.max(Number(event.target.value), selection.end))
              }
            />
          </label>
          <label>
            End
            <input
              min={selection.start}
              step={0.01}
              type="number"
              value={selection.end.toFixed(2)}
              onChange={(event) => setSelection(selection.start, Number(event.target.value))}
            />
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
    </section>
  );
});
