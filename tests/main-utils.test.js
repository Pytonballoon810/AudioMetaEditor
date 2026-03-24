import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  extensionFromContentType,
  getSupportedExtensionFromUrl,
  fileNameFromUrl,
  ensureUniquePath,
  getLaunchPaths,
  isPrivateOrLocalHostname,
  isAllowedDownloadUrl,
} = require('../electron/main-utils');

describe('main-utils download helpers', () => {
  it('maps supported audio content types to file extensions', () => {
    expect(extensionFromContentType('audio/mpeg')).toBe('.mp3');
    expect(extensionFromContentType('audio/wav; charset=binary')).toBe('.wav');
    expect(extensionFromContentType('text/html')).toBeNull();
  });

  it('detects supported extension from URL path', () => {
    expect(getSupportedExtensionFromUrl('https://cdn.example.com/track.MP3?sig=abc')).toBe('.mp3');
    expect(getSupportedExtensionFromUrl('https://cdn.example.com/video.mp4')).toBeNull();
  });

  it('creates safe output filename from URL', () => {
    expect(fileNameFromUrl('https://example.com/music/final%20mix.wav', '.wav')).toBe('final mix.wav');
    const sanitized = fileNameFromUrl('https://example.com/music/<>:\\*?"|.mp3', '.mp3');
    expect(sanitized.endsWith('.mp3')).toBe(true);
    expect(/[\\/:*?"<>|]/.test(sanitized)).toBe(false);
  });
});

describe('main-utils launch/open helpers', () => {
  it('parses launch paths from argv for dev mode', () => {
    const paths = getLaunchPaths(['node', 'electron', '/tmp/a.mp3', '--flag', '/tmp/b.wav'], false);
    expect(paths).toEqual([path.resolve('/tmp/a.mp3'), path.resolve('/tmp/b.wav')]);
  });

  it('parses launch paths from argv for packaged mode', () => {
    const paths = getLaunchPaths(['AudioMetaEditor', '/tmp/a.mp3', '--hidden'], true);
    expect(paths).toEqual([path.resolve('/tmp/a.mp3')]);
  });

  it('creates unique destination path when target exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ame-main-utils-'));
    const source = path.join(root, 'song.mp3');
    await fs.writeFile(source, 'data');

    const unique = await ensureUniquePath(source);
    expect(unique).toBe(path.join(root, 'song (1).mp3'));

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('main-utils security helpers', () => {
  it('detects private and local hostnames', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('192.168.1.10')).toBe(true);
    expect(isPrivateOrLocalHostname('10.0.0.3')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
    expect(isPrivateOrLocalHostname('1.1.1.1')).toBe(false);
  });

  it('allows only public http(s) URLs by default', () => {
    expect(isAllowedDownloadUrl(new URL('https://example.com/track.mp3'))).toBe(true);
    expect(isAllowedDownloadUrl(new URL('http://192.168.1.2/track.mp3'))).toBe(false);
    expect(isAllowedDownloadUrl(new URL('ftp://example.com/track.mp3'))).toBe(false);
  });

  it('allows private http(s) URLs when explicitly enabled', () => {
    expect(isAllowedDownloadUrl(new URL('http://192.168.1.2/track.mp3'), { allowPrivateHosts: true })).toBe(true);
  });
});
