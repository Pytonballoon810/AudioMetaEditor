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
  validateConfigureWebDownloadToolsPayload,
  validateScanVstPluginsPayload,
  validateApplyVstRackPayload,
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
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        downloadFormat: 'flac',
      }),
    ).not.toThrow();
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        splitIntoChapters: true,
        downloadFormat: 'mp3',
      }),
    ).not.toThrow();
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        newAlbumName: 'My Album',
        newAlbumParentDirectory: '/tmp',
      }),
    ).not.toThrow();
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        splitIntoChapters: true,
        useVideoNameAsAlbum: true,
        newAlbumParentDirectory: '/tmp',
      }),
    ).not.toThrow();
    expect(() => validateDownloadFromUrlPayload({ url: '' })).toThrow(/payload.url/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        splitIntoChapters: 'yes',
      }),
    ).toThrow(/splitIntoChapters/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        useVideoNameAsAlbum: 'yes',
      }),
    ).toThrow(/useVideoNameAsAlbum/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        downloadFormat: 'ogg',
      }),
    ).toThrow(/downloadFormat/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        useVideoNameAsAlbum: true,
        newAlbumParentDirectory: '/tmp',
      }),
    ).toThrow(/splitIntoChapters/);
    expect(() => validateDownloadFromUrlPayload({ url: 'https://example.com/a.mp3' })).toThrow(/destination target/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        targetAlbumDirectory: '/tmp/Album',
        newAlbumName: 'My Album',
        newAlbumParentDirectory: '/tmp',
      }),
    ).toThrow(/destination target/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        newAlbumName: 'My Album',
      }),
    ).toThrow(/newAlbumParentDirectory/);
    expect(() =>
      validateDownloadFromUrlPayload({
        url: 'https://example.com/a.mp3',
        splitIntoChapters: true,
        useVideoNameAsAlbum: true,
      }),
    ).toThrow(/newAlbumParentDirectory/);
    expect(() => validateDownloadFromUrlPayload(null)).toThrow(/payload/);
  });

  it('validates configure web download tools payload', () => {
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: true, acceptedWarning: true })).not.toThrow();
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: false })).not.toThrow();
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: true })).toThrow(/acceptedWarning/);
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: true, acceptedWarning: false })).toThrow(
      /acceptedWarning/,
    );
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: 'true' })).toThrow(/payload.enabled/);
    expect(() => validateConfigureWebDownloadToolsPayload({ enabled: false, acceptedWarning: 'true' })).toThrow(
      /acceptedWarning/,
    );
    expect(() => validateConfigureWebDownloadToolsPayload(null)).toThrow(/payload/);
  });

  it('validates scan VST plugins payload', () => {
    expect(() => validateScanVstPluginsPayload({ paths: [] })).not.toThrow();
    expect(() => validateScanVstPluginsPayload({ paths: ['/tmp/vst', '/tmp/vst3'] })).not.toThrow();
    expect(() => validateScanVstPluginsPayload({ paths: 'nope' })).toThrow(/payload.paths/);
    expect(() => validateScanVstPluginsPayload({ paths: ['/tmp/vst', 42] })).toThrow(/payload.paths/);
    expect(() => validateScanVstPluginsPayload(null)).toThrow(/payload/);
  });

  it('validates apply VST rack payload', () => {
    expect(() =>
      validateApplyVstRackPayload({
        filePath: '/tmp/a.wav',
        pluginPaths: ['/tmp/p1.vst3'],
      }),
    ).not.toThrow();
    expect(() =>
      validateApplyVstRackPayload({
        filePath: '/tmp/a.wav',
        pluginPaths: ['/tmp/p1.vst3'],
        hostExecutablePath: '/usr/local/bin/mrswatson',
      }),
    ).not.toThrow();
    expect(() => validateApplyVstRackPayload({ filePath: '/tmp/a.wav', pluginPaths: [] })).toThrow(/at least one/);
    expect(() => validateApplyVstRackPayload({ filePath: '/tmp/a.wav', pluginPaths: 'nope' })).toThrow(
      /pluginPaths/,
    );
    expect(() => validateApplyVstRackPayload({ filePath: '', pluginPaths: ['/tmp/p1.vst3'] })).toThrow(/filePath/);
    expect(() =>
      validateApplyVstRackPayload({
        filePath: '/tmp/a.wav',
        pluginPaths: ['/tmp/p1.vst3'],
        hostExecutablePath: '',
      }),
    ).toThrow(/hostExecutablePath/);
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
