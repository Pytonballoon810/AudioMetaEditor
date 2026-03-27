import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AudioLibraryItem } from '../../types';
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
  const [isExporting, setIsExporting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isEditingSelection, setIsEditingSelection] = useState(false);
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
    isDownloadingFromUrl,
    handleExportClip,
    handleConvertAudio,
    handleEditSelection,
    handleMoveTrackToAlbum,
    handleDownloadFromUrl,
    handleOpenFileLocation,
    handleSaveCoverImage,
  };
}
