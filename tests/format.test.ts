import { describe, expect, it } from 'vitest';
import { formatBitrate, formatDuration } from '../src/lib/format';

describe('formatDuration', () => {
  it('returns mm:ss for values under one hour', () => {
    expect(formatDuration(65)).toBe('01:05');
  });

  it('returns hh:mm:ss for values over one hour', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  it('returns 00:00 for invalid values', () => {
    expect(formatDuration(-1)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });
});

describe('formatBitrate', () => {
  it('formats bits per second to kbps', () => {
    expect(formatBitrate(192000)).toBe('192 kbps');
  });

  it('handles invalid bitrate values', () => {
    expect(formatBitrate(0)).toBe('Unknown bitrate');
    expect(formatBitrate(Number.NaN)).toBe('Unknown bitrate');
  });
});
