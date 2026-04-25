import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { LibraryPane, type LibraryPanePlaybackOrderGroup } from './components/LibraryPane';
import { MetadataEditor } from './components/MetadataEditor';
import { PlayerPane, type PlayerPaneHandle } from './components/PlayerPane';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import { requireAudioMetaApi } from './services/audioMetaApi';
import { useLibraryState } from './features/library/useLibraryState';
import { useSessionRestore } from './features/library/useSessionRestore';
import { useDesktopBridgeSubscriptions } from './features/library/useDesktopBridgeSubscriptions';
import { useMetadataActions } from './features/metadata/useMetadataActions';
import { useTransportActions } from './features/player/useTransportActions';
import { useLibraryDerivations } from './features/library/useLibraryDerivations';
import type { VstPluginDescriptor } from './ipc/contracts';
import { toUserErrorMessage } from './lib/errors';
import { endPerfTimer, logMemorySnapshot, startPerfTimer } from './lib/performance';

const LAYOUT_METADATA_WIDTH_KEY = 'audioMetaEditor:layout:metadataWidth';
const LAYOUT_STATUS_HEIGHT_KEY = 'audioMetaEditor:layout:statusHeight';
const SETTINGS_USE_WEB_DOWNLOADS_KEY = 'audioMetaEditor:settings:useWebDownloads';
const SETTINGS_VST_PLUGIN_PATHS_KEY = 'audioMetaEditor:settings:vstPluginPaths';
const SETTINGS_VST_HOST_PATH_KEY = 'audioMetaEditor:settings:vstHostPath';
const LEGACY_SETTINGS_YTDLP_PATH_KEY = 'audioMetaEditor:settings:ytDlpPath';
const MAX_VST_RACK_SLOTS = 10;

type VstRackSlot = {
  slot: number;
  pluginId: string | null;
  enabled: boolean;
};

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

function readStoredString(key: string, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  return raw ?? fallback;
}

