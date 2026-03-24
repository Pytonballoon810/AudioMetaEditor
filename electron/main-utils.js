const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const AUDIO_CONTENT_TYPE_EXTENSION_MAP = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};

function getSupportedExtensionFromUrl(urlString) {
  try {
    const urlObject = new URL(urlString);
    const extension = path.extname(decodeURIComponent(urlObject.pathname)).toLowerCase();
    return ['.mp3', '.wav'].includes(extension) ? extension : null;
  } catch {
    return null;
  }
}

function extensionFromContentType(contentType = '') {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return AUDIO_CONTENT_TYPE_EXTENSION_MAP[normalized] || null;
}

function fileNameFromUrl(urlString, extension) {
  try {
    const urlObject = new URL(urlString);
    const rawName = path.basename(decodeURIComponent(urlObject.pathname || 'download'));
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, '-').trim();
    const nameWithoutExtension = safeName ? safeName.replace(/\.[^.]*$/, '') : 'download';
    return `${nameWithoutExtension || 'download'}${extension}`;
  } catch {
    return `download${extension}`;
  }
}

async function ensureUniquePath(targetPath) {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);

  let candidatePath = targetPath;
  let counter = 1;

  while (true) {
    try {
      await fs.access(candidatePath);
      candidatePath = path.join(directory, `${baseName} (${counter})${extension}`);
      counter += 1;
    } catch {
      return candidatePath;
    }
  }
}

function getLaunchPaths(argv, isPackaged) {
  const offset = isPackaged ? 1 : 2;

  return argv
    .slice(offset)
    .filter((value) => value && !value.startsWith('--'))
    .map((value) => path.resolve(value))
    .filter(Boolean);
}

function isPrivateOrLocalHostname(hostname) {
  if (!hostname) {
    return true;
  }

  const normalized = String(hostname).trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.local')) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map((part) => Number(part));
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return true;
    }

    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    return false;
  }

  if (ipVersion === 6) {
    // Covers loopback, unique local (fc00::/7), and link-local (fe80::/10).
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }

  return false;
}

function isAllowedDownloadUrl(urlObject, options = {}) {
  const { allowPrivateHosts = false } = options;
  if (!urlObject || typeof urlObject !== 'object') {
    return false;
  }

  if (!['http:', 'https:'].includes(urlObject.protocol)) {
    return false;
  }

  if (allowPrivateHosts) {
    return true;
  }

  return !isPrivateOrLocalHostname(urlObject.hostname);
}

module.exports = {
  getSupportedExtensionFromUrl,
  extensionFromContentType,
  fileNameFromUrl,
  ensureUniquePath,
  getLaunchPaths,
  isPrivateOrLocalHostname,
  isAllowedDownloadUrl,
};
