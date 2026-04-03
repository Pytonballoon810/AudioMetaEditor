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
}: UseTransportActionsArgs) {
  const normalizePathForComparison = (pathValue: string) => pathValue.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();

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

    setIsDownloadingFromUrl(true);
    setStatus('Downloading audio from URL...');

    try {
      const api = requireAudioMetaApi();
      const result = await api.downloadFromUrl({ url });
      if (!result) {
        setStatus('Download cancelled.');
        return;
      }

      await loadPaths([result.outputPath], result.outputPath);
      setIsDownloadDialogOpen(false);
      setDownloadUrl('');
      setStatus(`Downloaded audio to ${result.outputPath}.`);
    } catch (error) {
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
