import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { LibraryPane } from './components/LibraryPane';
import { MetadataEditor } from './components/MetadataEditor';
import { PlayerPane, type PlayerPaneHandle } from './components/PlayerPane';
import { requireAudioMetaApi } from './services/audioMetaApi';
import { useLibraryState } from './features/library/useLibraryState';
import { useSessionRestore } from './features/library/useSessionRestore';
import { useDesktopBridgeSubscriptions } from './features/library/useDesktopBridgeSubscriptions';
import { useMetadataActions } from './features/metadata/useMetadataActions';
import { useTransportActions } from './features/player/useTransportActions';
import { useLibraryDerivations } from './features/library/useLibraryDerivations';
import { toUserErrorMessage } from './lib/errors';
import { endPerfTimer, logMemorySnapshot, startPerfTimer } from './lib/performance';

const LAYOUT_METADATA_WIDTH_KEY = 'audioMetaEditor:layout:metadataWidth';
const LAYOUT_STATUS_HEIGHT_KEY = 'audioMetaEditor:layout:statusHeight';

function readStoredDimension(key: string, min: number, max: number, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export default function App() {
  const MIN_METADATA_WIDTH = 320;
  const MAX_METADATA_WIDTH = 760;
  const MIN_STATUS_HEIGHT = 56;
  const MAX_STATUS_HEIGHT = 280;
  const MIN_PLAYER_HEIGHT = 260;

  const startupTimerRef = useRef<number | null>(startPerfTimer());
  const [status, setStatus] = useState('Open a file or directory to start.');
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [metadataWidth, setMetadataWidth] = useState(() =>
    readStoredDimension(LAYOUT_METADATA_WIDTH_KEY, MIN_METADATA_WIDTH, MAX_METADATA_WIDTH, 400),
  );
  const [statusHeight, setStatusHeight] = useState(() =>
    readStoredDimension(LAYOUT_STATUS_HEIGHT_KEY, MIN_STATUS_HEIGHT, MAX_STATUS_HEIGHT, 92),
  );
  const [isMetadataResizing, setIsMetadataResizing] = useState(false);
  const [isStatusResizing, setIsStatusResizing] = useState(false);
  const playerPaneRef = useRef<PlayerPaneHandle>(null);
  const mainColumnRef = useRef<HTMLDivElement | null>(null);
  const {
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
    estimateLibraryWidthForItems,
  } = useLibraryState({ setStatus });

  const isAnyResizing = isLibraryResizing || isMetadataResizing || isStatusResizing;

  const composedLayoutStyle = useMemo(
    () =>
      ({
        ...layoutStyle,
        '--metadata-width': `${metadataWidth}px`,
      }) as CSSProperties,
    [layoutStyle, metadataWidth],
  );

  const mainColumnStyle = useMemo(
    () =>
      ({
        '--status-height': `${statusHeight}px`,
      }) as CSSProperties,
    [statusHeight],
  );

  const startMetadataResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsMetadataResizing(true);
  };

  const resetMetadataWidth = () => {
    setMetadataWidth(400);
  };

  const startStatusResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsStatusResizing(true);
  };

  const resetStatusHeight = () => {
    setStatusHeight(92);
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LAYOUT_METADATA_WIDTH_KEY, String(Math.round(metadataWidth)));
  }, [metadataWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LAYOUT_STATUS_HEIGHT_KEY, String(Math.round(statusHeight)));
  }, [statusHeight]);

  useEffect(() => {
    if (!isMetadataResizing) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }

      const bounds = layout.getBoundingClientRect();
      const desiredWidth = bounds.right - event.clientX;
      const availableForMainAndMeta = bounds.width - libraryWidth - 12;
      const maxByAvailableSpace = Math.max(MIN_METADATA_WIDTH, availableForMainAndMeta - 420);
      const maxWidth = Math.min(MAX_METADATA_WIDTH, maxByAvailableSpace);
      const nextWidth = Math.max(MIN_METADATA_WIDTH, Math.min(desiredWidth, maxWidth));
      setMetadataWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsMetadataResizing(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isMetadataResizing, layoutRef, libraryWidth]);

  useEffect(() => {
    if (!isStatusResizing) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const mainColumn = mainColumnRef.current;
      if (!mainColumn) {
        return;
      }

      const bounds = mainColumn.getBoundingClientRect();
      const desiredStatusHeight = bounds.bottom - event.clientY;
      const maxByAvailableSpace = Math.max(MIN_STATUS_HEIGHT, bounds.height - MIN_PLAYER_HEIGHT - 12);
      const maxHeight = Math.min(MAX_STATUS_HEIGHT, maxByAvailableSpace);
      const nextHeight = Math.max(MIN_STATUS_HEIGHT, Math.min(desiredStatusHeight, maxHeight));
      setStatusHeight(nextHeight);
    };

    const onMouseUp = () => {
      setIsStatusResizing(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isStatusResizing]);

  useDesktopBridgeSubscriptions({
    audioMetaApi,
    loadPaths,
    setLibrary,
    setActivePath,
    setLibraryWidth,
    estimateLibraryWidthForItems,
    setStatus,
  });

  useSessionRestore({
    activePath,
    loadPaths,
  });

  const activeItem = useMemo(
    () => library.find((item) => item.path === activePath) ?? library[0] ?? null,
    [activePath, library],
  );

  const {
    metadataSuggestions,
    activeAlbumTrackCount,
    activeAlbumCoverOptions,
    activeOtherTrackCoverOptions,
    activeAlbumMismatchFields,
  } = useLibraryDerivations({
    library,
    activeItem,
  });

  const { isSaving, isSavingAlbum, handleSaveMetadata, handleSaveAlbumMetadata, handleApplyAlbumFields } =
    useMetadataActions({
      activeItem,
      library,
      setLibrary,
      setStatus,
    });

  const {
    isExporting,
    isEditingSelection,
    isDownloadingFromUrl,
    handleExportClip,
    handleEditSelection,
    handleMoveTrackToAlbum,
    handleDownloadFromUrl,
    handleOpenFileLocation,
    handleSaveCoverImage,
  } = useTransportActions({
    activeItem,
    activePath,
    audioMetaApi,
    library,
    loadedSourcePaths,
    setActivePath,
    setLibrary,
    setLoadedSourcePaths,
    setLibraryWidth,
    estimateLibraryWidthForItems,
    loadPaths,
    setStatus,
    downloadUrl,
    setDownloadUrl,
    setIsDownloadDialogOpen,
  });

  useEffect(() => {
    if (startupTimerRef.current !== null) {
      endPerfTimer('renderer:first-mount', startupTimerRef.current);
      logMemorySnapshot('renderer:first-mount');
      startupTimerRef.current = null;
    }

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space' && activeItem) {
        e.preventDefault();
        playerPaneRef.current?.playPause();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [activeItem]);

  async function handleOpenFiles() {
    try {
      const api = requireAudioMetaApi();
      const paths = await api.openAudioFiles();
      await loadPaths(paths);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to open files.'));
    }
  }

  async function handleOpenDirectory() {
    try {
      const api = requireAudioMetaApi();
      const paths = await api.openDirectory();
      await loadPaths(paths);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to open directory.'));
    }
  }

  async function handleReloadLibrary() {
    if (loadedSourcePaths.length === 0) {
      setStatus('Open a file or directory first.');
      return;
    }

    await loadPaths(loadedSourcePaths, activePath);
  }

  return (
    <div className="app-shell">
      <div aria-hidden="true" className="window-drag-region" />
      <header className="topbar">
        <div>
          <p className="eyebrow">Desktop audio workstation</p>
          <h1>Audio Meta Editor</h1>
        </div>
        <div className="action-row">
          <button className="secondary-button" onClick={() => setIsDownloadDialogOpen(true)} type="button">
            Download from URL
          </button>
          <button className="secondary-button" onClick={() => void handleOpenFiles()} type="button">
            Open file
          </button>
          <button className="primary-button" onClick={() => void handleOpenDirectory()} type="button">
            Open directory
          </button>
        </div>
      </header>

      <main className={`layout-grid${isAnyResizing ? ' resizing' : ''}`} ref={layoutRef} style={composedLayoutStyle}>
        <LibraryPane
          items={library}
          currentPath={activeItem?.path ?? null}
          isLoading={isLoadingLibrary}
          onApplyAlbumFields={handleApplyAlbumFields}
          onMoveTrackToAlbum={handleMoveTrackToAlbum}
          onOpenFileLocation={handleOpenFileLocation}
          onReloadLibrary={handleReloadLibrary}
          onSelect={(item) => setActivePath(item.path)}
        />
        <div
          aria-label="Resize library panel"
          aria-orientation="vertical"
          className="library-resizer"
          onDoubleClick={resetLibraryWidth}
          onMouseDown={startLibraryResize}
          role="separator"
        />

        <div
          className={`main-column${isStatusResizing ? ' resizing' : ''}`}
          ref={mainColumnRef}
          style={mainColumnStyle}
        >
          <PlayerPane
            ref={playerPaneRef}
            item={activeItem}
            onEditSelection={handleEditSelection}
            onExportClip={handleExportClip}
            isEditingSelection={isEditingSelection}
            isExporting={isExporting}
          />
          <div
            aria-label="Resize status panel"
            aria-orientation="horizontal"
            className="status-resizer"
            onDoubleClick={resetStatusHeight}
            onMouseDown={startStatusResize}
            role="separator"
          />
          <div className="status-bar">{isLoadingLibrary ? 'Loading library...' : status}</div>
        </div>

        <div
          aria-label="Resize metadata panel"
          aria-orientation="vertical"
          className="metadata-resizer"
          onDoubleClick={resetMetadataWidth}
          onMouseDown={startMetadataResize}
          role="separator"
        />

        <MetadataEditor
          item={activeItem}
          onSave={handleSaveMetadata}
          onSaveAlbum={handleSaveAlbumMetadata}
          isSaving={isSaving}
          isSavingAlbum={isSavingAlbum}
          albumTrackCount={activeAlbumTrackCount}
          albumCoverOptions={activeAlbumCoverOptions}
          otherTrackCoverOptions={activeOtherTrackCoverOptions}
          albumMismatchFields={activeAlbumMismatchFields}
          suggestions={metadataSuggestions}
          onSaveCoverImage={handleSaveCoverImage}
        />
      </main>

      {isDownloadDialogOpen ? (
        <div
          className="download-dialog-backdrop"
          onClick={() => !isDownloadingFromUrl && setIsDownloadDialogOpen(false)}
          role="presentation"
        >
          <section className="download-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="download-dialog-heading">
              <p className="eyebrow">Import audio</p>
              <h2>Download from URL</h2>
              <p>Supports direct MP3/WAV file URLs.</p>
            </div>

            <label>
              Audio URL
              <input
                autoFocus
                onChange={(event) => setDownloadUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleDownloadFromUrl();
                  }
                }}
                placeholder="https://example.com/audio-file.mp3"
                value={downloadUrl}
              />
            </label>

            <div className="download-dialog-actions">
              <button
                className="secondary-button"
                disabled={isDownloadingFromUrl}
                onClick={() => setIsDownloadDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isDownloadingFromUrl || !downloadUrl.trim()}
                onClick={() => void handleDownloadFromUrl()}
                type="button"
              >
                {isDownloadingFromUrl ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
