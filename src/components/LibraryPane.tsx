import { HugeiconsIcon } from '@hugeicons/react';
import { Album01Icon, Copy01Icon, Folder01Icon, RedoIcon, UndoIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { AudioLibraryItem, EditableMetadata } from '../types';
import { formatDuration } from '../lib/format';
import { preloadAudioBlob, requireAudioMetaApi } from '../services/audioMetaApi';
import defaultCover from '../assets/defaultCover.png';

type LibraryPaneProps = {
  items: AudioLibraryItem[];
  currentPath: string | null;
  isLoading: boolean;
  onSelect: (item: AudioLibraryItem) => void;
  onApplyAlbumFields: (folderPath: string, metadata: AlbumBulkEditFields) => Promise<void>;
  onMoveTrackToAlbum: (item: AudioLibraryItem, targetDirectory: string) => Promise<void>;
  onOpenFileLocation: (item: AudioLibraryItem) => Promise<void>;
  onReloadLibrary: () => Promise<void>;
};

export type AlbumBulkEditableValues = Pick<
  EditableMetadata,
  'artist' | 'album' | 'producer' | 'composer' | 'genre' | 'year' | 'coverArt'
>;

export type AlbumBulkEditFields = Partial<AlbumBulkEditableValues>;

type AlbumEditFieldApplyState = {
  artist: boolean;
  album: boolean;
  producer: boolean;
  composer: boolean;
  genre: boolean;
  year: boolean;
  coverArt: boolean;
};

const DEFAULT_ALBUM_FIELD_APPLY_STATE: AlbumEditFieldApplyState = {
  artist: false,
  album: false,
  producer: false,
  composer: false,
  genre: false,
  year: false,
  coverArt: false,
};

type AlbumCoverHistoryState = {
  undo: Array<string | null>;
  redo: Array<string | null>;
};

const EMPTY_COVER_HISTORY_STATE: AlbumCoverHistoryState = {
  undo: [],
  redo: [],
};

type AlbumEditableFieldKey = keyof AlbumBulkEditableValues;

type AlbumEditableTextFieldKey = Exclude<AlbumEditableFieldKey, 'coverArt'>;

type AlbumEditSuggestionInputProps = {
  id: string;
  label: string;
  value: string;
  suggestions: string[];
  isApplied: boolean;
  onToggleApply: (nextApplied: boolean) => void;
  onChange: (nextValue: string) => void;
};

type AlbumEditDialogState = {
  folderPath: string;
  folderName: string;
  trackCount: number;
  draft: AlbumBulkEditableValues;
  apply: AlbumEditFieldApplyState;
  coverHistory: AlbumCoverHistoryState;
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
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  item: AudioLibraryItem;
  showMoveTargets: boolean;
  showCreateAlbumInput: boolean;
  newAlbumName: string;
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

function normalizePathForUiComparison(pathValue: string) {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isSameDirectoryPath(leftPath: string, rightPath: string) {
  return normalizePathForUiComparison(leftPath) === normalizePathForUiComparison(rightPath);
}

function clampMenuToPanel(
  panelRect: DOMRect,
  anchorX: number,
  anchorY: number,
  menuWidth: number,
  menuHeight: number,
) {
  const panelPadding = 8;
  const localX = anchorX - panelRect.left;
  const localY = anchorY - panelRect.top;
  const maxX = Math.max(panelPadding, panelRect.width - menuWidth - panelPadding);
  const maxY = Math.max(panelPadding, panelRect.height - menuHeight - panelPadding);

  return {
    x: Math.min(Math.max(panelPadding, localX), maxX),
    y: Math.min(Math.max(panelPadding, localY), maxY),
  };
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

function AlbumEditSuggestionInput({
  id,
  label,
  value,
  suggestions,
  isApplied,
  onToggleApply,
  onChange,
}: AlbumEditSuggestionInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const inputValue = isApplied ? value : '';
  const filteredSuggestions = (
    normalizedQuery ? suggestions.filter((item) => item.toLowerCase().includes(normalizedQuery)) : suggestions
  ).slice(0, 16);

  return (
    <label className="suggestion-field">
      <span className="album-edit-field-head">
        <span>{label}</span>
        <span className="album-edit-toggle-wrap">
          <input
            checked={isApplied}
            onChange={(event) => {
              onToggleApply(event.target.checked);
              if (!event.target.checked) {
                setIsOpen(false);
                setQuery('');
              }
            }}
            type="checkbox"
          />
          Apply
        </span>
      </span>
      <div className="suggestion-input-wrap">
        <input
          autoComplete="off"
          placeholder={isApplied ? '' : "Don't change"}
          value={inputValue}
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
      {isOpen ? (
        <div className="suggestion-menu" role="listbox">
          <button
            className={`suggestion-option${!isApplied ? ' active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onToggleApply(false);
              setIsOpen(false);
              setQuery('');
            }}
            type="button"
          >
            Don't change
          </button>
          {filteredSuggestions.map((option) => (
            <button
              key={`${id}-${option}`}
              className="suggestion-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onToggleApply(true);
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
  isLoading,
  onSelect,
  onApplyAlbumFields,
  onMoveTrackToAlbum,
  onOpenFileLocation,
  onReloadLibrary,
}: LibraryPaneProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const trackSubmenuRef = useRef<HTMLDivElement | null>(null);
  const albumMenuRef = useRef<HTMLDivElement | null>(null);
  const trackMenuRef = useRef<HTMLDivElement | null>(null);
  const albumCoverInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!editingAlbum) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isApplyingAlbumEdit) {
        return;
      }

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      setIsAlbumModalCoverPickerOpen(false);
      setEditingAlbum(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingAlbum, isApplyingAlbumEdit]);

  useEffect(() => {
    if (!albumContextMenu && !trackContextMenu) {
      return;
    }

    function handleGlobalPointerDown(event: PointerEvent) {
      const targetNode = event.target as Node | null;
      if (!targetNode) {
        return;
      }

      if (albumMenuRef.current?.contains(targetNode) || trackMenuRef.current?.contains(targetNode)) {
        return;
      }

      setAlbumContextMenu(null);
      setTrackContextMenu(null);
    }

    window.addEventListener('pointerdown', handleGlobalPointerDown);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown);
    };
  }, [albumContextMenu, trackContextMenu]);

  useLayoutEffect(() => {
    if (!trackContextMenu?.showCreateAlbumInput) {
      return;
    }

    trackSubmenuRef.current?.scrollTo({
      top: trackSubmenuRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [trackContextMenu?.showCreateAlbumInput]);

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
      const isRootPseudoAlbum = Boolean(
        item.openedDirectoryRoot &&
          (item.isInOpenedDirectoryRoot || isSameDirectoryPath(item.directory, item.openedDirectoryRoot)),
      );
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

  const albumEditSuggestions = useMemo<Record<AlbumEditableTextFieldKey, string[]>>(
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

  const hasAlbumFieldsSelected = useMemo(() => {
    if (!editingAlbum) {
      return false;
    }

    return Object.values(editingAlbum.apply).some(Boolean) || Boolean(editingAlbum.draft.coverArt);
  }, [editingAlbum]);

  function setAlbumFieldApplied(field: AlbumEditableFieldKey, isApplied: boolean) {
    setEditingAlbum((current) =>
      current
        ? {
            ...current,
            apply: {
              ...current.apply,
              [field]: isApplied,
            },
          }
        : current,
    );
  }

  function setAlbumTextField(field: AlbumEditableTextFieldKey, nextValue: string) {
    setEditingAlbum((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              [field]: nextValue,
            },
            apply: {
              ...current.apply,
              [field]: true,
            },
          }
        : current,
    );
  }

  function setAlbumCover(coverArt: string | null) {
    setEditingAlbum((current) => {
      if (!current || current.draft.coverArt === coverArt) {
        return current;
      }

      return {
        ...current,
        draft: {
          ...current.draft,
          coverArt,
        },
        apply: {
          ...current.apply,
          coverArt: true,
        },
        coverHistory: {
          undo: [...current.coverHistory.undo, current.draft.coverArt],
          redo: [],
        },
      };
    });
  }

  function undoAlbumCoverEdit() {
    setEditingAlbum((current) => {
      if (!current || current.coverHistory.undo.length === 0) {
        return current;
      }

      const previousCover = current.coverHistory.undo[current.coverHistory.undo.length - 1] ?? null;
      return {
        ...current,
        draft: {
          ...current.draft,
          coverArt: previousCover,
        },
        apply: {
          ...current.apply,
          coverArt: true,
        },
        coverHistory: {
          undo: current.coverHistory.undo.slice(0, -1),
          redo: [...current.coverHistory.redo, current.draft.coverArt],
        },
      };
    });
  }

  function redoAlbumCoverEdit() {
    setEditingAlbum((current) => {
      if (!current || current.coverHistory.redo.length === 0) {
        return current;
      }

      const nextCover = current.coverHistory.redo[current.coverHistory.redo.length - 1] ?? null;
      return {
        ...current,
        draft: {
          ...current.draft,
          coverArt: nextCover,
        },
        apply: {
          ...current.apply,
          coverArt: true,
        },
        coverHistory: {
          undo: [...current.coverHistory.undo, current.draft.coverArt],
          redo: current.coverHistory.redo.slice(0, -1),
        },
      };
    });
  }

  function toggleAlbumCollapsed(folderPath: string) {
    setCollapsedAlbums((current) => {
      const isCurrentlyCollapsed = current[folderPath] ?? true;
      const nextIsCollapsed = !isCurrentlyCollapsed;

      if (!nextIsCollapsed) {
        const targetGroup = groupedItems.find((group) => group.groupKey === folderPath);
        if (targetGroup) {
          const preloadTargets = targetGroup.items.slice(0, 6);
          preloadTargets.forEach((track) => {
            void preloadAudioBlob(track.path).catch(() => {
              // Best-effort warm cache only.
            });
          });
        }
      }

      return {
        ...current,
        [folderPath]: nextIsCollapsed,
      };
    });
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
      apply: {
        ...DEFAULT_ALBUM_FIELD_APPLY_STATE,
      },
      coverHistory: {
        ...EMPTY_COVER_HISTORY_STATE,
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

      setAlbumCover(firstCoverOption.coverArt);
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
      if (typeof reader.result === 'string') {
        setAlbumCover(reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
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

    groupedItems.forEach((group) => {
      group.items.slice(0, 3).forEach((track) => {
        void preloadAudioBlob(track.path).catch(() => {
          // Best-effort warm cache only.
        });
      });
    });
  }

  function openAlbumContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) {
      return;
    }

    const { x, y } = clampMenuToPanel(panelRect, event.clientX, event.clientY, 170, 96);

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

    const collapsedMenuHeight = 170;
    const { x, y } = clampMenuToPanel(panelRect, event.clientX, event.clientY, 240, collapsedMenuHeight);

    setAlbumContextMenu(null);
    setTrackContextMenu({
      anchorX: event.clientX,
      anchorY: event.clientY,
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
    setTrackContextMenu(null);
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
    setTrackContextMenu(null);
  }

  async function saveAlbumEditorChanges() {
    if (!editingAlbum) {
      return;
    }

    // Always update the album's cover, regardless of the toggle
    const albumPayload: AlbumBulkEditFields = {};
    if (editingAlbum.apply.artist) {
      albumPayload.artist = editingAlbum.draft.artist;
    }
    if (editingAlbum.apply.album) {
      albumPayload.album = editingAlbum.draft.album;
    }
    if (editingAlbum.apply.producer) {
      albumPayload.producer = editingAlbum.draft.producer;
    }
    if (editingAlbum.apply.composer) {
      albumPayload.composer = editingAlbum.draft.composer;
    }
    if (editingAlbum.apply.genre) {
      albumPayload.genre = editingAlbum.draft.genre;
    }
    if (editingAlbum.apply.year) {
      albumPayload.year = editingAlbum.draft.year;
    }
    // Always set coverArt for the album itself
    albumPayload.coverArt = editingAlbum.draft.coverArt;

    // If no fields are selected and no cover, do nothing
    if (Object.keys(albumPayload).length === 0 || !editingAlbum.draft.coverArt) {
      setEditingAlbum(null);
      return;
    }

    setIsApplyingAlbumEdit(true);

    try {
      // First, update the album's own cover (could be a separate API call if needed)
      await onApplyAlbumFields(editingAlbum.folderPath, albumPayload);

      // If the toggle is ON, also update all tracks' covers
      if (editingAlbum.apply.coverArt) {
        // Only update tracks' coverArt
        await onApplyAlbumFields(editingAlbum.folderPath, { coverArt: editingAlbum.draft.coverArt });
      }
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
        <div className="library-heading-actions">
          <span className="pill">{items.length} files</span>
          <button
            aria-label={isLoading ? 'Reindexing library…' : 'Reload and reindex loaded tracks'}
            className="library-reload-button"
            disabled={isLoading || items.length === 0}
            onClick={() => void onReloadLibrary()}
            title={isLoading ? 'Reindexing…' : 'Reload and reindex loaded tracks'}
            type="button"
          >
            {isLoading ? (
              <span aria-hidden="true" className="library-reload-spinner" />
            ) : (
              <HugeiconsIcon aria-hidden="true" icon={RedoIcon} size={16} strokeWidth={1.9} />
            )}
          </button>
        </div>
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
        {groupedItems.map((group) => {
          const isActiveGroup = Boolean(currentPath && group.items.some((track) => track.path === currentPath));
          const isGroupCollapsed = collapsedAlbums[group.groupKey] ?? true;

          return (
            <section className="library-album-group" key={group.groupKey}>
              <div
                className={`library-album-header${isActiveGroup ? ' active' : ''}`}
                onClick={() => toggleAlbumCollapsed(group.groupKey)}
                onContextMenu={openAlbumContextMenu}
              >
                <div className="library-album-header-left">
                  {group.isRootPseudoAlbum ? (
                    <div className="library-root-folder-icon" aria-hidden="true">
                      <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.9} />
                    </div>
                  ) : group.uniqueCovers.length > 0 ? (
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
                    title={isGroupCollapsed ? 'Expand album tracks' : 'Collapse album tracks'}
                    type="button"
                  >
                    <span
                      className={`library-album-chevron${isGroupCollapsed ? '' : ' open'}`}
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

              {!isGroupCollapsed
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
          );
        })}

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
            ref={albumMenuRef}
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
            ref={trackMenuRef}
            style={{ left: trackContextMenu.x, top: trackContextMenu.y }}
          >
            <button
              className="library-context-menu-option"
              disabled={isMovingTrack}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() =>
                setTrackContextMenu((current) =>
                  current
                    ? (() => {
                        const nextShowMoveTargets = !current.showMoveTargets;
                        const nextShowCreateAlbumInput = nextShowMoveTargets ? current.showCreateAlbumInput : false;
                        const estimatedHeight = nextShowMoveTargets
                          ? nextShowCreateAlbumInput
                            ? 560
                            : 470
                          : 170;
                        const panelRect = panelRef.current?.getBoundingClientRect();
                        const repositioned = panelRect
                          ? clampMenuToPanel(panelRect, current.anchorX, current.anchorY, 240, estimatedHeight)
                          : { x: current.x, y: current.y };

                        return {
                          ...current,
                          x: repositioned.x,
                          y: repositioned.y,
                          showMoveTargets: nextShowMoveTargets,
                          showCreateAlbumInput: nextShowCreateAlbumInput,
                        };
                      })()
                    : current,
                )
              }
              type="button"
            >
              Move to album...
            </button>

            {!trackContextMenu.showMoveTargets ? (
              <button
                className="library-context-menu-option"
                disabled={isMovingTrack}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => void onOpenFileLocation(trackContextMenu.item).finally(() => setTrackContextMenu(null))}
                type="button"
              >
                Open file location
              </button>
            ) : null}

            {trackContextMenu.showMoveTargets ? (
              <div className="track-context-submenu" ref={trackSubmenuRef}>
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

                <div className="track-context-submenu-actions">
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
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={() =>
                      setTrackContextMenu((current) =>
                        current
                          ? (() => {
                              const nextShowCreateAlbumInput = !current.showCreateAlbumInput;
                              const estimatedHeight = nextShowCreateAlbumInput ? 560 : 470;
                              const panelRect = panelRef.current?.getBoundingClientRect();
                              const repositioned = panelRect
                                ? clampMenuToPanel(panelRect, current.anchorX, current.anchorY, 240, estimatedHeight)
                                : { x: current.x, y: current.y };

                              return {
                                ...current,
                                x: repositioned.x,
                                y: repositioned.y,
                                showCreateAlbumInput: nextShowCreateAlbumInput,
                              };
                            })()
                          : current,
                      )
                    }
                    type="button"
                  >
                    Create new album...
                  </button>
                </div>

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
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
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
              <div className="album-edit-cover-image-wrap">
                <img
                  alt="Album cover"
                  className="album-edit-cover-image"
                  onError={(event) => {
                    event.currentTarget.src = defaultCover;
                  }}
                  src={editingAlbum.draft.coverArt || defaultCover}
                />
              </div>

              <div
                aria-label="Album artwork toolbar"
                className="cover-edit-toolbar album-edit-cover-toolbar"
                role="toolbar"
              >
                <div className="daw-toolbar-group">
                  <button
                    aria-label="Undo album cover edit"
                    className="daw-tool-button"
                    disabled={editingAlbum.coverHistory.undo.length === 0}
                    onClick={undoAlbumCoverEdit}
                    title={
                      editingAlbum.coverHistory.undo.length > 0 ? 'Undo last album cover edit' : 'No cover edit to undo'
                    }
                    type="button"
                  >
                    <HugeiconsIcon icon={UndoIcon} size={18} strokeWidth={1.8} />
                  </button>
                  <button
                    aria-label="Redo album cover edit"
                    className="daw-tool-button"
                    disabled={editingAlbum.coverHistory.redo.length === 0}
                    onClick={redoAlbumCoverEdit}
                    title={
                      editingAlbum.coverHistory.redo.length > 0
                        ? 'Redo last undone album cover edit'
                        : 'No cover edit to redo'
                    }
                    type="button"
                  >
                    <HugeiconsIcon icon={RedoIcon} size={18} strokeWidth={1.8} />
                  </button>
                </div>

                <span aria-hidden="true" className="daw-toolbar-divider" />

                <div className="daw-toolbar-group">
                  <button
                    aria-label="Upload replacement album artwork"
                    className="daw-tool-button"
                    onClick={() => albumCoverInputRef.current?.click()}
                    title="Upload replacement album artwork image"
                    type="button"
                  >
                    <HugeiconsIcon icon={Upload01Icon} size={18} strokeWidth={1.8} />
                  </button>
                  <input accept="image/*" hidden onChange={onAlbumCoverChange} ref={albumCoverInputRef} type="file" />
                </div>

                <span aria-hidden="true" className="daw-toolbar-divider" />

                <div className="daw-toolbar-group">
                  <button
                    aria-label="Remove album cover"
                    className="daw-tool-button"
                    onClick={() => setAlbumCover(null)}
                    title="Remove album cover"
                    type="button"
                  >
                    X
                  </button>
                </div>

                <span aria-hidden="true" className="daw-toolbar-divider" />

                <div className="daw-toolbar-group">
                  <button
                    aria-label="Use cover from other album or track"
                    className="daw-tool-button"
                    disabled={albumModalCoverSourceOptions.length === 0}
                    onClick={onUseCoverFromOtherAlbumOrTrack}
                    title="Use cover from other album or track"
                    type="button"
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={18} strokeWidth={1.8} />
                  </button>
                  <button
                    aria-label="Keep existing covers unchanged"
                    className={`daw-tool-button${editingAlbum.apply.coverArt ? '' : ' cover-tool-active'}`}
                    onClick={() => setAlbumFieldApplied('coverArt', !editingAlbum.apply.coverArt)}
                    title={
                      editingAlbum.apply.coverArt ? 'Apply edited album cover to tracks' : "Don't change track covers"
                    }
                    type="button"
                  >
                    <HugeiconsIcon icon={Album01Icon} size={18} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              <p className="cover-editor-hint">
                Cover apply mode:{' '}
                {editingAlbum.apply.coverArt ? 'Apply this artwork to album tracks.' : "Don't change track covers."}
              </p>

              {isAlbumModalCoverPickerOpen && albumModalCoverSourceOptions.length > 1 ? (
                <div className="track-cover-picker" role="listbox">
                  {albumModalCoverSourceOptions.map((option) => (
                    <button
                      key={`album-modal-cover-source-${option.coverArt}`}
                      className="track-cover-option"
                      onClick={() => {
                        setAlbumCover(option.coverArt);
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
                isApplied={editingAlbum.apply.artist}
                suggestions={albumEditSuggestions.artist}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('artist', nextApplied)}
                onChange={(value) => setAlbumTextField('artist', value)}
              />
              <AlbumEditSuggestionInput
                id="album-edit-album"
                label="Album"
                value={editingAlbum.draft.album}
                isApplied={editingAlbum.apply.album}
                suggestions={albumEditSuggestions.album}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('album', nextApplied)}
                onChange={(value) => setAlbumTextField('album', value)}
              />
              <AlbumEditSuggestionInput
                id="album-edit-producer"
                label="Producer"
                value={editingAlbum.draft.producer}
                isApplied={editingAlbum.apply.producer}
                suggestions={albumEditSuggestions.producer}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('producer', nextApplied)}
                onChange={(value) => setAlbumTextField('producer', value)}
              />
              <AlbumEditSuggestionInput
                id="album-edit-composer"
                label="Composer"
                value={editingAlbum.draft.composer}
                isApplied={editingAlbum.apply.composer}
                suggestions={albumEditSuggestions.composer}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('composer', nextApplied)}
                onChange={(value) => setAlbumTextField('composer', value)}
              />
              <AlbumEditSuggestionInput
                id="album-edit-genre"
                label="Genre"
                value={editingAlbum.draft.genre}
                isApplied={editingAlbum.apply.genre}
                suggestions={albumEditSuggestions.genre}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('genre', nextApplied)}
                onChange={(value) => setAlbumTextField('genre', value)}
              />
              <AlbumEditSuggestionInput
                id="album-edit-year"
                label="Year"
                value={editingAlbum.draft.year}
                isApplied={editingAlbum.apply.year}
                suggestions={albumEditSuggestions.year}
                onToggleApply={(nextApplied) => setAlbumFieldApplied('year', nextApplied)}
                onChange={(value) => setAlbumTextField('year', value)}
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
                disabled={isApplyingAlbumEdit || !hasAlbumFieldsSelected}
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
