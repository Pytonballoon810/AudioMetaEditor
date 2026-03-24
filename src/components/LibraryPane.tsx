import { useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { AudioLibraryItem, EditableMetadata } from '../types';
import { formatDuration } from '../lib/format';
import { requireAudioMetaApi } from '../services/audioMetaApi';
import defaultCover from '../assets/defaultCover.png';

type LibraryPaneProps = {
  items: AudioLibraryItem[];
  currentPath: string | null;
  onSelect: (item: AudioLibraryItem) => void;
  onApplyAlbumFields: (folderPath: string, metadata: AlbumBulkEditFields) => Promise<void>;
  onMoveTrackToAlbum: (item: AudioLibraryItem, targetDirectory: string) => Promise<void>;
};

export type AlbumBulkEditFields = Pick<
  EditableMetadata,
  'artist' | 'album' | 'producer' | 'composer' | 'genre' | 'year' | 'coverArt'
>;

type AlbumEditDialogState = {
  folderPath: string;
  folderName: string;
  trackCount: number;
  draft: AlbumBulkEditFields;
};

type AlbumCoverSourceOption = {
  coverArt: string;
  sourceLabel: string;
};

type AlbumContextMenuState = {
  x: number;
  y: number;
};

type TrackContextMenuState = {
  x: number;
  y: number;
  item: AudioLibraryItem;
  showMoveTargets: boolean;
  showCreateAlbumInput: boolean;
  newAlbumName: string;
};

type AlbumEditTextFieldKey = 'artist' | 'album' | 'producer' | 'composer' | 'genre' | 'year';

type AlbumEditSuggestionInputProps = {
  id: string;
  label: string;
  value: string;
  suggestions: string[];
  onChange: (nextValue: string) => void;
};

type LibrarySortMethod = 'folder-asc' | 'folder-desc' | 'title-asc' | 'artist-asc' | 'duration-desc' | 'format-asc';

const SORT_OPTIONS: Array<{ value: LibrarySortMethod; label: string }> = [
  { value: 'folder-asc', label: 'Album folder A-Z' },
  { value: 'folder-desc', label: 'Album folder Z-A' },
  { value: 'title-asc', label: 'Track title A-Z' },
  { value: 'artist-asc', label: 'Artist A-Z' },
  { value: 'duration-desc', label: 'Duration longest first' },
  { value: 'format-asc', label: 'Format A-Z' },
];

function folderNameFromPath(directoryPath: string) {
  const normalized = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || directoryPath;
}

function normalizeAlbumValue(rawValue: string) {
  const value = rawValue.trim();
  return value || '(empty)';
}

function mostFrequentMetadataValue(items: AudioLibraryItem[], selector: (item: AudioLibraryItem) => string) {
  const counts = new Map<string, number>();
  let mostCommon = '';
  let highestCount = 0;

  items.forEach((item) => {
    const value = selector(item).trim();
    const nextCount = (counts.get(value) ?? 0) + 1;
    counts.set(value, nextCount);

    if (nextCount > highestCount || (nextCount === highestCount && value.localeCompare(mostCommon) < 0)) {
      highestCount = nextCount;
      mostCommon = value;
    }
  });

  return mostCommon;
}

function uniqueSortedValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function pickAlbumCover(items: AudioLibraryItem[]) {
  return items.map((item) => item.metadata.coverArt).find((cover): cover is string => Boolean(cover)) || null;
}

function AlbumEditSuggestionInput({ id, label, value, suggestions, onChange }: AlbumEditSuggestionInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSuggestions = (
    normalizedQuery ? suggestions.filter((item) => item.toLowerCase().includes(normalizedQuery)) : suggestions
  ).slice(0, 16);

  return (
    <label className="suggestion-field">
      {label}
      <div className="suggestion-input-wrap">
        <input
          autoComplete="off"
          value={value}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 120);
            window.setTimeout(() => setQuery(''), 120);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue);
            setQuery(nextValue);
            setIsOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setIsOpen(true);
          }}
        />
        <span aria-hidden="true" className="suggestion-chevron">
          ▾
        </span>
      </div>
      {isOpen && filteredSuggestions.length > 0 ? (
        <div className="suggestion-menu" role="listbox">
          {filteredSuggestions.map((option) => (
            <button
              key={`${id}-${option}`}
              className="suggestion-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  );
}

export function LibraryPane({
  items,
  currentPath,
  onSelect,
  onApplyAlbumFields,
  onMoveTrackToAlbum,
}: LibraryPaneProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [sortMethod, setSortMethod] = useState<LibrarySortMethod>('folder-asc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedAlbums, setCollapsedAlbums] = useState<Record<string, boolean>>({});
  const [editingAlbum, setEditingAlbum] = useState<AlbumEditDialogState | null>(null);
  const [isApplyingAlbumEdit, setIsApplyingAlbumEdit] = useState(false);
  const [isAlbumModalCoverPickerOpen, setIsAlbumModalCoverPickerOpen] = useState(false);
  const [albumContextMenu, setAlbumContextMenu] = useState<AlbumContextMenuState | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);
  const [isMovingTrack, setIsMovingTrack] = useState(false);

  const activeSortLabel = useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sortMethod)?.label || 'Sort',
    [sortMethod],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) => {
      const searchable = [
        item.metadata.title,
        item.metadata.artist,
        item.metadata.album,
        item.name,
        item.extension,
        folderNameFromPath(item.directory),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [items, searchQuery]);

  const groupedItems = useMemo(() => {
    const groups = new Map<
      string,
      {
        groupKey: string;
        folderPath: string;
        folderName: string;
        items: AudioLibraryItem[];
        albumNames: Set<string>;
        albumValueCounts: Map<string, number>;
        isRootPseudoAlbum: boolean;
      }
    >();

    filteredItems.forEach((item) => {
      const isRootPseudoAlbum = Boolean(item.openedDirectoryRoot && item.isInOpenedDirectoryRoot);
      const groupKey = isRootPseudoAlbum ? `root::${item.openedDirectoryRoot}` : item.directory;
      const group = groups.get(groupKey) ?? {
        groupKey,
        folderPath: item.directory,
        folderName: isRootPseudoAlbum ? 'Root' : folderNameFromPath(item.directory),
        items: [],
        albumNames: new Set<string>(),
        albumValueCounts: new Map<string, number>(),
        isRootPseudoAlbum,
      };

      const albumName = normalizeAlbumValue(item.metadata.album);
      group.albumNames.add(albumName);
      group.albumValueCounts.set(albumName, (group.albumValueCounts.get(albumName) ?? 0) + 1);
      group.items.push(item);
      groups.set(groupKey, group);
    });

    const trackComparator = (left: AudioLibraryItem, right: AudioLibraryItem) => {
      if (sortMethod === 'title-asc') {
        return (left.metadata.title || left.name).localeCompare(right.metadata.title || right.name);
      }

      if (sortMethod === 'artist-asc') {
        return (left.metadata.artist || '').localeCompare(right.metadata.artist || '');
      }

      if (sortMethod === 'duration-desc') {
        return right.metadata.duration - left.metadata.duration;
      }

      if (sortMethod === 'format-asc') {
        return left.extension.localeCompare(right.extension);
      }

      return (left.metadata.title || left.name).localeCompare(right.metadata.title || right.name);
    };

    const groupComparator = (left: { folderName: string }, right: { folderName: string }) => {
      if (sortMethod === 'folder-desc') {
        return right.folderName.localeCompare(left.folderName);
      }

      return left.folderName.localeCompare(right.folderName);
    };

    return Array.from(groups.values())
      .map((group) => {
        const albumNameEntries = Array.from(group.albumValueCounts.entries()).sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }

          return left[0].localeCompare(right[0]);
        });
        const canonicalAlbumName = albumNameEntries[0]?.[0] ?? '(empty)';
        const mismatchedTrackPaths = new Set(
          group.items
            .filter((item) => normalizeAlbumValue(item.metadata.album) !== canonicalAlbumName)
            .map((item) => item.path),
        );

        return {
          ...group,
          hasAlbumNameDiscrepancy: group.isRootPseudoAlbum ? false : group.albumNames.size > 1,
          mismatchCount: group.isRootPseudoAlbum ? 0 : mismatchedTrackPaths.size,
          mismatchedTrackPaths: group.isRootPseudoAlbum ? new Set<string>() : mismatchedTrackPaths,
          uniqueCovers: Array.from(new Set(group.items.map((item) => item.metadata.coverArt).filter(Boolean))).slice(
            0,
            4,
          ),
          items: group.items.sort(trackComparator),
        };
      })
      .sort(groupComparator);
  }, [filteredItems, sortMethod]);

  const albumEditSuggestions = useMemo<Record<AlbumEditTextFieldKey, string[]>>(
    () => ({
      artist: uniqueSortedValues(items.map((item) => item.metadata.artist)),
      album: uniqueSortedValues(items.map((item) => item.metadata.album)),
      producer: uniqueSortedValues(items.map((item) => item.metadata.producer)),
      composer: uniqueSortedValues(items.map((item) => item.metadata.composer)),
      genre: uniqueSortedValues(items.map((item) => item.metadata.genre)),
      year: uniqueSortedValues(items.map((item) => item.metadata.year)),
    }),
    [items],
  );

  const albumModalCoverSourceOptions = useMemo<AlbumCoverSourceOption[]>(() => {
    if (!editingAlbum) {
      return [];
    }

    const sortedCandidates = items
      .filter((item) => item.directory !== editingAlbum.folderPath)
      .filter((item) => Boolean(item.metadata.coverArt))
      .map((item) => ({
        coverArt: item.metadata.coverArt as string,
        sourceLabel: item.metadata.album || item.metadata.title || item.name,
      }))
      .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel));

    const uniqueByCover = new Map<string, AlbumCoverSourceOption>();
    sortedCandidates.forEach((candidate) => {
      if (!uniqueByCover.has(candidate.coverArt)) {
        uniqueByCover.set(candidate.coverArt, candidate);
      }
    });

    return Array.from(uniqueByCover.values());
  }, [editingAlbum, items]);

  function toggleAlbumCollapsed(folderPath: string) {
    setCollapsedAlbums((current) => ({
      ...current,
      [folderPath]: !current[folderPath],
    }));
  }

  function openAlbumEditor(folderPath: string, folderName: string, albumItems: AudioLibraryItem[]) {
    setIsAlbumModalCoverPickerOpen(false);
    setEditingAlbum({
      folderPath,
      folderName,
      trackCount: albumItems.length,
      draft: {
        artist: mostFrequentMetadataValue(albumItems, (item) => item.metadata.artist),
        album: mostFrequentMetadataValue(albumItems, (item) => item.metadata.album),
        producer: mostFrequentMetadataValue(albumItems, (item) => item.metadata.producer),
        composer: mostFrequentMetadataValue(albumItems, (item) => item.metadata.composer),
        genre: mostFrequentMetadataValue(albumItems, (item) => item.metadata.genre),
        year: mostFrequentMetadataValue(albumItems, (item) => item.metadata.year),
        coverArt: pickAlbumCover(albumItems),
      },
    });
  }

  function onUseCoverFromOtherAlbumOrTrack() {
    if (!editingAlbum || albumModalCoverSourceOptions.length === 0) {
      return;
    }

    const firstCoverOption = albumModalCoverSourceOptions[0];

    if (albumModalCoverSourceOptions.length === 1) {
      if (!firstCoverOption) {
        return;
      }

      setEditingAlbum((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                coverArt: firstCoverOption.coverArt,
              },
            }
          : current,
      );
      setIsAlbumModalCoverPickerOpen(false);
      return;
    }

    setIsAlbumModalCoverPickerOpen((current) => !current);
  }

  async function onAlbumCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setEditingAlbum((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                coverArt: typeof reader.result === 'string' ? reader.result : current.draft.coverArt,
              },
            }
          : current,
      );
    };
    reader.readAsDataURL(file);
  }

  function collapseAllAlbums() {
    const nextState: Record<string, boolean> = {};
    groupedItems.forEach((group) => {
      nextState[group.groupKey] = true;
    });
    setCollapsedAlbums(nextState);
  }

  function expandAllAlbums() {
    const nextState: Record<string, boolean> = {};
    groupedItems.forEach((group) => {
      nextState[group.groupKey] = false;
    });
    setCollapsedAlbums(nextState);
  }

  function openAlbumContextMenu(event: ReactMouseEvent) {
    event.preventDefault();

    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) {
      return;
    }

    // Keep the menu pinned to the cursor and inside the viewport.
    const menuWidth = 170;
    const menuHeight = 96;
    const viewportPadding = 8;
    const localX = event.clientX - panelRect.left;
    const localY = event.clientY - panelRect.top;
    const x = Math.min(Math.max(viewportPadding, localX), panelRect.width - menuWidth - viewportPadding);
    const y = Math.min(Math.max(viewportPadding, localY), panelRect.height - menuHeight - viewportPadding);

    setTrackContextMenu(null);
    setAlbumContextMenu({ x, y });
  }

  function openTrackContextMenu(event: ReactMouseEvent, item: AudioLibraryItem) {
    event.preventDefault();
    event.stopPropagation();

    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) {
      return;
    }

    const menuWidth = 220;
    const menuHeight = 118;
    const viewportPadding = 8;
    const localX = event.clientX - panelRect.left;
    const localY = event.clientY - panelRect.top;
    const x = Math.min(Math.max(viewportPadding, localX), panelRect.width - menuWidth - viewportPadding);
    const y = Math.min(Math.max(viewportPadding, localY), panelRect.height - menuHeight - viewportPadding);

    setAlbumContextMenu(null);
    setTrackContextMenu({
      x,
      y,
      item,
      showMoveTargets: false,
      showCreateAlbumInput: false,
      newAlbumName: item.metadata.album?.trim() || 'New Album',
    });
  }

  async function moveTrackToDirectory(targetDirectory: string) {
    if (!trackContextMenu || isMovingTrack) {
      return;
    }

    setIsMovingTrack(true);

    try {
      await onMoveTrackToAlbum(trackContextMenu.item, targetDirectory);
      setTrackContextMenu(null);
    } finally {
      setIsMovingTrack(false);
    }
  }

  async function moveTrackToPickedDirectory() {
    if (!trackContextMenu || isMovingTrack) {
      return;
    }

    const pickedPaths = await requireAudioMetaApi().openDirectory();
    const destination = pickedPaths[0];

    if (!destination) {
      return;
    }

    await moveTrackToDirectory(destination);
  }

  async function moveTrackToNewAlbumInRoot() {
    if (!trackContextMenu || isMovingTrack) {
      return;
    }

    const rootDirectory = trackContextMenu.item.openedDirectoryRoot || trackContextMenu.item.directory;

    const albumName = trackContextMenu.newAlbumName.trim().replace(/[\\/]/g, '-').replace(/\s+/g, ' ');
    if (!albumName) {
      return;
    }

    const separator = rootDirectory.includes('\\') ? '\\' : '/';
    const normalizedRoot = rootDirectory.replace(/[\\/]+$/, '');
    const targetDirectory = `${normalizedRoot}${separator}${albumName}`;
    await moveTrackToDirectory(targetDirectory);
  }

  async function saveAlbumEditorChanges() {
    if (!editingAlbum) {
      return;
    }

    setIsApplyingAlbumEdit(true);

    try {
      await onApplyAlbumFields(editingAlbum.folderPath, editingAlbum.draft);
      setEditingAlbum(null);
    } finally {
      setIsApplyingAlbumEdit(false);
    }
  }

  return (
    <aside className="panel library-panel" ref={panelRef}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Current queue</h2>
        </div>
        <span className="pill">{items.length} files</span>
      </div>

      <div className="library-toolbar">
        <label className="library-sort-label">
          Sort by
          <div
            className="library-sort-dropdown"
            onBlur={() => window.setTimeout(() => setIsSortMenuOpen(false), 100)}
            tabIndex={0}
          >
            <button className="library-sort-trigger" onClick={() => setIsSortMenuOpen((open) => !open)} type="button">
              <span>{activeSortLabel}</span>
              <span aria-hidden="true" className={`library-sort-chevron${isSortMenuOpen ? ' open' : ''}`}>
                ▾
              </span>
            </button>

            {isSortMenuOpen ? (
              <div className="library-sort-menu" role="listbox">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`library-sort-option${option.value === sortMethod ? ' active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSortMethod(option.value);
                      setIsSortMenuOpen(false);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </label>

        <label className="library-search-label">
          Search
          <input
            className="library-search-input"
            placeholder="Find title, artist, album, format..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="library-list" role="list">
        {groupedItems.map((group) => (
          <section className="library-album-group" key={group.groupKey}>
            <div
              className="library-album-header"
              onClick={() => toggleAlbumCollapsed(group.groupKey)}
              onContextMenu={openAlbumContextMenu}
            >
              <div className="library-album-header-left">
                {group.uniqueCovers.length > 0 ? (
                  <div className="library-album-covers" aria-hidden="true">
                    {group.uniqueCovers.map((cover, index) => (
                      <img
                        key={`${group.folderPath}-cover-${index}`}
                        className="library-album-cover"
                        src={cover ?? undefined}
                        alt=""
                      />
                    ))}
                  </div>
                ) : (
                  <div className="library-album-covers placeholder" aria-hidden="true" />
                )}
                <button
                  className="library-album-name-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openAlbumEditor(group.folderPath, group.folderName, group.items);
                  }}
                  title="Edit album metadata for all tracks in this folder"
                  type="button"
                >
                  <strong>{group.folderName}</strong>
                </button>
              </div>
              <span className="library-album-meta">
                {group.items.length} tracks
                <button
                  className="library-album-collapse-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleAlbumCollapsed(group.groupKey);
                  }}
                  title={collapsedAlbums[group.groupKey] ? 'Expand album tracks' : 'Collapse album tracks'}
                  type="button"
                >
                  <span
                    className={`library-album-chevron${collapsedAlbums[group.groupKey] ? '' : ' open'}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
              </span>
            </div>
            {group.hasAlbumNameDiscrepancy ? (
              <p className="library-album-warning">
                Album metadata mismatch on {group.mismatchCount} track{group.mismatchCount === 1 ? '' : 's'} in this
                folder.
              </p>
            ) : null}

            {!collapsedAlbums[group.groupKey]
              ? group.items.map((item) => {
                  const isActive = item.path === currentPath;
                  const hasMismatch = group.mismatchedTrackPaths.has(item.path);
                  return (
                    <button
                      key={item.path}
                      className={`library-item${isActive ? ' active' : ''}`}
                      onContextMenu={(event) => openTrackContextMenu(event, item)}
                      onClick={() => onSelect(item)}
                      type="button"
                    >
                      <div>
                        <strong>{item.metadata.title || item.name}</strong>
                        <p>{item.metadata.artist || 'Unknown artist'}</p>
                      </div>
                      <div className="library-meta">
                        <span>{item.extension.toUpperCase()}</span>
                        <span>{formatDuration(item.metadata.duration)}</span>
                        {hasMismatch ? (
                          <span
                            className="library-warning-icon"
                            title="Track album tag differs from the rest of this folder"
                          >
                            ⚠
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              : null}
          </section>
        ))}

        {groupedItems.length === 0 ? (
          <p className="empty-state">
            {items.length > 0 ? 'No tracks match your search.' : 'Open audio files or a folder to build your library.'}
          </p>
        ) : null}
      </div>

      {albumContextMenu ? (
        <div
          className="library-context-menu-backdrop"
          onClick={() => setAlbumContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setAlbumContextMenu(null);
          }}
          role="presentation"
        >
          <div
            className="library-context-menu"
            onClick={(event) => event.stopPropagation()}
            style={{ left: albumContextMenu.x, top: albumContextMenu.y }}
          >
            <button
              className="library-context-menu-option"
              onClick={() => {
                collapseAllAlbums();
                setAlbumContextMenu(null);
              }}
              type="button"
            >
              Collapse all
            </button>
            <button
              className="library-context-menu-option"
              onClick={() => {
                expandAllAlbums();
                setAlbumContextMenu(null);
              }}
              type="button"
            >
              Expand all
            </button>
          </div>
        </div>
      ) : null}

      {trackContextMenu ? (
        <div
          className="library-context-menu-backdrop"
          onClick={() => setTrackContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setTrackContextMenu(null);
          }}
          role="presentation"
        >
          <div
            className="library-context-menu track-context-menu"
            onClick={(event) => event.stopPropagation()}
            style={{ left: trackContextMenu.x, top: trackContextMenu.y }}
          >
            <button
              className="library-context-menu-option"
              disabled={isMovingTrack}
              onClick={() =>
                setTrackContextMenu((current) =>
                  current
                    ? {
                        ...current,
                        showMoveTargets: !current.showMoveTargets,
                        showCreateAlbumInput: current.showMoveTargets ? false : current.showCreateAlbumInput,
                      }
                    : current,
                )
              }
              type="button"
            >
              Move to album...
            </button>

            {trackContextMenu.showMoveTargets ? (
              <div className="track-context-submenu">
                {groupedItems.map((group) => {
                  const isCurrentFolder = group.folderPath === trackContextMenu.item.directory;
                  return (
                    <button
                      key={`move-target-${group.folderPath}`}
                      className="library-context-menu-option track-context-target"
                      disabled={isCurrentFolder || isMovingTrack}
                      onClick={() => void moveTrackToDirectory(group.folderPath)}
                      type="button"
                    >
                      {group.folderName}
                      {isCurrentFolder ? ' (current)' : ''}
                    </button>
                  );
                })}

                <button
                  className="library-context-menu-option track-context-target"
                  disabled={isMovingTrack}
                  onClick={() => void moveTrackToPickedDirectory()}
                  type="button"
                >
                  Pick a different path...
                </button>

                <button
                  className="library-context-menu-option track-context-target"
                  disabled={isMovingTrack}
                  onClick={() =>
                    setTrackContextMenu((current) =>
                      current ? { ...current, showCreateAlbumInput: !current.showCreateAlbumInput } : current,
                    )
                  }
                  type="button"
                >
                  Create new album...
                </button>

                {trackContextMenu.showCreateAlbumInput ? (
                  <div className="track-context-create-form">
                    <input
                      className="track-context-create-input"
                      onChange={(event) =>
                        setTrackContextMenu((current) =>
                          current ? { ...current, newAlbumName: event.target.value } : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void moveTrackToNewAlbumInRoot();
                        }
                      }}
                      placeholder="New album name"
                      value={trackContextMenu.newAlbumName}
                    />
                    <button
                      className="library-context-menu-option track-context-create-action"
                      disabled={isMovingTrack || !trackContextMenu.newAlbumName.trim()}
                      onClick={() => void moveTrackToNewAlbumInRoot()}
                      type="button"
                    >
                      Create and move
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editingAlbum ? (
        <div
          className="album-edit-backdrop"
          role="presentation"
          onClick={() => !isApplyingAlbumEdit && setEditingAlbum(null)}
        >
          <section
            aria-label={`Edit album metadata for ${editingAlbum.folderName}`}
            className="album-edit-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="album-edit-dialog-heading">
              <p className="eyebrow">Album metadata</p>
              <h3>{editingAlbum.folderName}</h3>
              <p className="album-edit-track-count">
                Apply to {editingAlbum.trackCount} track{editingAlbum.trackCount === 1 ? '' : 's'}
              </p>
            </div>

            <div className="album-edit-cover-card">
              <img
                alt="Album cover"
                className="album-edit-cover-image"
                onError={(event) => {
                  event.currentTarget.src = defaultCover;
                }}
                src={editingAlbum.draft.coverArt || defaultCover}
              />
              <div className="album-edit-cover-actions">
                <label className="secondary-button">
                  Replace album cover
                  <input accept="image/*" hidden onChange={onAlbumCoverChange} type="file" />
                </label>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setEditingAlbum((current) =>
                      current
                        ? {
                            ...current,
                            draft: {
                              ...current.draft,
                              coverArt: null,
                            },
                          }
                        : current,
                    )
                  }
                  type="button"
                >
                  Remove album cover
                </button>
                <button
                  className="secondary-button"
                  disabled={albumModalCoverSourceOptions.length === 0}
                  onClick={onUseCoverFromOtherAlbumOrTrack}
                  type="button"
                >
                  Use cover from other album or track
                </button>
              </div>

              {isAlbumModalCoverPickerOpen && albumModalCoverSourceOptions.length > 1 ? (
                <div className="track-cover-picker" role="listbox">
                  {albumModalCoverSourceOptions.map((option) => (
                    <button
                      key={`album-modal-cover-source-${option.coverArt}`}
                      className="track-cover-option"
                      onClick={() => {
                        setEditingAlbum((current) =>
                          current
                            ? {
                                ...current,
                                draft: {
                                  ...current.draft,
                                  coverArt: option.coverArt,
                                },
                              }
                            : current,
                        );
                        setIsAlbumModalCoverPickerOpen(false);
                      }}
                      type="button"
                    >
                      <img src={option.coverArt} alt={`Cover source ${option.sourceLabel}`} />
                      <span className="track-cover-option-meta">
                        <strong>{option.sourceLabel}</strong>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="album-edit-grid">
              <AlbumEditSuggestionInput
                id="album-edit-artist"
                label="Artist"
                value={editingAlbum.draft.artist}
                suggestions={albumEditSuggestions.artist}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            artist: value,
                          },
                        }
                      : current,
                  )
                }
              />
              <AlbumEditSuggestionInput
                id="album-edit-album"
                label="Album"
                value={editingAlbum.draft.album}
                suggestions={albumEditSuggestions.album}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            album: value,
                          },
                        }
                      : current,
                  )
                }
              />
              <AlbumEditSuggestionInput
                id="album-edit-producer"
                label="Producer"
                value={editingAlbum.draft.producer}
                suggestions={albumEditSuggestions.producer}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            producer: value,
                          },
                        }
                      : current,
                  )
                }
              />
              <AlbumEditSuggestionInput
                id="album-edit-composer"
                label="Composer"
                value={editingAlbum.draft.composer}
                suggestions={albumEditSuggestions.composer}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            composer: value,
                          },
                        }
                      : current,
                  )
                }
              />
              <AlbumEditSuggestionInput
                id="album-edit-genre"
                label="Genre"
                value={editingAlbum.draft.genre}
                suggestions={albumEditSuggestions.genre}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            genre: value,
                          },
                        }
                      : current,
                  )
                }
              />
              <AlbumEditSuggestionInput
                id="album-edit-year"
                label="Year"
                value={editingAlbum.draft.year}
                suggestions={albumEditSuggestions.year}
                onChange={(value) =>
                  setEditingAlbum((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            year: value,
                          },
                        }
                      : current,
                  )
                }
              />
            </div>

            <div className="album-edit-actions">
              <button
                className="secondary-button"
                disabled={isApplyingAlbumEdit}
                onClick={() => setEditingAlbum(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isApplyingAlbumEdit}
                onClick={() => void saveAlbumEditorChanges()}
                type="button"
              >
                {isApplyingAlbumEdit ? 'Applying...' : 'Apply to album'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
