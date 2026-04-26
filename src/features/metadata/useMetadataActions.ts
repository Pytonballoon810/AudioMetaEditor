import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AudioLibraryItem, EditableMetadata } from '../../types';
import { requireAudioMetaApi } from '../../services/audioMetaApi';
import { toUserErrorMessage } from '../../lib/errors';

export type AlbumBulkEditableFields = Pick<
  EditableMetadata,
  'artist' | 'album' | 'producer' | 'composer' | 'genre' | 'year' | 'coverArt'
>;

export type AlbumBulkApplyFields = Partial<AlbumBulkEditableFields>;

type UseMetadataActionsArgs = {
  activeItem: AudioLibraryItem | null;
  library: AudioLibraryItem[];
  setLibrary: Dispatch<SetStateAction<AudioLibraryItem[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setStatus: (message: string) => void;
};

export function useMetadataActions({
  activeItem,
  library,
  setLibrary,
  setActivePath,
  setStatus,
}: UseMetadataActionsArgs) {
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlbum, setIsSavingAlbum] = useState(false);
  const isAbsolutePath = (pathValue: string) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue);
  const isSavableLibraryItem = (item: AudioLibraryItem) => item.isMetadataLoaded && isAbsolutePath(item.path);

  async function handleSaveMetadata(metadata: EditableMetadata) {
    if (!activeItem || !isSavableLibraryItem(activeItem)) {
      setStatus('Selected track is still processing and cannot be saved yet.');
      return;
    }

    setIsSaving(true);
    setStatus(`Saving metadata for ${activeItem.name}...`);

    try {
      const api = requireAudioMetaApi();
      if (metadata.coverArt && typeof metadata.coverArt === 'string') {
        console.log('[metadata-debug] save-track:cover-art-payload', {
          filePath: activeItem.path,
          coverPrefix: metadata.coverArt.slice(0, 40),
          payloadLength: metadata.coverArt.length,
        });
      }
      const result = await api.saveMetadata({ filePath: activeItem.path, metadata });
      setActivePath(result.filePath);

      if (metadata.coverArt && !result.metadata.coverArt) {
        console.warn('[metadata-debug] save-track:cover-missing-after-save', {
          filePath: activeItem.path,
        });
      }

      setLibrary((current) =>
        current.map((item) => {
          if (item.path !== result.sourcePath) {
            return item;
          }

          return {
            ...item,
            path: result.filePath,
            name: result.filePath.split(/[/\\]/).pop() || item.name,
            extension: result.filePath.split('.').pop()?.toLowerCase() || item.extension,
            metadata: result.metadata,
          };
        }),
      );

      if (result.filePath !== activeItem.path) {
        setStatus(
          `Converted ${activeItem.name} to ${result.filePath.split(/[/\\]/).pop() || 'FLAC'} to persist cover art.`,
        );
        return;
      }

      setStatus(`Updated metadata for ${activeItem.name}.`);
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to save metadata.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAlbumMetadata(metadata: EditableMetadata) {
    if (!activeItem) {
      return;
    }

    const albumItems = library.filter((item) => item.directory === activeItem.directory && isSavableLibraryItem(item));
    if (albumItems.length === 0) {
      setStatus('No completed tracks are ready for album metadata save yet.');
      return;
    }

    setIsSavingAlbum(true);
    setStatus(`Applying metadata to album (${albumItems.length} tracks)...`);

    const updatedByPath = new Map<string, AudioLibraryItem['metadata']>();
    let failed = 0;

    try {
      const api = requireAudioMetaApi();
      const results = await Promise.allSettled(
        albumItems.map((item) => {
          const albumScopedPayload: EditableMetadata = {
            ...item.metadata,
            album: metadata.album,
            albumArtist: metadata.albumArtist,
            composer: metadata.composer,
            producer: metadata.producer,
            genre: metadata.genre,
            year: metadata.year,
            coverArt: metadata.coverArt,
          };

          return api.saveMetadata({ filePath: item.path, metadata: albumScopedPayload });
        }),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          updatedByPath.set(result.value.filePath, result.value.metadata);
        } else {
          failed += 1;
        }
      });

      setLibrary((current) =>
        current.map((item) => {
          const updatedMetadata = updatedByPath.get(item.path);
          return updatedMetadata ? { ...item, metadata: updatedMetadata } : item;
        }),
      );

      const successCount = updatedByPath.size;
      if (failed > 0) {
        setStatus(`Updated ${successCount} track${successCount === 1 ? '' : 's'} in album, ${failed} failed.`);
      } else {
        setStatus(`Updated all ${successCount} track${successCount === 1 ? '' : 's'} in album.`);
      }
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to save album metadata.'));
    } finally {
      setIsSavingAlbum(false);
    }
  }

  async function handleApplyAlbumFields(folderPath: string, metadata: AlbumBulkApplyFields) {
    const albumItems = library.filter((item) => item.directory === folderPath && isSavableLibraryItem(item));
    if (albumItems.length === 0) {
      setStatus('No completed tracks are ready for album edits yet.');
      return;
    }

    setIsSavingAlbum(true);
    setStatus(`Applying album header edits (${albumItems.length} tracks)...`);

    const updatedByPath = new Map<string, AudioLibraryItem['metadata']>();
    let failed = 0;

    try {
      const api = requireAudioMetaApi();
      const results = await Promise.allSettled(
        albumItems.map((item) => {
          const payload: EditableMetadata = {
            ...item.metadata,
            ...metadata,
          };
          return api.saveMetadata({ filePath: item.path, metadata: payload });
        }),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          updatedByPath.set(result.value.filePath, result.value.metadata);
        } else {
          failed += 1;
        }
      });

      setLibrary((current) =>
        current.map((item) => {
          const updatedMetadata = updatedByPath.get(item.path);
          return updatedMetadata ? { ...item, metadata: updatedMetadata } : item;
        }),
      );

      const successCount = updatedByPath.size;
      if (failed > 0) {
        setStatus(
          `Applied album header edits to ${successCount} track${successCount === 1 ? '' : 's'}, ${failed} failed.`,
        );
      } else {
        setStatus(`Applied album header edits to all ${successCount} track${successCount === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      setStatus(toUserErrorMessage(error, 'Unable to apply album header edits.'));
    } finally {
      setIsSavingAlbum(false);
    }
  }

  return {
    isSaving,
    isSavingAlbum,
    handleSaveMetadata,
    handleSaveAlbumMetadata,
    handleApplyAlbumFields,
  };
}
