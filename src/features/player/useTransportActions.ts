import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AudioLibraryItem, EditableMetadata } from '../../types';
import type { AudioMetaApi } from '../../ipc/contracts';
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE, requireAudioMetaApi } from '../../services/audioMetaApi';
import { toUserErrorMessage } from '../../lib/errors';

type UseTransportActionsArgs = {
  activeItem: AudioLibraryItem | null;
  activePath: string | null;
  audioMetaApi: AudioMetaApi | undefined;
  library: AudioLibraryItem[];
  loadedSourcePaths: string[];
  setActivePath: (path: string | null) => void;
  setLibrary: Dispatch<SetStateAction<AudioLibraryItem[]>>;
  setLoadedSourcePaths: (paths: string[]) => void;
  setLibraryWidth: (width: number) => void;
  estimateLibraryWidthForItems: (items: AudioLibraryItem[]) => number;
  loadPaths: (paths: string[], preferredActivePath?: string | null) => Promise<void>;
  setStatus: (message: string) => void;
  downloadUrl: string;
  setDownloadUrl: (url: string) => void;
  setIsDownloadDialogOpen: (open: boolean) => void;
  downloadTargetMode: 'existing' | 'new' | 'video-name-album';
  downloadTargetExistingDirectory: string;
  downloadTargetNewAlbumName: string;
  downloadFormat: 'flac' | 'mp3' | 'wav' | 'm4a';
  splitDownloadIntoChapters: boolean;
  isWebDownloadEnabled: boolean;
};

