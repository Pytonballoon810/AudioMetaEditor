import type { AudioLibraryItem, EditableMetadata } from '../types';

export type ApiLogPayload = {
  level: 'info' | 'error';
  message: string;
  timestamp: number;
};

export type DownloadFromUrlPayload = { url: string };
export type DownloadFromUrlResult = { outputPath: string } | null;

export type SaveMetadataPayload = { filePath: string; metadata: EditableMetadata };
export type SaveMetadataResult = {
  filePath: string;
  metadata: AudioLibraryItem['metadata'];
};

export type MoveTrackToAlbumPayload = { filePath: string; targetDirectory: string };
export type MoveTrackToAlbumResult = { sourcePath: string; destinationPath: string };

export type ExportClipPayload = { filePath: string; startTime: number; endTime: number };
export type ExportClipResult = { outputPath: string } | null;

export type EditSelectionPayload = ExportClipPayload & { mode: 'trim' | 'cut' };
export type EditSelectionResult = { outputPath: string } | null;

export interface AudioMetaApi {
  openAudioFiles: () => Promise<string[]>;
  openDirectory: () => Promise<string[]>;
  loadLibrary: (paths: string[]) => Promise<AudioLibraryItem[]>;
  downloadFromUrl: (payload: DownloadFromUrlPayload) => Promise<DownloadFromUrlResult>;
  saveMetadata: (payload: SaveMetadataPayload) => Promise<SaveMetadataResult>;
  moveTrackToAlbum: (payload: MoveTrackToAlbumPayload) => Promise<MoveTrackToAlbumResult>;
  exportClip: (payload: ExportClipPayload) => Promise<ExportClipResult>;
  editSelection: (payload: EditSelectionPayload) => Promise<EditSelectionResult>;
  loadAudioBlob: (filePath: string) => Promise<string>;
  onOpenPaths: (callback: (paths: string[]) => void) => () => void;
  onApiLog: (callback: (payload: ApiLogPayload) => void) => () => void;
  toMediaUrl: (filePath: string) => string;
}
