export type EditableMetadata = {
  title: string;
  album: string;
  artist: string;
  albumArtist: string;
  composer: string;
  producer: string;
  genre: string;
  year: string;
  track: string;
  disc: string;
  comment: string;
  coverArt: string | null;
};

export type AudioMetadata = EditableMetadata & {
  duration: number;
  sampleRate: number;
  bitrate: number;
  codec: string;
};

export type AudioLibraryItem = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  openedDirectoryRoot: string | null;
  isInOpenedDirectoryRoot: boolean;
  metadata: AudioMetadata;
};

export type MetadataSuggestions = {
  artists: string[];
  albums: string[];
  genres: string[];
  composers: string[];
  producers: string[];
  albumArtists: string[];
};
