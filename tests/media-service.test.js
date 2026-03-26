import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mediaService = require('../electron/media-service');
const {
  scanDirectory,
  coerceSingleValue,
  detectProducerTag,
  toBinaryBuffer,
  normalizeImageMimeType,
  bufferToDataUrl,
  parseDataUrl,
  extensionFromMimeType,
  detectImageFormat,
  normalizeCoverArt,
  pickBestCoverPicture,
  getBestVideoCoverCandidate,
  pictureToDataUrl,
  requiresLocalFfmpegInput,
  normalizeDirectoryPathForComparison,
  isSameDirectoryPath,
} = mediaService.__testables;

describe('isSupportedAudioFile', () => {
  it('accepts mp3 and wav regardless of case', () => {
    expect(mediaService.isSupportedAudioFile('/music/a.mp3')).toBe(true);
    expect(mediaService.isSupportedAudioFile('/music/b.WAV')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(mediaService.isSupportedAudioFile('/music/a.flac')).toBe(false);
  });
});

describe('ffmpeg path staging', () => {
  it('detects gvfs paths that require local staging', () => {
    expect(requiresLocalFfmpegInput('/run/user/1000/gvfs/smb-share:server=nas,share=music/a.mp3')).toBe(true);
  });

  it('does not stage normal local filesystem paths', () => {
    expect(requiresLocalFfmpegInput('/home/user/Music/a.mp3')).toBe(false);
  });
});

describe('scanDirectory', () => {
  it('finds only supported audio files recursively', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ame-scan-'));
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested, { recursive: true });

    const mp3Path = path.join(root, 'song.mp3');
    const wavPath = path.join(nested, 'drum.wav');
    const txtPath = path.join(nested, 'note.txt');

    await fs.writeFile(mp3Path, 'a');
    await fs.writeFile(wavPath, 'b');
    await fs.writeFile(txtPath, 'c');

    const result = await scanDirectory(root);

    expect(result).toContain(mp3Path);
    expect(result).toContain(wavPath);
    expect(result).not.toContain(txtPath);

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('root pseudo-folder path comparison', () => {
  it('normalizes trailing slashes and casing for Windows-style paths', () => {
    expect(normalizeDirectoryPathForComparison('F:\\Music\\Album\\', 'win32')).toBe('f:\\music\\album');
    expect(normalizeDirectoryPathForComparison('f:\\music\\album', 'win32')).toBe('f:\\music\\album');
  });

  it('treats Windows directory paths as equal when only casing differs', () => {
    expect(isSameDirectoryPath('F:\\Music', 'f:\\music', 'win32')).toBe(true);
  });

  it('treats Windows directory paths as equal when only trailing slash differs', () => {
    expect(isSameDirectoryPath('F:\\Music\\Album\\', 'F:\\Music\\Album', 'win32')).toBe(true);
  });

  it('keeps POSIX comparison case-sensitive', () => {
    expect(isSameDirectoryPath('/music/Album', '/music/album', 'linux')).toBe(false);
  });
});

describe('metadata helpers', () => {
  it('coerceSingleValue joins arrays and handles non-strings', () => {
    expect(coerceSingleValue(['A', '', 'B'])).toBe('A, B');
    expect(coerceSingleValue(42)).toBe('');
  });

  it('detectProducerTag reads producer from native tags', () => {
    const native = {
      id3v2: [
        { id: 'TIT2', value: 'Track' },
        { id: 'producer', value: 'Producer Name' },
      ],
    };

    expect(detectProducerTag(native)).toBe('Producer Name');
  });

  it('detectProducerTag supports TIPL object format', () => {
    const native = {
      id3v2: [{ id: 'TIPL', value: { producer: ['One', 'Two'] } }],
    };

    expect(detectProducerTag(native)).toBe('One, Two');
  });
});

describe('cover art parsing and normalization', () => {
  it('builds data urls from buffers with explicit mime type', () => {
    const result = bufferToDataUrl(Buffer.from([0x01, 0x02]), 'image/png');
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('selects best video cover candidate preferring attached picture and resolution', () => {
    const streams = [
      { index: 2, width: 512, height: 512, disposition: { attached_pic: 0 } },
      { index: 4, width: 600, height: 600, disposition: { attached_pic: 1 } },
      { index: 6, width: 1200, height: 1200, disposition: { attached_pic: 0 } },
    ];

    expect(getBestVideoCoverCandidate(streams)).toMatchObject({ index: 4 });
  });

  it('converts Uint8Array cover payload to Buffer', () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const converted = toBinaryBuffer(data);

    expect(Buffer.isBuffer(converted)).toBe(true);
    expect(converted.length).toBe(4);
  });

  it('prefers front cover when multiple pictures exist', () => {
    const pictures = [
      { type: 'Other', data: new Uint8Array([1]), format: 'image/jpeg' },
      { type: 'Cover (front)', data: new Uint8Array([2]), format: 'image/jpeg' },
    ];

    expect(pickBestCoverPicture(pictures)).toBe(pictures[1]);
  });

  it('normalizes shorthand and non-canonical jpeg mime labels', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(normalizeImageMimeType('jpg', jpegBuffer)).toBe('image/jpeg');
    expect(normalizeImageMimeType('image/jpg', jpegBuffer)).toBe('image/jpeg');
  });

  it('prefers detected image signature over incorrect declared format', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(normalizeImageMimeType('image/jpeg', pngBuffer)).toBe('image/png');
  });

  it('parses valid data URLs', () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xaa]).toString('base64');
    const parsed = parseDataUrl(`data:image/jpeg;base64,${payload}`);

    expect(parsed.mimeType).toBe('image/jpeg');
    expect(parsed.buffer).toBeInstanceOf(Buffer);
  });

  it('returns null for invalid data URLs', () => {
    expect(parseDataUrl('not-a-data-url')).toBeNull();
  });

  it('maps image mime types to file extensions', () => {
    expect(extensionFromMimeType('image/png')).toBe('png');
    expect(extensionFromMimeType('image/jpeg')).toBe('jpg');
    expect(extensionFromMimeType('image/jpg')).toBe('jpg');
    expect(extensionFromMimeType('image/webp')).toBe('webp');
    expect(extensionFromMimeType('application/json')).toBeNull();
  });

  it('detects png, jpeg, gif and webp signatures', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

    expect(detectImageFormat(png)).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(detectImageFormat(jpeg)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(detectImageFormat(gif)).toEqual({ mimeType: 'image/gif', extension: 'gif' });
    expect(detectImageFormat(webp)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('detects png signature for fallback-extracted cover bytes', () => {
    const extractedPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectImageFormat(extractedPngBytes)).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('normalizes cover art only for valid signatures', () => {
    const jpeg = { mimeType: 'image/png', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
    const invalid = { mimeType: 'image/png', buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]) };

    expect(normalizeCoverArt(jpeg)).toEqual({
      buffer: jpeg.buffer,
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(normalizeCoverArt(invalid)).toBeNull();
  });

  it('converts picture buffers to data URLs', () => {
    const picture = {
      format: 'png',
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    };

    expect(pictureToDataUrl(picture)).toMatch(/^data:image\/png;base64,/);
  });
});