function readStoredStringArray(key: string) {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function normalizeStoredPluginPaths(paths: string[]) {
  const dedupe = new Set<string>();
  const normalized: string[] = [];

  for (const candidatePath of paths) {
    const trimmed = candidatePath.trim();
    if (!trimmed || !isAbsolutePath(trimmed)) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function createEmptyVstRackSlots() {
  return Array.from({ length: MAX_VST_RACK_SLOTS }, (_unused, index) => ({
    slot: index + 1,
    pluginId: null,
    enabled: true,
  })) as VstRackSlot[];
}

function getDefaultWebDownloadEnabledSetting() {
  const explicit = readStoredString(SETTINGS_USE_WEB_DOWNLOADS_KEY, '').trim().toLowerCase();
  if (explicit === 'true') {
    return true;
  }

  if (explicit === 'false') {
    return false;
  }

  return readStoredString(LEGACY_SETTINGS_YTDLP_PATH_KEY, '').trim().length > 0;
}

function getDirectoryTail(directory: string) {
  const segments = directory.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? directory;
}

function isAbsolutePath(pathValue: string) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue);
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
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadTargetMode, setDownloadTargetMode] = useState<'existing' | 'new' | 'video-name-album'>('existing');
  const [downloadTargetExistingDirectory, setDownloadTargetExistingDirectory] = useState('');
  const [downloadTargetNewAlbumName, setDownloadTargetNewAlbumName] = useState('');
  const [downloadFormat, setDownloadFormat] = useState<'flac' | 'mp3' | 'wav' | 'm4a'>('flac');
  const [splitDownloadIntoChapters, setSplitDownloadIntoChapters] = useState(false);
  const [isWebDownloadEnabled, setIsWebDownloadEnabled] = useState(() => getDefaultWebDownloadEnabledSetting());
  const [isWebDownloadEnabledDraft, setIsWebDownloadEnabledDraft] = useState(() =>
    getDefaultWebDownloadEnabledSetting(),
  );
  const [isWebDownloadNoticeOpen, setIsWebDownloadNoticeOpen] = useState(false);
  const [hasAcceptedWebDownloadNoticeDraft, setHasAcceptedWebDownloadNoticeDraft] = useState(
    () => getDefaultWebDownloadEnabledSetting(),
  );
  const [isApplyingWebDownloadSettings, setIsApplyingWebDownloadSettings] = useState(false);
  const [vstPluginPaths, setVstPluginPaths] = useState(() =>
    normalizeStoredPluginPaths(readStoredStringArray(SETTINGS_VST_PLUGIN_PATHS_KEY)),
  );
  const [vstPluginPathsDraft, setVstPluginPathsDraft] = useState(() =>
    normalizeStoredPluginPaths(readStoredStringArray(SETTINGS_VST_PLUGIN_PATHS_KEY)),
  );
  const [vstPluginPathDraftInput, setVstPluginPathDraftInput] = useState('');
  const [vstHostExecutablePath, setVstHostExecutablePath] = useState(() => readStoredString(SETTINGS_VST_HOST_PATH_KEY, ''));
  const [vstHostExecutablePathDraft, setVstHostExecutablePathDraft] = useState(() =>
    readStoredString(SETTINGS_VST_HOST_PATH_KEY, ''),
  );
  const [isDiscoveringDefaultVstPaths, setIsDiscoveringDefaultVstPaths] = useState(false);
  const [isScanningVstPlugins, setIsScanningVstPlugins] = useState(false);
  const [vstPlugins, setVstPlugins] = useState<VstPluginDescriptor[]>([]);
  const [vstRackSlots, setVstRackSlots] = useState<VstRackSlot[]>(() => createEmptyVstRackSlots());
  const [isApplyingVstRack, setIsApplyingVstRack] = useState(false);
  const [metadataWidth, setMetadataWidth] = useState(() =>
    readStoredDimension(LAYOUT_METADATA_WIDTH_KEY, MIN_METADATA_WIDTH, MAX_METADATA_WIDTH, 400),
  );
  const [statusHeight, setStatusHeight] = useState(() =>
    readStoredDimension(LAYOUT_STATUS_HEIGHT_KEY, MIN_STATUS_HEIGHT, MAX_STATUS_HEIGHT, 92),
  );
  const [isMetadataResizing, setIsMetadataResizing] = useState(false);
  const [isStatusResizing, setIsStatusResizing] = useState(false);
  const [lastErrorStatus, setLastErrorStatus] = useState<string | null>(null);
  const [libraryLoadingProgress, setLibraryLoadingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const playbackOrderGroupsRef = useRef<LibraryPanePlaybackOrderGroup[]>([]);
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
  const hasWebDownloadsEnabled = isWebDownloadEnabled;
  const downloadAlbumOptions = useMemo(() => {
    const byDirectory = new Map<string, { directory: string; albumName: string; folderName: string }>();

    for (const item of library) {
      const directory = item.directory.trim();
      if (!directory || !item.isMetadataLoaded || !isAbsolutePath(directory) || byDirectory.has(directory)) {
        continue;
      }

      const folderName = getDirectoryTail(directory);
      const albumName = item.metadata.album.trim() || folderName;
      byDirectory.set(directory, { directory, albumName, folderName });
    }

    return [...byDirectory.values()]
      .sort(
        (left, right) =>
          left.albumName.localeCompare(right.albumName, undefined, { sensitivity: 'base' }) ||
          left.directory.localeCompare(right.directory, undefined, { sensitivity: 'base' }),
      )
      .map((entry) => ({
        directory: entry.directory,
        label:
          entry.folderName.localeCompare(entry.albumName, undefined, { sensitivity: 'accent' }) === 0
            ? entry.albumName
            : `${entry.albumName} (${entry.folderName})`,
      }));
  }, [library]);

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
    onApiLogPayload: (payload) => {
      if (payload.level === 'error') {
        setLastErrorStatus(payload.message);
      }
    },
    onLibraryProgressPayload: (payload) => {
      setLibraryLoadingProgress({ loaded: payload.loaded, total: payload.total });
    },
  });

  useEffect(() => {
    if (!isLoadingLibrary) {
      setLibraryLoadingProgress(null);
    }
  }, [isLoadingLibrary]);

  useSessionRestore({
    activePath,
    loadPaths,
  });

  const activeItem = useMemo(
    () =>
      library.find((item) => item.path === activePath && item.isMetadataLoaded) ??
      library.find((item) => item.isMetadataLoaded) ??
      null,
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
      setActivePath,
      setStatus,
    });

  const {
    isExporting,
    isConverting,
    isEditingSelection,
    isSplittingSelection,
    isDownloadingFromUrl,
    handleExportClip,
    handleConvertAudio,
    handleEditSelection,
    handleSplitSelectionToTrack,
    handleMoveTrackToAlbum,
    handleDuplicateTrack,
    handleDeleteTrack,
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
    downloadTargetMode,
    downloadTargetExistingDirectory,
    downloadTargetNewAlbumName,
    downloadFormat,
    splitDownloadIntoChapters,
    isWebDownloadEnabled,
  });

  const isTrackMetadataEditingLocked = isDownloadingFromUrl;

  const handleAdvanceToNextTrack = useCallback(() => {
    if (!activeItem) {
      return false;
    }

    const activeGroup = playbackOrderGroupsRef.current.find((group) => group.trackPaths.includes(activeItem.path));
    if (!activeGroup || activeGroup.trackPaths.length === 0) {
      return false;
    }

    const currentIndex = activeGroup.trackPaths.findIndex((trackPath) => trackPath === activeItem.path);
    if (currentIndex < 0) {
      return false;
    }

    const nextPath = activeGroup.trackPaths[(currentIndex + 1) % activeGroup.trackPaths.length];
    const nextItem = library.find((item) => item.path === nextPath && item.isMetadataLoaded);
    if (!nextItem) {
      return false;
    }

    setActivePath(nextItem.path);
    setStatus(`Now playing: ${nextItem.metadata.title || nextItem.name}`);
    return true;
  }, [activeItem, library, setActivePath]);

  const handlePlaybackOrderChange = useCallback((groups: LibraryPanePlaybackOrderGroup[]) => {
    playbackOrderGroupsRef.current = groups;
  }, []);

  useEffect(() => {
    if (!hasWebDownloadsEnabled && isDownloadDialogOpen) {
      setIsDownloadDialogOpen(false);
    }
  }, [hasWebDownloadsEnabled, isDownloadDialogOpen]);

  useEffect(() => {
    let cancelled = false;

    const scanPlugins = async () => {
      const normalizedPaths = normalizeStoredPluginPaths(vstPluginPaths);
      setIsScanningVstPlugins(true);

      try {
        const api = requireAudioMetaApi();
        const scannedPlugins = await api.scanVstPlugins({ paths: normalizedPaths });
        if (!cancelled) {
          setVstPlugins(scannedPlugins);
        }
      } catch {
        if (!cancelled) {
          setVstPlugins([]);
        }
      } finally {
        if (!cancelled) {
          setIsScanningVstPlugins(false);
        }
      }
    };

    void scanPlugins();

    return () => {
      cancelled = true;
    };
  }, [vstPluginPaths]);

  useEffect(() => {
    if (splitDownloadIntoChapters || downloadTargetMode !== 'video-name-album') {
      return;
    }

    if (downloadAlbumOptions.length > 0) {
      const hasExisting = downloadAlbumOptions.some((option) => option.directory === downloadTargetExistingDirectory);
      setDownloadTargetExistingDirectory(hasExisting ? downloadTargetExistingDirectory : downloadAlbumOptions[0]?.directory ?? '');
      setDownloadTargetMode('existing');
      return;
    }

    setDownloadTargetMode('new');
  }, [downloadAlbumOptions, downloadTargetExistingDirectory, downloadTargetMode, splitDownloadIntoChapters]);

  useEffect(() => {
    if (startupTimerRef.current !== null) {
      endPerfTimer('renderer:first-mount', startupTimerRef.current);
      logMemorySnapshot('renderer:first-mount');
      startupTimerRef.current = null;
    }

    const handleKeyPress = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isTypingTarget =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);

      if (isTypingTarget) {
        return;
      }

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

  function openSettingsDialog() {
    setIsWebDownloadEnabledDraft(isWebDownloadEnabled);
    setHasAcceptedWebDownloadNoticeDraft(isWebDownloadEnabled);
    setIsWebDownloadNoticeOpen(false);
    setVstPluginPathsDraft(vstPluginPaths);
    setVstPluginPathDraftInput('');
    setVstHostExecutablePathDraft(vstHostExecutablePath);
    setIsSettingsDialogOpen(true);
  }

  async function scanVstPluginsForPaths(pathsToScan: string[], options?: { silent?: boolean }) {
    const normalizedPaths = normalizeStoredPluginPaths(pathsToScan);
    setIsScanningVstPlugins(true);

    try {
      const api = requireAudioMetaApi();
      const scannedPlugins = await api.scanVstPlugins({ paths: normalizedPaths });
      setVstPlugins(scannedPlugins);
      if (!options?.silent) {
        setStatus(
          normalizedPaths.length === 0
            ? 'Plugin scan skipped: add one or more plugin folders first.'
            : `Found ${scannedPlugins.length} plugin${scannedPlugins.length === 1 ? '' : 's'}.`,
        );
      }
    } catch (error) {
      if (!options?.silent) {
        setStatus(toUserErrorMessage(error, 'Unable to scan configured plugin folders.'));
      }
    } finally {
      setIsScanningVstPlugins(false);
    }
  }

  async function discoverDefaultVstPaths() {
    setIsDiscoveringDefaultVstPaths(true);

    try {
      const api = requireAudioMetaApi();
      const discoveredPaths = await api.discoverDefaultPluginPaths();
      const mergedPaths = normalizeStoredPluginPaths([...vstPluginPathsDraft, ...discoveredPaths]);
      setVstPluginPathsDraft(mergedPaths);
      setStatus(`Found ${discoveredPaths.length} common plugin folder${discoveredPaths.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to discover default plugin folders.'));
    } finally {
      setIsDiscoveringDefaultVstPaths(false);
    }
  }

  function addDraftPluginPath() {
    const candidatePath = vstPluginPathDraftInput.trim();
    if (!candidatePath) {
      return;
    }

    if (!isAbsolutePath(candidatePath)) {
      setStatus('Plugin paths must be absolute paths.');
      return;
    }

    setVstPluginPathsDraft((current) => normalizeStoredPluginPaths([...current, candidatePath]));
    setVstPluginPathDraftInput('');
  }

  function removeDraftPluginPath(pathToRemove: string) {
    const normalizedTargetPath = pathToRemove.toLowerCase();
    setVstPluginPathsDraft((current) => current.filter((entry) => entry.toLowerCase() !== normalizedTargetPath));
  }

  function assignPluginToRackSlot(slotNumber: number, pluginId: string | null) {
    setVstRackSlots((currentSlots) =>
      currentSlots.map((slot) =>
        slot.slot === slotNumber
          ? {
              ...slot,
              pluginId,
              enabled: pluginId ? (slot.pluginId === pluginId ? slot.enabled : true) : false,
            }
          : slot,
      ),
    );
  }

  function toggleRackSlot(slotNumber: number) {
    setVstRackSlots((currentSlots) =>
      currentSlots.map((slot) =>
        slot.slot === slotNumber && slot.pluginId
          ? {
              ...slot,
              enabled: !slot.enabled,
            }
          : slot,
      ),
    );
  }

  async function applyVstRackToTrack() {
    if (!activeItem) {
      setStatus('Select a track first.');
      return;
    }

    const pluginById = new Map(vstPlugins.map((plugin) => [plugin.id, plugin.filePath]));
    const enabledPluginPaths = vstRackSlots
      .filter((slot) => slot.enabled && slot.pluginId)
      .map((slot) => (slot.pluginId ? pluginById.get(slot.pluginId) : null))
      .filter((pluginPath): pluginPath is string => typeof pluginPath === 'string' && pluginPath.trim().length > 0);

    if (enabledPluginPaths.length === 0) {
      setStatus('Enable at least one rack plugin before applying.');
      return;
    }

    setIsApplyingVstRack(true);
    try {
      setStatus(`Rendering rack with ${enabledPluginPaths.length} plugin${enabledPluginPaths.length === 1 ? '' : 's'}...`);

      const api = requireAudioMetaApi();
      const trimmedHostPath = vstHostExecutablePath.trim();
      const result = await api.applyVstRack({
        filePath: activeItem.path,
        pluginPaths: enabledPluginPaths,
        ...(trimmedHostPath ? { hostExecutablePath: trimmedHostPath } : {}),
      });

      if (!result) {
        setStatus('VST rack render cancelled.');
        return;
      }

      await loadPaths([result.outputPath], result.outputPath);
      setStatus(`Rendered VST rack to ${result.outputPath}.`);
    } finally {
      setIsApplyingVstRack(false);
    }
  }

  function openDownloadDialog() {
    if (downloadAlbumOptions.length > 0) {
      const hasExisting = downloadAlbumOptions.some((option) => option.directory === downloadTargetExistingDirectory);
      const fallbackDirectory = downloadAlbumOptions[0]?.directory ?? '';
      setDownloadTargetExistingDirectory(hasExisting ? downloadTargetExistingDirectory : fallbackDirectory);
      setDownloadTargetMode('existing');
    } else {
      setDownloadTargetMode('new');
      setDownloadTargetExistingDirectory('');
    }

    setDownloadTargetNewAlbumName('');
    setIsDownloadDialogOpen(true);
  }

  async function saveSettings() {
    const nextEnabled = isWebDownloadEnabledDraft;
    const enablingNow = nextEnabled && !isWebDownloadEnabled;
    const nextPluginPaths = normalizeStoredPluginPaths(vstPluginPathsDraft);
    const nextVstHostExecutablePath = vstHostExecutablePathDraft.trim();

    if (enablingNow && !hasAcceptedWebDownloadNoticeDraft) {
      setIsWebDownloadNoticeOpen(true);
      setStatus('Accept the warning notice before saving this change.');
      return;
    }

    setIsApplyingWebDownloadSettings(true);

    try {
      const api = requireAudioMetaApi();
      const result = await api.configureWebDownloadTools({
        enabled: nextEnabled,
        acceptedWarning: !nextEnabled || hasAcceptedWebDownloadNoticeDraft,
      });
      window.localStorage.setItem(SETTINGS_USE_WEB_DOWNLOADS_KEY, String(nextEnabled));
      window.localStorage.setItem(SETTINGS_VST_PLUGIN_PATHS_KEY, JSON.stringify(nextPluginPaths));
      window.localStorage.setItem(SETTINGS_VST_HOST_PATH_KEY, nextVstHostExecutablePath);
      window.localStorage.removeItem(LEGACY_SETTINGS_YTDLP_PATH_KEY);
      setIsWebDownloadEnabled(nextEnabled);
      setVstPluginPaths(nextPluginPaths);
      setVstHostExecutablePath(nextVstHostExecutablePath);
      setIsSettingsDialogOpen(false);
      setIsWebDownloadNoticeOpen(false);
      setHasAcceptedWebDownloadNoticeDraft(nextEnabled);

      if (result.restartRequired && enablingNow) {
        setStatus('yt-dlp installed. Restarting app...');
        const restartResult = await api.restartApplication();
        if (!restartResult.restarting) {
          setStatus('yt-dlp installed. Restart skipped in dev mode.');
        }
        return;
      }

      if (result.installed) {
        setStatus('yt-dlp installed successfully.');
        return;
      }

      setStatus(nextEnabled ? 'Web downloads are enabled.' : 'Web downloads are disabled.');

      if (
        nextPluginPaths.length !== vstPluginPaths.length ||
        nextPluginPaths.some((entry, index) => entry !== vstPluginPaths[index])
      ) {
        await scanVstPluginsForPaths(nextPluginPaths, { silent: true });
      }
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to apply web download settings.'));
    } finally {
      setIsApplyingWebDownloadSettings(false);
    }
  }

  function truncateStatusMessage(message: string, maxLength = 110) {
    if (message.length <= maxLength) {
      return message;
    }

    return `${message.slice(0, maxLength - 1)}…`;
  }

  async function copyLastErrorStatus() {
    if (!lastErrorStatus) {
      return;
    }

    try {
      await navigator.clipboard.writeText(lastErrorStatus);
      setStatus('Copied error message to clipboard.');
    } catch {
      setStatus('Unable to copy error message.');
    }
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
          {hasWebDownloadsEnabled ? (
            <button className="secondary-button" onClick={openDownloadDialog} type="button">
              Download from URL
            </button>
          ) : null}
          <button className="secondary-button" onClick={() => void handleOpenFiles()} type="button">
            Open file
          </button>
          <button className="primary-button" onClick={() => void handleOpenDirectory()} type="button">
            Open directory
          </button>
          <button
            aria-label="Open settings"
            className="secondary-button action-icon-button"
            onClick={openSettingsDialog}
            title="Settings"
            type="button"
          >
            <HugeiconsIcon icon={Settings01Icon} size={28} strokeWidth={2.2} />
          </button>
        </div>
      </header>

      <main className={`layout-grid${isAnyResizing ? ' resizing' : ''}`} ref={layoutRef} style={composedLayoutStyle}>
        <LibraryPane
          items={library}
          currentPath={activeItem?.path ?? null}
          isLoading={isLoadingLibrary}
          loadingProgress={libraryLoadingProgress}
          isTrackEditingLocked={isTrackMetadataEditingLocked}
          onPlaybackOrderChange={handlePlaybackOrderChange}
          onApplyAlbumFields={handleApplyAlbumFields}
          onMoveTrackToAlbum={handleMoveTrackToAlbum}
          onDuplicateTrack={handleDuplicateTrack}
          onDeleteTrack={handleDeleteTrack}
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
            onAdvanceToNextTrack={handleAdvanceToNextTrack}
            onEditSelection={handleEditSelection}
            onSplitSelection={handleSplitSelectionToTrack}
            onExportClip={handleExportClip}
            onConvertAudio={handleConvertAudio}
            vstPlugins={vstPlugins}
            vstRackSlots={vstRackSlots}
            onAssignPluginToRackSlot={assignPluginToRackSlot}
            onToggleRackSlot={toggleRackSlot}
            onRemovePluginFromRackSlot={(slotNumber) => assignPluginToRackSlot(slotNumber, null)}
            onApplyVstRack={applyVstRackToTrack}
            isApplyingVstRack={isApplyingVstRack}
            isConverting={isConverting}
            isEditingSelection={isEditingSelection}
            isSplittingSelection={isSplittingSelection}
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
          <div className="status-bar" title={isLoadingLibrary ? 'Loading library...' : status}>
            <span className="status-bar-text">
              {truncateStatusMessage(isLoadingLibrary ? 'Loading library...' : status)}
            </span>
            {lastErrorStatus ? (
              <button
                aria-label="Copy latest error message"
                className="status-copy-button"
                onClick={() => void copyLastErrorStatus()}
                title="Copy latest error message"
                type="button"
              >
                <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.9} />
              </button>
            ) : null}
          </div>
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
          isEditingLocked={isTrackMetadataEditingLocked}
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
              <p>Uses yt-dlp to download audio from supported URLs.</p>
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

            <label className="settings-field">
              File type
              <select
                onChange={(event) =>
                  setDownloadFormat(event.target.value as 'flac' | 'mp3' | 'wav' | 'm4a')
                }
                value={downloadFormat}
              >
                <option value="flac">FLAC</option>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="m4a">M4A</option>
              </select>
            </label>

            <label className="settings-field">
              Destination
              <select
                onChange={(event) => {
                  if (event.target.value === '__new_album__') {
                    setDownloadTargetMode('new');
                    return;
                  }

                  if (event.target.value === '__video_name_album__') {
                    setDownloadTargetMode('video-name-album');
                    return;
                  }

                  setDownloadTargetMode('existing');
                  setDownloadTargetExistingDirectory(event.target.value);
                }}
                value={
                  downloadTargetMode === 'new'
                    ? '__new_album__'
                    : downloadTargetMode === 'video-name-album'
                      ? '__video_name_album__'
                      : downloadTargetExistingDirectory
                }
              >
                {downloadAlbumOptions.map((option) => (
                  <option key={option.directory} value={option.directory}>
                    {option.label}
                  </option>
                ))}
                <option value="__new_album__">Download to new album</option>
                {splitDownloadIntoChapters ? (
                  <option value="__video_name_album__">Use video name as Album</option>
                ) : null}
              </select>
            </label>

            {downloadTargetMode === 'new' ? (
              <label className="settings-field">
                New album name
                <input
                  onChange={(event) => setDownloadTargetNewAlbumName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleDownloadFromUrl();
                    }
                  }}
                  placeholder="Enter album name"
                  value={downloadTargetNewAlbumName}
                />
              </label>
            ) : null}

            <div className="download-chapters-toggle-wrap">
              <div className="download-chapters-toggle-copy">
                <strong>Split download into specified chapters</strong>
                <span>
                  When chapter markers are available, yt-dlp will split the download into chapter-based files.
                </span>
              </div>
              <label className="album-edit-switch" title="Split into chapters">
                <input
                  checked={splitDownloadIntoChapters}
                  className="album-edit-switch-input"
                  onChange={(event) => setSplitDownloadIntoChapters(event.target.checked)}
                  type="checkbox"
                />
                <span className="album-edit-switch-track" />
              </label>
            </div>

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
                disabled={
                  isDownloadingFromUrl ||
                  !downloadUrl.trim() ||
                  (downloadTargetMode === 'existing' && !downloadTargetExistingDirectory.trim()) ||
                  (downloadTargetMode === 'new' && !downloadTargetNewAlbumName.trim())
                }
                onClick={() => void handleDownloadFromUrl()}
                type="button"
              >
                {isDownloadingFromUrl ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isSettingsDialogOpen ? (
        <div
          className="download-dialog-backdrop"
          onClick={() => setIsSettingsDialogOpen(false)}
          role="presentation"
        >
          <section className="download-dialog settings-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="download-dialog-heading">
              <p className="eyebrow">Settings</p>
              <h2>Download tools</h2>
              <p>Control whether web audio downloads are enabled through managed yt-dlp.</p>
            </div>

            <div className="download-chapters-toggle-wrap">
              <div className="download-chapters-toggle-copy">
                <strong>Use yt-dlp to download audio from web</strong>
                <span>Enables Download from URL in the top bar.</span>
              </div>
              <label className="album-edit-switch" title="Use yt-dlp to download audio from web">
                <input
                  autoFocus
                  checked={isWebDownloadEnabledDraft}
                  className="album-edit-switch-input"
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setIsWebDownloadEnabledDraft(nextChecked);
                    if (nextChecked && !isWebDownloadEnabled) {
                      setHasAcceptedWebDownloadNoticeDraft(false);
                      setIsWebDownloadNoticeOpen(true);
                    } else if (!nextChecked) {
                      setHasAcceptedWebDownloadNoticeDraft(false);
                    }
                  }}
                  type="checkbox"
                />
                <span className="album-edit-switch-track" />
              </label>
            </div>

            <p className="settings-help">
              When enabled and saved, the app downloads yt-dlp as a managed dependency and restarts.
            </p>

            <section className="settings-plugin-section">
              <div className="settings-plugin-heading">
                <strong>VST plugin folders</strong>
                <span>Add one or more folders where your plugins are installed.</span>
              </div>

              <div className="settings-plugin-add-row">
                <input
                  onChange={(event) => setVstPluginPathDraftInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addDraftPluginPath();
                    }
                  }}
                  placeholder="C:\\Program Files\\Common Files\\VST3"
                  value={vstPluginPathDraftInput}
                />
                <button className="secondary-button" onClick={addDraftPluginPath} type="button">
                  Add path
                </button>
              </div>

              <div className="settings-plugin-path-list" role="list" aria-label="Configured plugin folders">
                {vstPluginPathsDraft.length === 0 ? (
                  <p className="settings-plugin-empty">No plugin folders configured yet.</p>
                ) : (
                  vstPluginPathsDraft.map((pluginPath) => (
                    <div className="settings-plugin-path-row" key={pluginPath} role="listitem">
                      <span>{pluginPath}</span>
                      <button
                        className="secondary-button"
                        onClick={() => removeDraftPluginPath(pluginPath)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="settings-plugin-actions">
                <button
                  className="secondary-button"
                  disabled={isDiscoveringDefaultVstPaths}
                  onClick={() => void discoverDefaultVstPaths()}
                  type="button"
                >
                  {isDiscoveringDefaultVstPaths ? 'Searching...' : 'Scan common locations'}
                </button>
                <button
                  className="secondary-button"
                  disabled={isScanningVstPlugins}
                  onClick={() => void scanVstPluginsForPaths(vstPluginPathsDraft)}
                  type="button"
                >
                  {isScanningVstPlugins ? 'Scanning plugins...' : 'Scan plugins now'}
                </button>
              </div>

              <p className="settings-help">
                Last scan found {vstPlugins.length} plugin{vstPlugins.length === 1 ? '' : 's'}.
              </p>

              <label className="settings-field">
                VST host executable (optional)
                <input
                  onChange={(event) => setVstHostExecutablePathDraft(event.target.value)}
                  placeholder="mrswatson64"
                  value={vstHostExecutablePathDraft}
                />
              </label>

              <p className="settings-help">
                Leave empty to auto-detect mrswatson64 or mrswatson from PATH.
              </p>
            </section>

            <div className="download-dialog-actions">
              <button
                className="secondary-button"
                disabled={isApplyingWebDownloadSettings}
                onClick={() => setIsSettingsDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  isApplyingWebDownloadSettings ||
                  (isWebDownloadEnabledDraft && !isWebDownloadEnabled && !hasAcceptedWebDownloadNoticeDraft)
                }
                onClick={() => void saveSettings()}
                type="button"
              >
                {isApplyingWebDownloadSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isWebDownloadNoticeOpen ? (
        <div className="download-dialog-backdrop" onClick={() => setIsWebDownloadNoticeOpen(false)} role="presentation">
          <section className="download-dialog settings-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="download-dialog-heading">
              <p className="eyebrow">Notice</p>
              <h2>yt-dlp will be installed</h2>
              <p>
                If you save these settings, the app will download yt-dlp as a dependency and restart automatically.
              </p>
            </div>
            <div className="download-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setIsWebDownloadEnabledDraft(false);
                  setHasAcceptedWebDownloadNoticeDraft(false);
                  setIsWebDownloadNoticeOpen(false);
                }}
                type="button"
              >
                Cancel enabling
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setHasAcceptedWebDownloadNoticeDraft(true);
                  setIsWebDownloadNoticeOpen(false);
                }}
                type="button"
              >
                I Understand
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
