import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  validateLibraryLoadPayload,
  validateMetadataSavePayload,
  validateExportClipPayload,
  validateEditSelectionPayload,
  validateConvertAudioPayload,
  validateLoadBlobPayload,
  validateDownloadFromUrlPayload,
  validateMoveTrackPayload,
  validateOpenFileLocationPayload,
  validateSaveCoverImagePayload,
} = require('../electron/ipc-validators');

describe('ipc validators', () => {
  it('accepts valid library load payload', () => {
    expect(() => validateLibraryLoadPayload(['a.mp3', 'b.wav'])).not.toThrow();
  });

  it('rejects invalid library load payload', () => {
    expect(() => validateLibraryLoadPayload([123])).toThrow(/pathsToScan/);
    expect(() => validateLibraryLoadPayload('not-an-array')).toThrow(/pathsToScan/);
  });

  it('accepts valid metadata save payload', () => {
    expect(() => validateMetadataSavePayload({ filePath: '/tmp/a.mp3', metadata: {} })).not.toThrow();
  });

  it('rejects invalid metadata save payload', () => {
    expect(() => validateMetadataSavePayload({ filePath: '', metadata: {} })).toThrow(/filePath/);
    expect(() => validateMetadataSavePayload({ filePath: '/tmp/a.mp3' })).toThrow(/metadata/);
    expect(() => validateMetadataSavePayload(null)).toThrow(/payload/);
  });

  it('validates export clip range', () => {
    expect(() => validateExportClipPayload({ filePath: '/tmp/a.mp3', startTime: 1, endTime: 3 })).not.toThrow();
    expect(() => validateExportClipPayload({ filePath: '/tmp/a.mp3', startTime: 2, endTime: 2 })).toThrow(/endTime/);
    expect(() => validateExportClipPayload({ filePath: '/tmp/a.mp3', startTime: Number.NaN, endTime: 2 })).toThrow(
      /startTime/,
    );
    expect(() =>
      validateExportClipPayload({ filePath: '/tmp/a.mp3', startTime: 1, endTime: Number.POSITIVE_INFINITY }),
    ).toThrow(/endTime/);
  });

  it('validates edit selection mode', () => {
    expect(() =>
      validateEditSelectionPayload({ filePath: '/tmp/a.mp3', startTime: 1, endTime: 3, mode: 'trim' }),
    ).not.toThrow();
    expect(() =>
      validateEditSelectionPayload({ filePath: '/tmp/a.mp3', startTime: 1, endTime: 3, mode: 'slice' }),
    ).toThrow(/mode/);
  });

  it('validates convert audio payload', () => {
    expect(() => validateConvertAudioPayload({ filePath: '/tmp/a.wav', targetFormat: 'mp3' })).not.toThrow();
    expect(() => validateConvertAudioPayload({ filePath: '/tmp/a.wav', targetFormat: 'flac' })).not.toThrow();
    expect(() => validateConvertAudioPayload({ filePath: '/tmp/a.wav', targetFormat: 'wav' })).toThrow(/targetFormat/);
    expect(() => validateConvertAudioPayload({ filePath: '', targetFormat: 'mp3' })).toThrow(/filePath/);
  });

  it('validates load blob payload', () => {
    expect(() => validateLoadBlobPayload('/tmp/a.mp3')).not.toThrow();
    expect(() => validateLoadBlobPayload('')).toThrow(/filePath/);
  });

  it('validates download payload', () => {
    expect(() => validateDownloadFromUrlPayload({ url: 'https://example.com/a.mp3' })).not.toThrow();
    expect(() => validateDownloadFromUrlPayload({ url: 'https://example.com/a.mp3', ytDlpPath: 'yt-dlp' })).not.toThrow();
    expect(() => validateDownloadFromUrlPayload({ url: '' })).toThrow(/payload.url/);
    expect(() => validateDownloadFromUrlPayload({ url: 'https://example.com/a.mp3', ytDlpPath: '' })).toThrow(
      /payload.ytDlpPath/,
    );
    expect(() => validateDownloadFromUrlPayload(null)).toThrow(/payload/);
  });

  it('validates move track payload', () => {
    expect(() => validateMoveTrackPayload({ filePath: '/tmp/a.mp3', targetDirectory: '/tmp/Album' })).not.toThrow();
    expect(() => validateMoveTrackPayload({ filePath: '/tmp/a.mp3' })).toThrow(/targetDirectory/);
    expect(() => validateMoveTrackPayload(undefined)).toThrow(/payload/);
  });

  it('validates open file location payload', () => {
    expect(() => validateOpenFileLocationPayload({ filePath: '/tmp/a.mp3' })).not.toThrow();
    expect(() => validateOpenFileLocationPayload({ filePath: '' })).toThrow(/filePath/);
    expect(() => validateOpenFileLocationPayload(null)).toThrow(/payload/);
  });

  it('validates save cover image payload', () => {
    expect(() => validateSaveCoverImagePayload({ dataUrl: 'data:image/png;base64,AA==' })).not.toThrow();
    expect(() =>
      validateSaveCoverImagePayload({ dataUrl: 'data:image/png;base64,AA==', suggestedName: 'cover' }),
    ).not.toThrow();
    expect(() => validateSaveCoverImagePayload({ dataUrl: '' })).toThrow(/dataUrl/);
    expect(() => validateSaveCoverImagePayload({ dataUrl: 'data:image/png;base64,AA==', suggestedName: 42 })).toThrow(
      /suggestedName/,
    );
  });
});
