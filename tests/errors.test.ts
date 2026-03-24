import { describe, expect, it } from 'vitest';
import { toUserErrorMessage } from '../src/lib/errors';

describe('toUserErrorMessage', () => {
  it('returns fallback for non-error values', () => {
    expect(toUserErrorMessage('oops', 'Fallback')).toBe('Fallback');
  });

  it('returns plain message for non-prefixed errors', () => {
    expect(toUserErrorMessage(new Error('Simple failure'), 'Fallback')).toBe('Simple failure');
  });

  it('formats channel-prefixed errors as detail then channel', () => {
    const error = new Error('[library:load] pathsToScan must be an array of strings.');
    expect(toUserErrorMessage(error, 'Fallback')).toBe('pathsToScan must be an array of strings. (library:load)');
  });

  it('handles empty detail in channel-prefixed error', () => {
    const error = new Error('[audio:load-blob]');
    expect(toUserErrorMessage(error, 'Fallback')).toBe('Fallback (audio:load-blob)');
  });

  it('keeps non-matching bracketed messages unchanged', () => {
    const error = new Error('[broken-prefix message');
    expect(toUserErrorMessage(error, 'Fallback')).toBe('[broken-prefix message');
  });

  it('trims whitespace around prefixed detail', () => {
    const error = new Error('[metadata:save]   payload.filePath must be a non-empty string.   ');
    expect(toUserErrorMessage(error, 'Fallback')).toBe('payload.filePath must be a non-empty string. (metadata:save)');
  });
});
