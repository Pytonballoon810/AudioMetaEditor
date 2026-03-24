import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { bytesToMegabytes, readFileAsBase64WithLimit } = require('../electron/file-io');

describe('file-io utilities', () => {
  it('formats bytes to megabytes with one decimal', () => {
    expect(bytesToMegabytes(1048576)).toBe('1.0');
    expect(bytesToMegabytes(1572864)).toBe('1.5');
  });

  it('reads file as base64 when under limit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ame-file-io-'));
    const samplePath = path.join(root, 'sample.wav');
    const sample = Buffer.from('hello-audio');
    await fs.writeFile(samplePath, sample);

    const result = await readFileAsBase64WithLimit(samplePath, 1024);
    expect(result).toBe(sample.toString('base64'));

    await fs.rm(root, { recursive: true, force: true });
  });

  it('throws when file exceeds limit before streaming', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ame-file-io-'));
    const samplePath = path.join(root, 'large.mp3');
    await fs.writeFile(samplePath, Buffer.alloc(32));

    await expect(readFileAsBase64WithLimit(samplePath, 8)).rejects.toThrow(/too large/);

    await fs.rm(root, { recursive: true, force: true });
  });
});
