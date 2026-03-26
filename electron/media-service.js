// Tests: tests/media-service.test.js

const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const ffmpegStaticPath = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

function readMagicBytes(filePath, length = 4) {
  try {
    const fileDescriptor = nodeFs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const bytesRead = nodeFs.readSync(fileDescriptor, buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      nodeFs.closeSync(fileDescriptor);
    }
  } catch {
    return null;
  }
}

function isWindowsPortableExecutable(filePath) {
  const magic = readMagicBytes(filePath, 2);
  return Boolean(magic && magic.length >= 2 && magic[0] === 0x4d && magic[1] === 0x5a);
}

function findBinaryOnPath(binaryName, compatibilityCheck) {
  const pathEntries = String(process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidate = path.join(entry, binaryName);
    if (!nodeFs.existsSync(candidate)) {
      continue;
    }

    if (compatibilityCheck && !compatibilityCheck(candidate)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function resolveBinaryPath(candidates, compatibilityCheck = null) {
  for (const candidate of candidates) {
    if (!candidate || !nodeFs.existsSync(candidate)) {
      continue;
    }

    if (compatibilityCheck && !compatibilityCheck(candidate)) {
      continue;
    }

    if (candidate && nodeFs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function deriveFfmpegCandidates(basePath) {
  if (!basePath) {
    return [];
  }

  const candidates = [basePath];

  if (basePath.endsWith('.exe')) {
    candidates.push(basePath.slice(0, -4));
  }

  const directory = path.dirname(basePath);
  if (directory) {
    candidates.push(path.join(directory, 'ffmpeg'));
    candidates.push(path.join(directory, 'ffmpeg.exe'));
  }

  return candidates;
}

function ensureWindowsExecutableBinary(binaryPath) {
  if (!binaryPath) {
    return null;
  }

  const shimDirectory = path.join(os.tmpdir(), 'audio-meta-editor', 'ffmpeg-static');
  const shimPath = path.join(shimDirectory, `${path.basename(binaryPath)}.exe`);

  try {
    nodeFs.mkdirSync(shimDirectory, { recursive: true });
    const sourceStats = nodeFs.statSync(binaryPath);
    let needsCopy = true;

    try {
      const shimStats = nodeFs.statSync(shimPath);
      needsCopy = shimStats.size !== sourceStats.size || shimStats.mtimeMs < sourceStats.mtimeMs;
    } catch {
      needsCopy = true;
    }

    if (needsCopy) {
      nodeFs.copyFileSync(binaryPath, shimPath);
      try {
        nodeFs.chmodSync(shimPath, 0o755);
      } catch {
        // Best effort; Windows ignores chmod but keep for parity.
      }
    }

    return shimPath;
  } catch (error) {
    console.warn('[ffmpeg] Failed to prepare Windows shim executable:', error);
    return binaryPath;
  }
}

const windowsCompatibilityCheck = process.platform === 'win32' ? isWindowsPortableExecutable : null;

const resolvedFfmpegPath = resolveBinaryPath(deriveFfmpegCandidates(ffmpegStaticPath), windowsCompatibilityCheck);
const ffmpegPathFromPath = findBinaryOnPath(
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  windowsCompatibilityCheck,
);
const ffmpegBasePath = resolvedFfmpegPath || ffmpegPathFromPath;
const ffmpegPath =
  process.platform === 'win32' && ffmpegBasePath && !ffmpegBasePath.toLowerCase().endsWith('.exe')
    ? ensureWindowsExecutableBinary(ffmpegBasePath)
    : ffmpegBasePath;

const ffprobePath = resolveBinaryPath([ffprobeStatic?.path], windowsCompatibilityCheck);

if (!resolvedFfmpegPath && ffmpegStaticPath && process.platform === 'win32') {
  console.warn(
    '[ffmpeg] Ignoring incompatible ffmpeg-static binary for Windows. Falling back to PATH lookup or shim if available.',
    ffmpegStaticPath,
  );
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);

function isSupportedAudioFile(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function getMusicMetadata() {
  return import('music-metadata');
}

async function scanDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const resolvedPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      // Depth-first traversal keeps memory usage predictable on large libraries.
      results.push(...(await scanDirectory(resolvedPath)));
      continue;
    }

    if (entry.isFile() && isSupportedAudioFile(resolvedPath)) {
      results.push(resolvedPath);
    }
  }

  return results;
}

function normalizeDirectoryPathForComparison(directoryPath, platform = process.platform) {
  if (typeof directoryPath !== 'string' || directoryPath.trim() === '') {
    return '';
  }

  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const resolved = pathApi.resolve(directoryPath);
  const withoutTrailingSeparator = resolved.replace(/[\\/]+$/, '');

  return platform === 'win32' ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}

function isSameDirectoryPath(leftPath, rightPath, platform = process.platform) {
  return (
    normalizeDirectoryPathForComparison(leftPath, platform) ===
    normalizeDirectoryPathForComparison(rightPath, platform)
  );
}

function coerceSingleValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }

  return typeof value === 'string' ? value : '';
}

function detectProducerTag(native = {}) {
  for (const tagGroup of Object.values(native)) {
    if (!Array.isArray(tagGroup)) {
      continue;
    }

    const match = tagGroup.find((entry) => {
      const tagId = String(entry.id || '').toLowerCase();
      return tagId.includes('producer') || tagId === 'tipl';
    });

    if (match) {
      return typeof match.value === 'string' ? match.value : coerceSingleValue(match.value?.producer || '');
    }
  }

  return '';
}

function toBinaryBuffer(data) {
  if (!data) {
    return null;
  }

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return null;
}

function normalizeImageMimeType(format, buffer) {
  const raw = String(format || '')
    .trim()
    .toLowerCase();
  const detected = detectImageFormat(toBinaryBuffer(buffer));

  if (raw.startsWith('image/')) {
    const normalizedRaw = raw === 'image/jpg' ? 'image/jpeg' : raw;

    // Some files carry incorrect format labels in tags; trust the byte signature when available.
    if (detected?.mimeType && detected.mimeType !== normalizedRaw) {
      return detected.mimeType;
    }

    return normalizedRaw;
  }

  const shorthands = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };

  if (shorthands[raw]) {
    if (detected?.mimeType && detected.mimeType !== shorthands[raw]) {
      return detected.mimeType;
    }

    return shorthands[raw];
  }

  // Fall back to byte signature detection for non-standard/unknown tags.
  return detected?.mimeType || null;
}

function pictureToDataUrl(picture) {
  const binary = toBinaryBuffer(picture?.data);
  if (!binary) {
    return null;
  }

  const mimeType = normalizeImageMimeType(picture.format, binary);
  if (!mimeType) {
    return null;
  }

  return `data:${mimeType};base64,${binary.toString('base64')}`;
}

function pickBestCoverPicture(pictures = []) {
  if (!Array.isArray(pictures) || pictures.length === 0) {
    return null;
  }

  const frontCover = pictures.find((picture) =>
    String(picture.type || '')
      .toLowerCase()
      .includes('front'),
  );
  return frontCover || pictures[0] || null;
}

function bufferToDataUrl(buffer, mimeType) {
  if (!buffer || !mimeType) {
    return null;
  }

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function runCommandCapture(command, args, captureStdout = false) {
  console.log('[system-call]', command, args.join(' '));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const stdoutChunks = [];

    child.stdout.on('data', (chunk) => {
      if (captureStdout) {
        stdoutChunks.push(Buffer.from(chunk));
      } else {
        stdout += chunk.toString();
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(captureStdout ? Buffer.concat(stdoutChunks) : stdout);
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function getBestVideoCoverCandidate(streams = []) {
  if (!Array.isArray(streams) || streams.length === 0) {
    return null;
  }

  const candidates = streams
    .filter((stream) => Number.isInteger(stream.index))
    .map((stream) => ({
      ...stream,
      area: Math.max(0, Number(stream.width || 0)) * Math.max(0, Number(stream.height || 0)),
      attachedPic: Boolean(stream.disposition?.attached_pic),
    }));

  candidates.sort((left, right) => {
    if (left.attachedPic !== right.attachedPic) {
      return left.attachedPic ? -1 : 1;
    }

    if (left.area !== right.area) {
      return right.area - left.area;
    }

    return left.index - right.index;
  });

  return candidates[0] || null;
}

async function extractCoverArtFromVideoStreams(filePath) {
  if (!ffprobePath || !ffmpegPath) {
    return null;
  }

  try {
    const probeArgs = ['-v', 'error', '-show_streams', '-select_streams', 'v', '-of', 'json', filePath];

    const probeOutput = await runCommandCapture(ffprobePath, probeArgs, false);
    const parsed = JSON.parse(probeOutput || '{}');
    const candidate = getBestVideoCoverCandidate(parsed.streams || []);
    if (!candidate) {
      return null;
    }

    // Prefer copying the embedded picture bytes to avoid losing alpha in re-encode.
    const copyArgs = [
      '-v',
      'error',
      '-i',
      filePath,
      '-map',
      `0:${candidate.index}`,
      '-frames:v',
      '1',
      '-c:v',
      'copy',
      '-f',
      'image2pipe',
      'pipe:1',
    ];

    const copiedImageBuffer = await runCommandCapture(ffmpegPath, copyArgs, true);
    const copiedDetected = detectImageFormat(copiedImageBuffer);
    if (copiedImageBuffer?.length && copiedDetected?.mimeType) {
      return bufferToDataUrl(copiedImageBuffer, copiedDetected.mimeType);
    }

    // Some formats/codecs cannot be piped as-is; transcode to PNG as fallback.
    const transcodeArgs = [
      '-v',
      'error',
      '-i',
      filePath,
      '-map',
      `0:${candidate.index}`,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ];

    const transcodedImageBuffer = await runCommandCapture(ffmpegPath, transcodeArgs, true);
    if (!transcodedImageBuffer || transcodedImageBuffer.length === 0) {
      return null;
    }

    const detected = detectImageFormat(transcodedImageBuffer);
    const mimeType = detected?.mimeType || 'image/png';
    return bufferToDataUrl(transcodedImageBuffer, mimeType);
  } catch (error) {
    console.warn('[extractCoverArtFromVideoStreams] Unable to extract cover art for', filePath, error);
    return null;
  }
}

async function extractMetadata(filePath) {
  const { parseFile } = await getMusicMetadata();
  const parsed = await parseFile(filePath, { skipCovers: false });
  const common = parsed.common;
  const metadataCoverArt = pictureToDataUrl(pickBestCoverPicture(common.picture));
  const fallbackCoverArt = metadataCoverArt ? null : await extractCoverArtFromVideoStreams(filePath);

  return {
    title: common.title || path.basename(filePath, path.extname(filePath)),
    album: common.album || '',
    artist: common.artist || '',
    albumArtist: common.albumartist || '',
    composer: coerceSingleValue(common.composer),
    producer: detectProducerTag(parsed.native),
    genre: coerceSingleValue(common.genre),
    year: common.year ? String(common.year) : '',
    track: common.track?.no ? String(common.track.no) : '',
    disc: common.disk?.no ? String(common.disk.no) : '',
    comment: coerceSingleValue(common.comment),
    coverArt: metadataCoverArt || fallbackCoverArt,
    duration: parsed.format.duration || 0,
    sampleRate: parsed.format.sampleRate || 0,
    bitrate: parsed.format.bitrate || 0,
    codec: parsed.format.codec || parsed.format.container || '',
  };
}

async function buildLibrary(pathsToScan) {
  const seen = new Set();
  const files = [];

  for (const selectedPath of pathsToScan) {
    const stats = await fs.stat(selectedPath);
    if (stats.isDirectory()) {
      const rootDirectory = path.resolve(selectedPath);
      const nested = await scanDirectory(selectedPath);
      for (const nestedPath of nested) {
        if (!seen.has(nestedPath)) {
          seen.add(nestedPath);
          files.push({
            path: nestedPath,
            openedDirectoryRoot: rootDirectory,
            isInOpenedDirectoryRoot: isSameDirectoryPath(path.dirname(nestedPath), rootDirectory),
          });
        }
      }
      continue;
    }

    if (stats.isFile() && isSupportedAudioFile(selectedPath) && !seen.has(selectedPath)) {
      seen.add(selectedPath);
      files.push({
        path: selectedPath,
        openedDirectoryRoot: null,
        isInOpenedDirectoryRoot: false,
      });
    }
  }

  const items = await Promise.all(
    files
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(async (file) => {
        const metadata = await extractMetadata(file.path);
        return {
          path: file.path,
          name: path.basename(file.path),
          directory: path.dirname(file.path),
          extension: path.extname(file.path).slice(1).toLowerCase(),
          openedDirectoryRoot: file.openedDirectoryRoot,
          isInOpenedDirectoryRoot: file.isInOpenedDirectoryRoot,
          metadata,
        };
      }),
  );

  return items;
}

function parseDataUrl(dataUrl) {
  if (!dataUrl) {
    return null;
  }

  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionFromMimeType(mimeType) {
  if (!mimeType) {
    return null;
  }

  const normalized = String(mimeType).trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  return null;
}

function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PNG
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
}

function normalizeCoverArt(coverArt) {
  if (!coverArt?.buffer) {
    return null;
  }

  const detected = detectImageFormat(coverArt.buffer);
  if (!detected) {
    return null;
  }

  return {
    buffer: coverArt.buffer,
    mimeType: detected.mimeType,
    extension: detected.extension,
  };
}

function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg binary was not found. Reinstall dependencies for this platform (delete node_modules + package-lock.json, then run npm install) or install ffmpeg in PATH.',
    );
  }

  console.log('[system-call]', ffmpegPath, args.join(' '));

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function requiresLocalFfmpegInput(filePath) {
  // ffmpeg static builds often cannot read GVFS virtual mount paths directly.
  return typeof filePath === 'string' && filePath.includes('/gvfs/');
}

async function copyFileWithFallback(sourcePath, destinationPath) {
  try {
    await fs.copyFile(sourcePath, destinationPath);
    return;
  } catch (error) {
    const retryableCodes = new Set(['ENOTSUP', 'EXDEV', 'EOPNOTSUPP']);
    if (!retryableCodes.has(error?.code)) {
      throw error;
    }
  }

  // Some virtual/network mounts (e.g. GVFS SMB) do not support copy_file_range.
  await pipeline(nodeFs.createReadStream(sourcePath), nodeFs.createWriteStream(destinationPath));
}

async function saveMetadata(filePath, metadata) {
  console.log('[backend-action] saveMetadata:start', filePath);
  const extension = path.extname(filePath).toLowerCase();
  // Some virtual/network mounts need local staging before ffmpeg can read reliably.
  const shouldStageInput = requiresLocalFfmpegInput(filePath);
  const tempInput = shouldStageInput
    ? path.join(os.tmpdir(), `${path.basename(filePath, extension)}-input-${Date.now()}${extension}`)
    : null;
  const ffmpegInputPath = tempInput || filePath;
  const tempOutput = path.join(os.tmpdir(), `${path.basename(filePath, extension)}-${Date.now()}${extension}`);
  const parsedCoverArt = parseDataUrl(metadata.coverArt);
  const coverArt = normalizeCoverArt(parsedCoverArt);
  const tempCoverSourcePath = coverArt ? path.join(os.tmpdir(), `cover-src-${Date.now()}.${coverArt.extension}`) : null;
  const tempCoverPath = coverArt ? path.join(os.tmpdir(), `cover-${Date.now()}.jpg`) : null;
  const args = ['-y', '-i', ffmpegInputPath];

  if (parsedCoverArt && !coverArt) {
    console.warn('[saveMetadata] Ignoring invalid cover art payload for', filePath);
  }

  if (tempInput) {
    await copyFileWithFallback(filePath, tempInput);
  }

  if (extension === '.mp3') {
    // Always remap MP3 output from audio stream, then optionally attach a normalized JPEG cover.
    // This prevents stale/unsupported artwork payloads and improves external server compatibility.
    args.push('-map', '0:a', '-c:a', 'copy');

    if (tempCoverSourcePath && tempCoverPath) {
      await fs.writeFile(tempCoverSourcePath, coverArt.buffer);
      await runFfmpeg(['-y', '-i', tempCoverSourcePath, '-frames:v', '1', '-q:v', '2', tempCoverPath]);

      args.push(
        '-i',
        tempCoverPath,
        '-map',
        '1:v',
        '-c:v',
        'mjpeg',
        '-metadata:s:v',
        'title=Album cover',
        '-metadata:s:v',
        'comment=Cover (front)',
        '-disposition:v:0',
        'attached_pic',
      );
    }
  } else {
    args.push('-map', '0', '-c', 'copy');
  }

  const metadataMap = {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    album_artist: metadata.albumArtist,
    composer: metadata.composer,
    producer: metadata.producer,
    genre: metadata.genre,
    date: metadata.year,
    track: metadata.track,
    disc: metadata.disc,
    comment: metadata.comment,
  };

  for (const [key, value] of Object.entries(metadataMap)) {
    if (value) {
      args.push('-metadata', `${key}=${value}`);
    }
  }

  if (extension === '.mp3') {
    args.push('-id3v2_version', '3');
  }

  args.push(tempOutput);

  try {
    await runFfmpeg(args);
    // Overwrite through copy fallback for cross-device and mount compatibility.
    await copyFileWithFallback(tempOutput, filePath);
  } finally {
    if (tempInput) {
      await fs.rm(tempInput, { force: true });
    }
    await fs.rm(tempOutput, { force: true });
    if (tempCoverSourcePath) {
      await fs.rm(tempCoverSourcePath, { force: true });
    }
    if (tempCoverPath) {
      await fs.rm(tempCoverPath, { force: true });
    }
  }

  const extracted = await extractMetadata(filePath);
  if (metadata.coverArt && !extracted.coverArt) {
    console.warn('[backend-action] saveMetadata:cover-missing-after-write', filePath);
  }

  console.log('[backend-action] saveMetadata:done', filePath);
  return extracted;
}

async function exportAudioSegment(filePath, startTime, endTime, outputPath) {
  const extension = path.extname(filePath).toLowerCase();
  const args = [
    '-y',
    '-ss',
    String(startTime),
    '-to',
    String(endTime),
    '-i',
    filePath,
    '-map_metadata',
    '0',
    '-map',
    '0:a:0',
  ];

  if (extension === '.mp3') {
    args.push('-codec:a', 'libmp3lame', '-q:a', '2');
  } else {
    args.push('-codec:a', 'copy');
  }

  args.push(outputPath);

  await runFfmpeg(args);

  return outputPath;
}

async function editAudioSelection(filePath, startTime, endTime, mode, outputPath) {
  const extension = path.extname(filePath).toLowerCase();

  if (mode === 'trim') {
    return exportAudioSegment(filePath, startTime, endTime, outputPath);
  }

  if (mode !== 'cut') {
    throw new Error(`Unsupported edit mode: ${mode}`);
  }

  const args = [
    '-y',
    '-i',
    filePath,
    '-filter_complex',
    `[0:a]atrim=0:${startTime},asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=${endTime},asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[outa]`,
    '-map_metadata',
    '0',
    '-map',
    '[outa]',
  ];

  if (extension === '.mp3') {
    args.push('-codec:a', 'libmp3lame', '-q:a', '2');
  } else {
    args.push('-codec:a', 'pcm_s16le');
  }

  args.push(outputPath);
  await runFfmpeg(args);
  return outputPath;
}

module.exports = {
  buildLibrary,
  extractMetadata,
  exportAudioSegment,
  editAudioSelection,
  isSupportedAudioFile,
  saveMetadata,
  parseDataUrl,
  extensionFromMimeType,
  __testables: {
    scanDirectory,
    normalizeDirectoryPathForComparison,
    isSameDirectoryPath,
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
    copyFileWithFallback,
    requiresLocalFfmpegInput,
    pictureToDataUrl,
  },
};
