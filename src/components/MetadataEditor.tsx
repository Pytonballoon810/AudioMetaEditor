import { HugeiconsIcon } from '@hugeicons/react';
import { MagicWand01Icon } from '@hugeicons/core-free-icons';
import { type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { AudioLibraryItem, EditableMetadata, MetadataSuggestions } from '../types';
import defaultCover from '../assets/defaultCover.png';

const MAGIC_WAND_TOLERANCE = 42;

type TrackCoverOption = {
  coverArt: string;
  albumName: string;
};

type AlbumMismatchFields = {
  artist: boolean;
  album: boolean;
  producer: boolean;
  composer: boolean;
  genre: boolean;
  year: boolean;
};

type SuggestionInputProps = {
  id: string;
  label: ReactNode;
  value: string;
  suggestions: string[];
  onChange: (nextValue: string) => void;
};

type MetadataEditorProps = {
  item: AudioLibraryItem | null;
  onSave: (metadata: EditableMetadata) => Promise<void>;
  onSaveAlbum: (metadata: EditableMetadata) => Promise<void>;
  isSaving: boolean;
  isSavingAlbum: boolean;
  albumTrackCount: number;
  albumCoverOptions: string[];
  otherTrackCoverOptions: TrackCoverOption[];
  albumMismatchFields: AlbumMismatchFields;
  suggestions: MetadataSuggestions;
};

const EMPTY_METADATA: EditableMetadata = {
  title: '',
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
};

function SuggestionInput({ id, label, value, suggestions, onChange }: SuggestionInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = value.trim().toLowerCase();
  const filteredSuggestions = (
    normalizedQuery ? suggestions.filter((item) => item.toLowerCase().includes(normalizedQuery)) : suggestions
  ).slice(0, 8);

  return (
    <label className="suggestion-field">
      {label}
      <div className="suggestion-input-wrap">
        <input
          autoComplete="off"
          value={value}
          onBlur={() => {
            // Delay close so option click can commit first.
            window.setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
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

export function MetadataEditor({
  item,
  onSave,
  onSaveAlbum,
  isSaving,
  isSavingAlbum,
  albumTrackCount,
  albumCoverOptions,
  otherTrackCoverOptions,
  albumMismatchFields,
  suggestions,
}: MetadataEditorProps) {
  const [draft, setDraft] = useState<EditableMetadata>(EMPTY_METADATA);
  const [isAlbumCoverPickerOpen, setIsAlbumCoverPickerOpen] = useState(false);
  const [isTrackCoverPickerOpen, setIsTrackCoverPickerOpen] = useState(false);
  const [isWandActive, setIsWandActive] = useState(false);
  const coverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isWandDraggingRef = useRef(false);
  const hasWandEditsRef = useRef(false);

  useEffect(() => {
    if (!item) {
      setDraft(EMPTY_METADATA);
      setIsWandActive(false);
      return;
    }

    setDraft({
      title: item.metadata.title,
      album: item.metadata.album,
      artist: item.metadata.artist,
      albumArtist: item.metadata.albumArtist,
      composer: item.metadata.composer,
      producer: item.metadata.producer,
      genre: item.metadata.genre,
      year: item.metadata.year,
      track: item.metadata.track,
      disc: item.metadata.disc,
      comment: item.metadata.comment,
      coverArt: item.metadata.coverArt,
    });
    setIsWandActive(false);
  }, [item]);

  useEffect(() => {
    const canvas = coverCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return;
    }

    let isCancelled = false;
    const image = new Image();
    image.onload = () => {
      if (isCancelled || !coverCanvasRef.current) {
        return;
      }

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      hasWandEditsRef.current = false;
    };

    image.onerror = () => {
      if (isCancelled || !coverCanvasRef.current) {
        return;
      }

      if ((draft.coverArt || '') !== defaultCover) {
        image.src = defaultCover;
      }
    };

    image.src = draft.coverArt || defaultCover;

    return () => {
      isCancelled = true;
    };
  }, [draft.coverArt]);

  async function onCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({
        ...current,
        coverArt: typeof reader.result === 'string' ? reader.result : current.coverArt,
      }));
    };
    reader.readAsDataURL(file);
  }

  function removeConnectedArea(clientX: number, clientY: number) {
    if (!isWandActive || !draft.coverArt) {
      return;
    }

    const canvas = coverCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(((clientX - rect.left) / rect.width) * canvas.width)));
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor(((clientY - rect.top) / rect.height) * canvas.height)),
    );

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const pixelOffset = (y * width + x) * 4;
    const sourceR = data[pixelOffset] ?? 0;
    const sourceG = data[pixelOffset + 1] ?? 0;
    const sourceB = data[pixelOffset + 2] ?? 0;
    const sourceA = data[pixelOffset + 3] ?? 0;

    if (sourceA === 0) {
      return;
    }

    const toleranceSquared = MAGIC_WAND_TOLERANCE * MAGIC_WAND_TOLERANCE;
    const alphaTolerance = 48;
    const visited = new Uint8Array(width * height);
    const stack = [y * width + x];

    while (stack.length > 0) {
      const index = stack.pop();
      if (typeof index !== 'number' || visited[index] === 1) {
        continue;
      }

      visited[index] = 1;
      const offset = index * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      const alpha = data[offset + 3] ?? 0;
      const deltaR = red - sourceR;
      const deltaG = green - sourceG;
      const deltaB = blue - sourceB;
      const deltaA = Math.abs(alpha - sourceA);
      const distanceSquared = deltaR * deltaR + deltaG * deltaG + deltaB * deltaB;

      if (distanceSquared > toleranceSquared || deltaA > alphaTolerance) {
        continue;
      }

      data[offset + 3] = 0;

      const px = index % width;
      const py = Math.floor(index / width);
      if (px > 0) stack.push(index - 1);
      if (px < width - 1) stack.push(index + 1);
      if (py > 0) stack.push(index - width);
      if (py < height - 1) stack.push(index + width);
    }

    context.putImageData(imageData, 0, 0);
    hasWandEditsRef.current = true;
  }

  function commitWandEditsToDraft() {
    if (!hasWandEditsRef.current) {
      return;
    }

    const canvas = coverCanvasRef.current;
    if (!canvas) {
      return;
    }

    const updatedCover = canvas.toDataURL('image/png');
    setDraft((current) => ({
      ...current,
      coverArt: updatedCover,
    }));
    hasWandEditsRef.current = false;
  }

  function handleCoverPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isWandActive || !draft.coverArt) {
      return;
    }

    isWandDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    removeConnectedArea(event.clientX, event.clientY);
  }

  function handleCoverPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isWandActive || !isWandDraggingRef.current || !draft.coverArt) {
      return;
    }

    removeConnectedArea(event.clientX, event.clientY);
  }

  function handleCoverPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isWandDraggingRef.current) {
      return;
    }

    isWandDraggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    commitWandEditsToDraft();
  }

  function onCarryOverAlbumCover() {
    if (albumCoverOptions.length === 0) {
      return;
    }

    const firstAlbumCover = albumCoverOptions[0];

    if (albumCoverOptions.length === 1) {
      if (!firstAlbumCover) {
        return;
      }

      setDraft((current) => ({
        ...current,
        coverArt: firstAlbumCover,
      }));
      setIsAlbumCoverPickerOpen(false);
      return;
    }

    setIsAlbumCoverPickerOpen((current) => !current);
  }

  function onCopyCoverFromOtherTrack() {
    if (otherTrackCoverOptions.length === 0) {
      return;
    }

    const firstTrackCover = otherTrackCoverOptions[0];

    if (otherTrackCoverOptions.length === 1) {
      if (!firstTrackCover) {
        return;
      }

      setDraft((current) => ({
        ...current,
        coverArt: firstTrackCover.coverArt,
      }));
      setIsTrackCoverPickerOpen(false);
      return;
    }

    setIsTrackCoverPickerOpen((current) => !current);
  }

  function renderFieldLabel(text: string, hasMismatch: boolean) {
    return (
      <span className="metadata-label-row">
        <span>{text}</span>
        {hasMismatch ? (
          <span
            className="metadata-mismatch-indicator"
            title="This value differs from other tracks in this album folder"
          >
            ⚠ mismatch
          </span>
        ) : null}
      </span>
    );
  }

  if (!item) {
    return (
      <section className="panel metadata-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Metadata</p>
            <h2>No track selected</h2>
          </div>
        </div>
        <p className="empty-state">Select an audio file to edit title, artwork, composer, producer, and other tags.</p>
      </section>
    );
  }

  return (
    <section className="panel metadata-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Metadata</p>
          <h2>{item.metadata.title || item.name}</h2>
        </div>
      </div>

      <form
        className="metadata-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft);
        }}
      >
        <div className="cover-card">
          <div className={`cover-image-editor${isWandActive ? ' wand-active' : ''}`}>
            <canvas
              aria-label="Album cover editor"
              className="cover-image-canvas"
              onPointerDown={handleCoverPointerDown}
              onPointerMove={handleCoverPointerMove}
              onPointerUp={handleCoverPointerUp}
              onPointerCancel={handleCoverPointerUp}
              ref={coverCanvasRef}
            />
          </div>
          <div className="cover-actions">
            <label className="secondary-button">
              Replace artwork
              <input accept="image/*" hidden onChange={onCoverChange} type="file" />
            </label>
            <button
              aria-label={isWandActive ? 'Disable magic wand background remover' : 'Enable magic wand background remover'}
              className={`secondary-button cover-wand-button${isWandActive ? ' active' : ''}`}
              disabled={!draft.coverArt}
              onClick={() => {
                if (isWandActive) {
                  commitWandEditsToDraft();
                }
                setIsWandActive((current) => !current);
              }}
              title={
                draft.coverArt
                  ? 'Magic wand: click and drag on similar colors to make them transparent'
                  : 'Load artwork first to use the magic wand'
              }
              type="button"
            >
              <HugeiconsIcon icon={MagicWand01Icon} size={18} strokeWidth={1.8} />
              <span>{isWandActive ? 'Wand on' : 'Magic wand'}</span>
            </button>
            <button
              className="secondary-button"
              disabled={albumCoverOptions.length === 0}
              onClick={onCarryOverAlbumCover}
              type="button"
            >
              Carry over cover from derived album cover
            </button>
            <button
              className="secondary-button"
              disabled={otherTrackCoverOptions.length === 0}
              onClick={onCopyCoverFromOtherTrack}
              type="button"
            >
              Copy cover from other track
            </button>
          </div>
          {draft.coverArt ? <p className="cover-editor-hint">Magic wand: click and drag to remove matching areas.</p> : null}

          {isAlbumCoverPickerOpen && albumCoverOptions.length > 1 ? (
            <div className="album-cover-picker" role="listbox">
              {albumCoverOptions.map((cover, index) => (
                <button
                  key={`album-cover-option-${index}`}
                  className="album-cover-option"
                  onClick={() => {
                    setDraft((current) => ({ ...current, coverArt: cover }));
                    setIsAlbumCoverPickerOpen(false);
                  }}
                  type="button"
                >
                  <img src={cover} alt={`Album cover option ${index + 1}`} />
                </button>
              ))}
            </div>
          ) : null}

          {isTrackCoverPickerOpen && otherTrackCoverOptions.length > 1 ? (
            <div className="track-cover-picker" role="listbox">
              {otherTrackCoverOptions.map((option) => (
                <button
                  key={`track-cover-option-${option.coverArt}`}
                  className="track-cover-option"
                  onClick={() => {
                    setDraft((current) => ({ ...current, coverArt: option.coverArt }));
                    setIsTrackCoverPickerOpen(false);
                  }}
                  type="button"
                >
                  <img src={option.coverArt} alt={`Cover from album ${option.albumName}`} />
                  <span className="track-cover-option-meta">
                    <strong>{option.albumName}</strong>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="metadata-grid">
          <label>
            Title
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <SuggestionInput
            id="artist"
            label={renderFieldLabel('Artist', albumMismatchFields.artist)}
            value={draft.artist}
            suggestions={suggestions.artists}
            onChange={(value) => setDraft({ ...draft, artist: value })}
          />
          <SuggestionInput
            id="album"
            label={renderFieldLabel('Album', albumMismatchFields.album)}
            value={draft.album}
            suggestions={suggestions.albums}
            onChange={(value) => setDraft({ ...draft, album: value })}
          />
          <SuggestionInput
            id="albumArtist"
            label="Album artist"
            value={draft.albumArtist}
            suggestions={suggestions.albumArtists}
            onChange={(value) => setDraft({ ...draft, albumArtist: value })}
          />
          <SuggestionInput
            id="composer"
            label={renderFieldLabel('Composer', albumMismatchFields.composer)}
            value={draft.composer}
            suggestions={suggestions.composers}
            onChange={(value) => setDraft({ ...draft, composer: value })}
          />
          <SuggestionInput
            id="producer"
            label={renderFieldLabel('Producer', albumMismatchFields.producer)}
            value={draft.producer}
            suggestions={suggestions.producers}
            onChange={(value) => setDraft({ ...draft, producer: value })}
          />
          <SuggestionInput
            id="genre"
            label={renderFieldLabel('Genre', albumMismatchFields.genre)}
            value={draft.genre}
            suggestions={suggestions.genres}
            onChange={(value) => setDraft({ ...draft, genre: value })}
          />
          <label>
            {renderFieldLabel('Year', albumMismatchFields.year)}
            <input value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} />
          </label>
          <label>
            Track
            <input value={draft.track} onChange={(event) => setDraft({ ...draft, track: event.target.value })} />
          </label>
          <label>
            Disc
            <input value={draft.disc} onChange={(event) => setDraft({ ...draft, disc: event.target.value })} />
          </label>
          <label className="full-width">
            Comment
            <textarea
              rows={4}
              value={draft.comment}
              onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
            />
          </label>
        </div>

        <div className="metadata-actions">
          <button className="primary-button" disabled={isSaving || isSavingAlbum} type="submit">
            {isSaving ? 'Saving track...' : 'Save track metadata'}
          </button>
          <button
            className="secondary-button"
            disabled={albumTrackCount < 2 || isSaving || isSavingAlbum}
            onClick={() => void onSaveAlbum(draft)}
            title="Apply album-level fields only: album, album artist, composer, producer, genre, year, and cover art"
            type="button"
          >
            {isSavingAlbum ? 'Saving album...' : `Apply to album (${albumTrackCount} tracks)`}
          </button>
        </div>
      </form>
    </section>
  );
}
