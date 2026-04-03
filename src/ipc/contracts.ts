import type { AudioLibraryItem, EditableMetadata } from '../types';

export type ApiLogPayload = {
  level: 'info' | 'error';
  message: string;
  timestamp: number;
};

export type LibraryProgressPayload = {
  phase?: 'discovering' | 'indexing';
  loaded: number;
  total: number;
  indexed?: number;
  items: AudioLibraryItem[];
};

export type LibraryChangedPayload = {
  changedPath: string;
  addedPaths: string[];
  removedPaths: string[];
  changedPaths: string[];
  timestamp: number;
};

export type DownloadFromUrlPayload = {
  url: string;
  targetAlbumDirectory?: string;
  newAlbumName?: string;
  newAlbumParentDirectory?: string;
  splitIntoChapters?: boolean;
};
export type DownloadFromUrlResult = { outputPath: string; outputPaths?: string[] } | null;

export type ConfigureWebDownloadToolsPayload = { enabled: boolean; acceptedWarning?: boolean };
export type ConfigureWebDownloadToolsResult = {
  enabled: boolean;
  installed: boolean;
  restartRequired: boolean;
};

export type SaveMetadataPayload = { filePath: string; metadata: EditableMetadata };
export type SaveMetadataResult = {
  sourcePath: string;
  filePath: string;
  metadata: AudioLibraryItem['metadata'];
};

export type MoveTrackToAlbumPayload = { filePath: string; targetDirectory: string };
export type MoveTrackToAlbumResult = { sourcePath: string; destinationPath: string };

export type TrackFilePayload = { filePath: string };
export type DuplicateTrackResult = { sourcePath: string; destinationPath: string };
export type DeleteTrackResult = { sourcePath: string };

export type OpenFileLocationPayload = { filePath: string };
export type SaveCoverImagePayload = { dataUrl: string; suggestedName?: string };
export type SaveCoverImageResult = { outputPath: string } | null;

export type ExportClipPayload = { filePath: string; startTime: number; endTime: number };
export type ExportClipResult = { outputPath: string } | null;

export type EditSelectionPayload = ExportClipPayload & { mode: 'trim' | 'cut' };
export type EditSelectionResult = { outputPath: string } | null;

export type SplitSelectionPayload = {
  filePath: string;
  startTime: number;
  endTime: number;
  title: string;
  splitMode: 'keep' | 'slice';
  sliceFromOriginal?: boolean;
  metadata: EditableMetadata;
};
export type SplitSelectionResult = { outputPath: string } | null;

export type ConvertAudioPayload = { filePath: string; targetFormat: 'mp3' | 'flac' };
export type ConvertAudioResult = { outputPath: string } | null;

export interface AudioMetaApi {
  openAudioFiles: () => Promise<string[]>;
  openDirectory: () => Promise<string[]>;
  loadLibrary: (paths: string[]) => Promise<AudioLibraryItem[]>;
  loadLibraryIncremental: (paths: string[]) => Promise<AudioLibraryItem[]>;
  configureWebDownloadTools: (payload: ConfigureWebDownloadToolsPayload) => Promise<ConfigureWebDownloadToolsResult>;
  restartApplication: () => Promise<{ restarting: boolean }>;
  downloadFromUrl: (payload: DownloadFromUrlPayload) => Promise<DownloadFromUrlResult>;
  saveMetadata: (payload: SaveMetadataPayload) => Promise<SaveMetadataResult>;
  moveTrackToAlbum: (payload: MoveTrackToAlbumPayload) => Promise<MoveTrackToAlbumResult>;
  duplicateTrack: (payload: TrackFilePayload) => Promise<DuplicateTrackResult>;
  deleteTrack: (payload: TrackFilePayload) => Promise<DeleteTrackResult>;
  openFileLocation: (payload: OpenFileLocationPayload) => Promise<{ revealedPath: string }>;
  saveCoverImage: (payload: SaveCoverImagePayload) => Promise<SaveCoverImageResult>;
  exportClip: (payload: ExportClipPayload) => Promise<ExportClipResult>;
  editSelection: (payload: EditSelectionPayload) => Promise<EditSelectionResult>;
  splitSelectionToTrack: (payload: SplitSelectionPayload) => Promise<SplitSelectionResult>;
  convertAudio: (payload: ConvertAudioPayload) => Promise<ConvertAudioResult>;
  loadAudioBlob: (filePath: string) => Promise<string>;
  onOpenPaths: (callback: (paths: string[]) => void) => () => void;
  onApiLog: (callback: (payload: ApiLogPayload) => void) => () => void;
  onLibraryProgress: (callback: (payload: LibraryProgressPayload) => void) => () => void;
  onLibraryChanged: (callback: (payload: LibraryChangedPayload) => void) => () => void;
  toMediaUrl: (filePath: string) => string;
}
