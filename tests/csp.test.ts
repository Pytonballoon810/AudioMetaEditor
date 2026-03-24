import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INDEX_HTML_PATH = path.resolve(process.cwd(), 'index.html');

function parseDirective(csp: string, directive: string): string[] {
  const segment = csp
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${directive} `));

  if (!segment) {
    return [];
  }

  return segment.slice(directive.length).trim().split(/\s+/).filter(Boolean);
}

describe('content security policy', () => {
  it('defines a CSP meta policy', async () => {
    const html = await fs.readFile(INDEX_HTML_PATH, 'utf8');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });

  it('allows data URLs in connect-src for WaveSurfer data: loads', async () => {
    const html = await fs.readFile(INDEX_HTML_PATH, 'utf8');
    const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

    expect(cspMatch).toBeTruthy();
    const policy = cspMatch?.[1] ?? '';
    const connectSrc = parseDirective(policy, 'connect-src');

    expect(connectSrc).toContain('data:');
    expect(connectSrc).toContain("'self'");
  });

  it('does not use frame-ancestors in meta CSP because browsers ignore it there', async () => {
    const html = await fs.readFile(INDEX_HTML_PATH, 'utf8');
    const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

    expect(cspMatch).toBeTruthy();
    const policy = cspMatch?.[1] ?? '';
    expect(policy).not.toMatch(/(^|;)\s*frame-ancestors\s+/);
  });
});
