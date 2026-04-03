import { useMemo } from 'react';
import type { AudioLibraryItem, MetadataSuggestions } from '../../types';

const ALBUM_MISMATCH_FIELDS = ['artist', 'album', 'producer', 'composer', 'genre', 'year'] as const;

type AlbumMismatchField = (typeof ALBUM_MISMATCH_FIELDS)[number];
export type AlbumMismatchMap = Record<AlbumMismatchField, boolean>;

function normalizeMetadataValue(value: string) {
  return value.trim();
}

function mostFrequentValue(items: AudioLibraryItem[], selector: (item: AudioLibraryItem) => string) {
  const counts = new Map<string, number>();
  const nonEmptyCounts = new Map<string, number>();

  items.forEach((item) => {
    const value = normalizeMetadataValue(selector(item));
    const nextCount = (counts.get(value) ?? 0) + 1;
    counts.set(value, nextCount);

    if (value) {
      nonEmptyCounts.set(value, (nonEmptyCounts.get(value) ?? 0) + 1);
    }
  });

  const selectBest = (source: Map<string, number>) => {
    let candidate = '';
    let highestCount = 0;

    source.forEach((count, value) => {
      if (count > highestCount || (count === highestCount && value.localeCompare(candidate) < 0)) {
        highestCount = count;
        candidate = value;
      }
    });

    return candidate;
  };

  if (nonEmptyCounts.size > 0) {
    return selectBest(nonEmptyCounts);
  }

  return selectBest(counts);
}

function folderNameFromPath(directoryPath: string) {
  const normalized = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || directoryPath;
}

type UseLibraryDerivationsArgs = {
  library: AudioLibraryItem[];
  activeItem: AudioLibraryItem | null;
};

export function useLibraryDerivations({ library, activeItem }: UseLibraryDerivationsArgs) {
  const metadataSuggestions: MetadataSuggestions = useMemo(() => {
    const suggestions = {
      artists: new Set<string>(),
      albums: new Set<string>(),
      genres: new Set<string>(),
      composers: new Set<string>(),
      producers: new Set<string>(),
      albumArtists: new Set<string>(),
    };

    library.forEach((item) => {
      if (item.metadata.artist) suggestions.artists.add(item.metadata.artist);
      if (item.metadata.album) suggestions.albums.add(item.metadata.album);
      if (item.metadata.genre) suggestions.genres.add(item.metadata.genre);
      if (item.metadata.composer) suggestions.composers.add(item.metadata.composer);
      if (item.metadata.producer) suggestions.producers.add(item.metadata.producer);
      if (item.metadata.albumArtist) suggestions.albumArtists.add(item.metadata.albumArtist);
    });

    return {
      artists: Array.from(suggestions.artists).sort(),
      albums: Array.from(suggestions.albums).sort(),
      genres: Array.from(suggestions.genres).sort(),
      composers: Array.from(suggestions.composers).sort(),
      producers: Array.from(suggestions.producers).sort(),
      albumArtists: Array.from(suggestions.albumArtists).sort(),
    };
  }, [library]);

  const activeAlbumTrackCount = useMemo(() => {
    if (!activeItem) {
      return 0;
    }

    return library.filter((item) => item.directory === activeItem.directory).length;
  }, [activeItem, library]);

  const activeAlbumCoverOptions = useMemo(() => {
    if (!activeItem) {
      return [] as string[];
    }

    return Array.from(
      new Set(
        library
          .filter((item) => item.directory === activeItem.directory)
          .map((item) => item.metadata.coverArt)
          .filter((cover): cover is string => Boolean(cover)),
      ),
    );
  }, [activeItem, library]);

  const activeOtherTrackCoverOptions = useMemo(() => {
    if (!activeItem) {
      return [] as Array<{
        coverArt: string;
        albumName: string;
      }>;
    }

    const sortedCandidates = library
      .filter((item) => item.path !== activeItem.path)
      .filter((item) => Boolean(item.metadata.coverArt))
      .map((item) => ({
        coverArt: item.metadata.coverArt as string,
        albumName: item.metadata.album || folderNameFromPath(item.directory),
      }))
      .sort((left, right) => left.albumName.localeCompare(right.albumName));

    const uniqueByCover = new Map<string, { coverArt: string; albumName: string }>();
    sortedCandidates.forEach((candidate) => {
      if (!uniqueByCover.has(candidate.coverArt)) {
        uniqueByCover.set(candidate.coverArt, candidate);
      }
    });

    return Array.from(uniqueByCover.values());
  }, [activeItem, library]);

  const activeAlbumMismatchFields = useMemo<AlbumMismatchMap>(() => {
    const defaults: AlbumMismatchMap = {
      artist: false,
      album: false,
      producer: false,
      composer: false,
      genre: false,
      year: false,
    };

    if (!activeItem) {
      return defaults;
    }

    if (activeItem.isInOpenedDirectoryRoot) {
      return defaults;
    }

    const albumItems = library.filter((item) => item.directory === activeItem.directory);
    if (albumItems.length < 2) {
      return defaults;
    }

    const next = { ...defaults };

    ALBUM_MISMATCH_FIELDS.forEach((field) => {
      const uniqueValues = new Set(albumItems.map((item) => normalizeMetadataValue(item.metadata[field])));
      if (uniqueValues.size < 2) {
        next[field] = false;
        return;
      }

      const canonical = mostFrequentValue(albumItems, (item) => item.metadata[field]);
      next[field] = normalizeMetadataValue(activeItem.metadata[field]) !== canonical;
    });

    return next;
  }, [activeItem, library]);

  return {
    metadataSuggestions,
    activeAlbumTrackCount,
    activeAlbumCoverOptions,
    activeOtherTrackCoverOptions,
    activeAlbumMismatchFields,
  };
}