export function useTransportActions({
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
}: UseTransportActionsArgs) {
  const normalizePathForComparison = (pathValue: string) => pathValue.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  const isSamePath = (leftPath: string, rightPath: string) =>
    normalizePathForComparison(leftPath) === normalizePathForComparison(rightPath);
  const isAbsolutePath = (pathValue: string) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue);

  const fileNameFromPath = (pathValue: string) => {
    const normalized = pathValue.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || pathValue;
  };

  const upsertLibraryItem = (items: AudioLibraryItem[], nextItem: AudioLibraryItem) => {
    const normalizedPath = normalizePathForComparison(nextItem.path);
    const existingIndex = items.findIndex((item) => normalizePathForComparison(item.path) === normalizedPath);
    if (existingIndex >= 0) {
      const updated = [...items];
      updated[existingIndex] = nextItem;
      return updated;
    }

    const inserted = [...items, nextItem];
    inserted.sort((left, right) => left.path.localeCompare(right.path));
    return inserted;
  };

  const removeLibraryItem = (items: AudioLibraryItem[], removedPath: string) => {
    const normalizedPath = normalizePathForComparison(removedPath);
    return items.filter((item) => normalizePathForComparison(item.path) !== normalizedPath);
  };

  const getDirectoryParent = (directoryPath: string) => directoryPath.replace(/[/\\][^/\\]+$/, '');
  const inferPathSeparator = (pathValue: string) => {
    const lastForwardSlash = pathValue.lastIndexOf('/');
    const lastBackslash = pathValue.lastIndexOf('\\');
    return lastBackslash > lastForwardSlash ? '\\' : '/';
  };
  const appendPathSegment = (basePath: string, segment: string) =>
    `${basePath.replace(/[/\\]+$/, '')}${inferPathSeparator(basePath)}${segment}`;
  const resolveDownloadParentDirectory = (existingDirectory: string) =>
    activeItem?.openedDirectoryRoot?.trim() ||
    library.find((item) => item.openedDirectoryRoot)?.openedDirectoryRoot?.trim() ||
    loadedSourcePaths
      .map((sourcePath) => sourcePath.trim())
      .find((sourcePath) => isAbsolutePath(sourcePath) && !/\.(mp3|wav|flac|m4a|opus|aac|ogg)$/i.test(sourcePath)) ||
    loadedSourcePaths
      .map((sourcePath) => sourcePath.trim())
      .find((sourcePath) => isAbsolutePath(sourcePath) && /\.(mp3|wav|flac|m4a|opus|aac|ogg)$/i.test(sourcePath))
      ?.replace(/[/\\][^/\\]+$/, '') ||
    (existingDirectory && isAbsolutePath(existingDirectory) ? getDirectoryParent(existingDirectory) : '');

  const buildPlaceholderItem = (
    placeholderPath: string,
    directoryPath: string,
    name: string,
    title: string,
    openedDirectoryRoot: string | null,
  ): AudioLibraryItem => ({
    path: placeholderPath,
    name,
    directory: directoryPath,
    extension: (name.split('.').pop() || 'download').toLowerCase(),
    openedDirectoryRoot,
    isInOpenedDirectoryRoot:
      Boolean(openedDirectoryRoot) && normalizePathForComparison(directoryPath) === normalizePathForComparison(openedDirectoryRoot || ''),
    isMetadataLoaded: false,
    metadata: {
      title,
      album: '',
      artist: '',
      albumArtist: '',
      composer: '',
      producer: '',
      genre: '',
      year: '',
      track: '',
      disc: '',
      comment: '',
      coverArt: null,
      duration: 0,
      sampleRate: 0,
      bitrate: 0,
      codec: '',
    },
  });

  const pickNextActivePathAfterRemoval = (
    currentItems: AudioLibraryItem[],
    nextItems: AudioLibraryItem[],
    currentActive: string | null,
    removedPath: string,
  ) => {
    if (!currentActive) {
      return nextItems.find((item) => item.isMetadataLoaded)?.path ?? null;
    }

    const normalizedRemoved = normalizePathForComparison(removedPath);
    const normalizedActive = normalizePathForComparison(currentActive);
    if (normalizedActive !== normalizedRemoved) {
      return currentActive;
    }

    const removedIndex = currentItems.findIndex((item) => normalizePathForComparison(item.path) === normalizedRemoved);
    if (removedIndex > 0) {
      const abovePath = currentItems[removedIndex - 1]?.path;
      if (abovePath && nextItems.some((item) => normalizePathForComparison(item.path) === normalizePathForComparison(abovePath))) {
        return abovePath;
      }
    }

    if (removedIndex >= 0) {
      const belowPath = currentItems[removedIndex + 1]?.path;
      if (belowPath && nextItems.some((item) => normalizePathForComparison(item.path) === normalizePathForComparison(belowPath))) {
        return belowPath;
      }
    }

    return nextItems.find((item) => item.isMetadataLoaded)?.path ?? null;
  };

  const [isExporting, setIsExporting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isEditingSelection, setIsEditingSelection] = useState(false);
  const [isSplittingSelection, setIsSplittingSelection] = useState(false);
  const [isDownloadingFromUrl, setIsDownloadingFromUrl] = useState(false);

  async function handleExportClip(startTime: number, endTime: number) {
    if (!activeItem) {
      return;
    }

    setIsExporting(true);
    setStatus(`Exporting clip from ${activeItem.name}...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.exportClip({ filePath: activeItem.path, startTime, endTime });
      setStatus(result ? `Clip exported to ${result.outputPath}.` : 'Clip export cancelled.');
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to export clip.'));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleEditSelection(mode: 'trim' | 'cut', startTime: number, endTime: number) {
    if (!activeItem) {
      return;
    }

    setIsEditingSelection(true);
    setStatus(`${mode === 'cut' ? 'Cutting out' : 'Trimming'} selection...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.editSelection({
        filePath: activeItem.path,
        startTime,
        endTime,
        mode,
      });

      if (!result) {
        setStatus(`${mode === 'cut' ? 'Cut' : 'Trim'} operation cancelled.`);
        return;
      }

      await loadPaths([result.outputPath], result.outputPath);
      setStatus(`${mode === 'cut' ? 'Cut' : 'Trim'} result saved to ${result.outputPath}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to edit selected audio section.'));
    } finally {
      setIsEditingSelection(false);
    }
  }

  async function handleConvertAudio(targetFormat: 'mp3' | 'flac') {
    if (!activeItem) {
      return;
    }

    setIsConverting(true);
    setStatus(`Converting ${activeItem.name} to ${targetFormat.toUpperCase()}...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.convertAudio({ filePath: activeItem.path, targetFormat });
      if (!result) {
        setStatus('Audio conversion cancelled.');
        return;
      }

      await loadPaths([result.outputPath], result.outputPath);
      setStatus(`Converted audio saved to ${result.outputPath}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to convert audio format.'));
    } finally {
      setIsConverting(false);
    }
  }

  async function handleSplitSelectionToTrack(
    startTime: number,
    endTime: number,
    splitMode: 'keep' | 'slice',
    splitTitle: string,
  ) {
    if (!activeItem) {
      return;
    }

    const nextTitle = splitTitle.trim();
    if (!nextTitle) {
      setStatus('Split track title cannot be empty.');
      return;
    }

    const metadataPayload: EditableMetadata = {
      title: nextTitle,
      album: activeItem.metadata.album,
      artist: activeItem.metadata.artist,
      albumArtist: activeItem.metadata.albumArtist,
      composer: activeItem.metadata.composer,
      producer: activeItem.metadata.producer,
      genre: activeItem.metadata.genre,
      year: activeItem.metadata.year,
      track: activeItem.metadata.track,
      disc: activeItem.metadata.disc,
      comment: activeItem.metadata.comment,
      coverArt: activeItem.metadata.coverArt,
    };

    setIsSplittingSelection(true);
    setStatus(
      splitMode === 'slice'
        ? `Splitting selection into new track "${nextTitle}" and slicing from original...`
        : `Splitting selection into new track "${nextTitle}"...`,
    );

    try {
      const api = requireAudioMetaApi();
      const result = await api.splitSelectionToTrack({
        filePath: activeItem.path,
        startTime,
        endTime,
        title: nextTitle,
        splitMode,
        sliceFromOriginal: splitMode === 'slice',
        metadata: metadataPayload,
      });

      if (!result) {
        setStatus('Split operation cancelled.');
        return;
      }

      const nextSourcePaths = loadedSourcePaths.length > 0 ? [...loadedSourcePaths] : [activeItem.path];
      if (
        !nextSourcePaths.includes(result.outputPath) &&
        nextSourcePaths.every((sourcePath) => sourcePath === activeItem.path)
      ) {
        nextSourcePaths.push(result.outputPath);
      }

      if (!api.loadLibraryIncremental) {
        setLoadedSourcePaths(nextSourcePaths);
        setActivePath(result.outputPath);
        setStatus(`Created split track at ${result.outputPath}.`);
        return;
      }

      const refreshedItems = await api.loadLibraryIncremental([result.outputPath, activeItem.path]);
      const harmonizedRefreshedItems = refreshedItems.map((refreshedItem) => {
        if (
          activeItem.metadata.coverArt &&
          normalizePathForComparison(refreshedItem.path) === normalizePathForComparison(result.outputPath)
        ) {
          return {
            ...refreshedItem,
            metadata: {
              ...refreshedItem.metadata,
              coverArt: activeItem.metadata.coverArt,
            },
          };
        }

        return refreshedItem;
      });

      const refreshedOutputItem = harmonizedRefreshedItems.find(
        (item) => normalizePathForComparison(item.path) === normalizePathForComparison(result.outputPath),
      );

      if (harmonizedRefreshedItems.length > 0) {
        let mergedLibrary = library;
        for (const refreshedItem of harmonizedRefreshedItems) {
          mergedLibrary = upsertLibraryItem(mergedLibrary, refreshedItem);
        }

        setLibrary(mergedLibrary);
        setLibraryWidth(estimateLibraryWidthForItems(mergedLibrary));
      }

      setLoadedSourcePaths(nextSourcePaths);
      setActivePath(refreshedOutputItem?.path ?? result.outputPath);
      setStatus(`Created split track at ${result.outputPath}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to split selected segment into a new track.'));
    } finally {
      setIsSplittingSelection(false);
    }
  }

  async function handleMoveTrackToAlbum(item: AudioLibraryItem, targetDirectory: string) {
    if (!audioMetaApi || typeof audioMetaApi.moveTrackToAlbum !== 'function') {
      setStatus(`Move API is unavailable. ${DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE}`);
      return;
    }

    if (item.directory === targetDirectory) {
      setStatus('Track is already in that album folder.');
      return;
    }

    setStatus(`Moving ${item.name}...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.moveTrackToAlbum({
        filePath: item.path,
        targetDirectory,
      });

      // Keep the current source list semantic (opened files/dirs) while rewriting moved file paths.
      const sourcePaths = loadedSourcePaths.length > 0 ? loadedSourcePaths : library.map((entry) => entry.path);
      const sourcePathSet = new Set(sourcePaths);
      const nextLoadedPaths = sourcePathSet.has(result.sourcePath)
        ? sourcePaths.map((sourcePath) => (sourcePath === result.sourcePath ? result.destinationPath : sourcePath))
        : sourcePaths;
      const refreshedLibrary = await api.loadLibrary(nextLoadedPaths);
      setLibrary(refreshedLibrary);
      setLoadedSourcePaths(nextLoadedPaths);
      setLibraryWidth(estimateLibraryWidthForItems(refreshedLibrary));

      const preferredActivePath = activePath === result.sourcePath ? result.destinationPath : activePath;
      const nextActivePath =
        preferredActivePath && refreshedLibrary.some((entry) => entry.path === preferredActivePath)
          ? preferredActivePath
          : (refreshedLibrary[0]?.path ?? null);
      setActivePath(nextActivePath);

      const nextDirectory = result.destinationPath.replace(/[/\\][^/\\]+$/, '');
      setStatus(`Moved ${item.name} to ${nextDirectory}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to move track to album folder.'));
    }
  }

  async function handleDuplicateTrack(item: AudioLibraryItem) {
    if (!audioMetaApi || typeof audioMetaApi.duplicateTrack !== 'function') {
      setStatus(`Duplicate API is unavailable. ${DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE}`);
      return;
    }

    setStatus(`Duplicating ${item.name}...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.duplicateTrack({ filePath: item.path });

      const nextSourcePaths = loadedSourcePaths.length > 0 ? [...loadedSourcePaths] : [item.path];
      if (
        !nextSourcePaths.includes(result.destinationPath) &&
        nextSourcePaths.every((sourcePath) => normalizePathForComparison(sourcePath) === normalizePathForComparison(item.path))
      ) {
        nextSourcePaths.push(result.destinationPath);
      }

      let nextLibrary = library;

      if (api.loadLibraryIncremental) {
        const refreshedItems = await api.loadLibraryIncremental([result.destinationPath]);
        for (const refreshedItem of refreshedItems) {
          nextLibrary = upsertLibraryItem(nextLibrary, refreshedItem);
        }
      } else {
        const extension = result.destinationPath.split('.').pop()?.toLowerCase() || item.extension;
        const fileName = result.destinationPath.split(/[/\\]/).pop() || item.name;
        const nextItem: AudioLibraryItem = {
          ...item,
          path: result.destinationPath,
          name: fileName,
          directory: result.destinationPath.replace(/[/\\][^/\\]+$/, ''),
          extension,
        };
        nextLibrary = upsertLibraryItem(nextLibrary, nextItem);
      }

      setLibrary(nextLibrary);
      setLibraryWidth(estimateLibraryWidthForItems(nextLibrary));
      setLoadedSourcePaths(nextSourcePaths);
      setActivePath(result.destinationPath);
      setStatus(`Duplicated track to ${result.destinationPath}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to duplicate track.'));
    }
  }

  async function handleDeleteTrack(item: AudioLibraryItem) {
    if (!audioMetaApi || typeof audioMetaApi.deleteTrack !== 'function') {
      setStatus(`Delete API is unavailable. ${DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE}`);
      return;
    }

    setStatus(`Deleting ${item.name}...`);

    try {
      const api = requireAudioMetaApi();
      const result = await api.deleteTrack({ filePath: item.path });
      const nextLibrary = removeLibraryItem(library, result.sourcePath);
      const nextLoadedSourcePaths = loadedSourcePaths.filter(
        (sourcePath) => normalizePathForComparison(sourcePath) !== normalizePathForComparison(result.sourcePath),
      );
      const nextActivePath = pickNextActivePathAfterRemoval(library, nextLibrary, activePath, result.sourcePath);

      setLibrary(nextLibrary);
      setLibraryWidth(estimateLibraryWidthForItems(nextLibrary));
      setLoadedSourcePaths(nextLoadedSourcePaths);
      setActivePath(nextActivePath);
      setStatus(`Deleted ${item.name}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to delete track.'));
    }
  }

  async function handleDownloadFromUrl() {
    const url = downloadUrl.trim();
    if (!url) {
      setStatus('Enter a URL to download audio.');
      return;
    }

    if (!isWebDownloadEnabled) {
      setStatus('Enable web downloads in Settings first.');
      return;
    }

    const existingDirectory = downloadTargetExistingDirectory.trim();
    const newAlbumName = downloadTargetNewAlbumName.trim();
    let destinationDirectory = '';
    const payload: {
      url: string;
      targetAlbumDirectory?: string;
      newAlbumName?: string;
      newAlbumParentDirectory?: string;
      useVideoNameAsAlbum?: boolean;
      downloadFormat?: 'flac' | 'mp3' | 'wav' | 'm4a';
      splitIntoChapters?: boolean;
    } = {
      url,
      downloadFormat,
      splitIntoChapters: splitDownloadIntoChapters,
    };

    if (downloadTargetMode === 'existing') {
      if (!existingDirectory) {
        setStatus('Choose an album to download into.');
        return;
      }

      if (!isAbsolutePath(existingDirectory)) {
        setStatus('Selected album directory is invalid. Choose an absolute folder path.');
        return;
      }

      payload.targetAlbumDirectory = existingDirectory;
      destinationDirectory = existingDirectory;
    } else if (downloadTargetMode === 'new') {
      if (!newAlbumName) {
        setStatus('Enter a new album name.');
        return;
      }

      const parentDirectoryCandidate = resolveDownloadParentDirectory(existingDirectory);

      if (!parentDirectoryCandidate || !isAbsolutePath(parentDirectoryCandidate)) {
        setStatus('Open a directory first so the new album location can be resolved.');
        return;
      }

      payload.newAlbumName = newAlbumName;
      payload.newAlbumParentDirectory = parentDirectoryCandidate;
      destinationDirectory = appendPathSegment(parentDirectoryCandidate, newAlbumName);
    } else {
      if (!splitDownloadIntoChapters) {
        setStatus('Enable chapter splitting to use video name as album.');
        return;
      }

      const parentDirectoryCandidate = resolveDownloadParentDirectory(existingDirectory);
      if (!parentDirectoryCandidate || !isAbsolutePath(parentDirectoryCandidate)) {
        setStatus('Open a directory first so the video-named album location can be resolved.');
        return;
      }

      payload.useVideoNameAsAlbum = true;
      payload.newAlbumParentDirectory = parentDirectoryCandidate;
      destinationDirectory = appendPathSegment(parentDirectoryCandidate, '(video title)');
    }

    const startedAt = Date.now();
    const pendingPlaceholderPath = `__pending_download__/${startedAt}-${Math.random().toString(36).slice(2)}.pending`;
    let outputPlaceholderPaths: string[] = [];
    const normalizedDestinationDirectory = destinationDirectory.replace(/[/\\]+$/g, '') || destinationDirectory;
    const openedDirectoryRoot =
      activeItem?.openedDirectoryRoot ||
      library.find((item) => item.openedDirectoryRoot)?.openedDirectoryRoot ||
      null;
    const pendingPlaceholderItem = buildPlaceholderItem(
      pendingPlaceholderPath,
      normalizedDestinationDirectory || '(pending)',
      'Download in progress...',
      'Download started',
      openedDirectoryRoot,
    );

    setLibrary((items) => {
      const nextItems = upsertLibraryItem(items, pendingPlaceholderItem);
      setLibraryWidth(estimateLibraryWidthForItems(nextItems));
      return nextItems;
    });

    setIsDownloadDialogOpen(false);
    setDownloadUrl('');
    setIsDownloadingFromUrl(true);
    setStatus('Download started');

    try {
      const api = requireAudioMetaApi();
      const result = await api.downloadFromUrl(payload);
      if (!result) {
        setLibrary((items) => {
          const nextItems = removeLibraryItem(items, pendingPlaceholderPath);
          setLibraryWidth(estimateLibraryWidthForItems(nextItems));
          return nextItems;
        });
        setStatus('Download cancelled.');
        return;
      }

      const downloadedPaths =
        Array.isArray(result.outputPaths) && result.outputPaths.length > 0 ? result.outputPaths : [result.outputPath];

      const perFilePlaceholders = downloadedPaths.map((downloadedPath, index) =>
        buildPlaceholderItem(
          downloadedPath,
          downloadedPath.replace(/[/\\][^/\\]+$/, ''),
          fileNameFromPath(downloadedPath),
          splitDownloadIntoChapters
            ? `Chapter ${index + 1} processing...`
            : 'Processing downloaded file...',
          openedDirectoryRoot,
        ),
      );
      outputPlaceholderPaths = perFilePlaceholders.map((item) => item.path);

      setLibrary((items) => {
        let nextItems = removeLibraryItem(items, pendingPlaceholderPath);
        for (const placeholderItem of perFilePlaceholders) {
          nextItems = upsertLibraryItem(nextItems, placeholderItem);
        }

        setLibraryWidth(estimateLibraryWidthForItems(nextItems));
        return nextItems;
      });

      const nextSourcePaths =
        loadedSourcePaths.length > 0
          ? Array.from(
              new Set([...loadedSourcePaths, ...downloadedPaths]),
            )
          : downloadedPaths;

      if (api.loadLibraryIncremental) {
        const refreshedItems = await api.loadLibraryIncremental(downloadedPaths);

        if (refreshedItems.length > 0) {
          setLibrary((items) => {
            let nextItems = items;
            for (const refreshedItem of refreshedItems) {
              nextItems = upsertLibraryItem(nextItems, refreshedItem);
            }

            setLibraryWidth(estimateLibraryWidthForItems(nextItems));
            return nextItems;
          });

          const refreshedOutputPath =
            refreshedItems.find((item) => isSamePath(item.path, result.outputPath))?.path ?? result.outputPath;
          setActivePath(refreshedOutputPath);
          setLoadedSourcePaths(nextSourcePaths);
        } else {
          // Fallback for environments where watcher updates are unavailable.
          await loadPaths(nextSourcePaths, result.outputPath);
        }
      } else {
        await loadPaths(nextSourcePaths, result.outputPath);
      }

      setStatus(
        splitDownloadIntoChapters
          ? `Downloaded and split into ${downloadedPaths.length} chapter file${downloadedPaths.length === 1 ? '' : 's'}.`
          : `Downloaded audio to ${result.outputPath}.`,
      );
    } catch (error) {
      setLibrary((items) => {
        const withoutPending = removeLibraryItem(items, pendingPlaceholderPath);
        const withoutOutputPlaceholders = withoutPending.filter(
          (item) => !outputPlaceholderPaths.some((placeholderPath) => isSamePath(item.path, placeholderPath)),
        );
        setLibraryWidth(estimateLibraryWidthForItems(withoutOutputPlaceholders));
        return withoutOutputPlaceholders;
      });
      setStatus(toUserErrorMessage(error, 'Unable to download audio from URL.'));
    } finally {
      setIsDownloadingFromUrl(false);
    }
  }

  async function handleOpenFileLocation(item: AudioLibraryItem) {
    if (!audioMetaApi || typeof audioMetaApi.openFileLocation !== 'function') {
      setStatus(`Open location API is unavailable. ${DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE}`);
      return;
    }

    try {
      await requireAudioMetaApi().openFileLocation({ filePath: item.path });
      setStatus(`Opened file location for ${item.name}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to open file location.'));
    }
  }

  async function handleSaveCoverImage(coverDataUrl: string | null, suggestedName: string) {
    if (!coverDataUrl) {
      setStatus('No cover image available to download.');
      return;
    }

    if (!audioMetaApi || typeof audioMetaApi.saveCoverImage !== 'function') {
      setStatus(`Cover download API is unavailable. ${DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE}`);
      return;
    }

    try {
      const result = await requireAudioMetaApi().saveCoverImage({
        dataUrl: coverDataUrl,
        suggestedName,
      });

      if (!result) {
        setStatus('Cover image download cancelled.');
        return;
      }

      setStatus(`Saved cover image to ${result.outputPath}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to save cover image.'));
    }
  }

  return {
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
  };
}
