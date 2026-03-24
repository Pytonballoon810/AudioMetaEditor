import { useEffect, useMemo, useRef, useState } from 'react';
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

export default function App() {
  const startupTimerRef = useRef<number | null>(startPerfTimer());
  const [status, setStatus] = useState('Open a file or directory to start.');
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const playerPaneRef = useRef<PlayerPaneHandle>(null);
  const {
    audioMetaApi,
    library,
    setLibrary,
    activePath,
    setActivePath,
    loadedSourcePaths,
    setLoadedSourcePaths,
    isLoadingLibrary,
    setLibraryWidth,
    isLibraryResizing,
    layoutRef,
    layoutStyle,
    loadPaths,
    startLibraryResize,
    resetLibraryWidth,
    estimateLibraryWidthForItems,
  } = useLibraryState({ setStatus });

  useDesktopBridgeSubscriptions({
    audioMetaApi,
    loadPaths,
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

  return (
    <div className="app-shell">
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

      <main className={`layout-grid${isLibraryResizing ? ' resizing' : ''}`} ref={layoutRef} style={layoutStyle}>
        <LibraryPane
          items={library}
          currentPath={activeItem?.path ?? null}
          onApplyAlbumFields={handleApplyAlbumFields}
          onMoveTrackToAlbum={handleMoveTrackToAlbum}
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

        <div className="main-column">
          <PlayerPane
            ref={playerPaneRef}
            item={activeItem}
            onEditSelection={handleEditSelection}
            onExportClip={handleExportClip}
            isEditingSelection={isEditingSelection}
            isExporting={isExporting}
          />
          <div className="status-bar">{isLoadingLibrary ? 'Loading library...' : status}</div>
        </div>

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
