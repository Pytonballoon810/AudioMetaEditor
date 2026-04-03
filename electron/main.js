const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const chokidar = require('chokidar');
const { app, BrowserWindow, dialog, ipcMain, net, protocol, Menu, screen, shell } = require('electron');

const {
  buildLibrary,
  editAudioSelection,
  exportAudioSegment,
  convertAudioFormat,
  __testables,
} = require('./media-service');
const { readFileAsBase64WithLimit } = require('./file-io');
const {
  getSupportedExtensionFromUrl,
  extensionFromContentType,
  fileNameFromUrl,
  ensureUniquePath,
  getLaunchPaths,
  isAllowedDownloadUrl,
} = require('./main-utils');
const {
  validateLibraryLoadPayload,
  validateMetadataSavePayload,
  validateExportClipPayload,
  validateEditSelectionPayload,
  validateSplitSelectionPayload,
  validateConvertAudioPayload,
  validateLoadBlobPayload,
  validateDownloadFromUrlPayload,
  validateMoveTrackPayload,
  validateOpenFileLocationPayload,
  validateSaveCoverImagePayload,
} = require('./ipc-validators');

const { parseDataUrl, extensionFromMimeType } = __testables;

// Prefer overlay scrollbars so classic arrow-button scrollbar widgets are not shown.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,OverlayScrollbars');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'audio-meta',
    privileges: {
      standard: true,
      supportFetchAPI: true,
      secure: true,
      stream: true,
    },
  },
]);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let pendingPaths = [];
let libraryWatcher = null;
let libraryWatcherDebounceTimer = null;
let pendingLibraryChangedPath = null;
let metadataWorker = null;
let metadataWorkerRequestSequence = 0;
const pendingMetadataWorkerRequests = new Map();
const MAX_AUDIO_BLOB_BYTES = 80 * 1024 * 1024;
const DEFAULT_WINDOW_WIDTH = 1520;
const DEFAULT_WINDOW_HEIGHT = 940;
const MIN_WINDOW_WIDTH = 1120;
const MIN_WINDOW_HEIGHT = 720;
const WINDOW_STATE_FILE_PATH = path.join(app.getPath('userData'), 'window-state.json');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readWindowState() {
  try {
    if (!fsSync.existsSync(WINDOW_STATE_FILE_PATH)) {
      return null;
    }

    const raw = fsSync.readFileSync(WINDOW_STATE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const bounds = parsed.bounds;
    if (!bounds || typeof bounds !== 'object') {
      return null;
    }

    const numericKeys = ['x', 'y', 'width', 'height'];
    const hasAllNumbers = numericKeys.every((key) => Number.isFinite(bounds[key]));
    if (!hasAllNumbers) {
      return null;
    }

    return {
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
        height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
      },
      isMaximized: parsed.isMaximized === true,
    };
  } catch (error) {
    console.warn('[window-state] Failed to read state:', error);
    return null;
  }
}

function writeWindowState(state) {
  try {
    fsSync.mkdirSync(path.dirname(WINDOW_STATE_FILE_PATH), { recursive: true });
    fsSync.writeFileSync(WINDOW_STATE_FILE_PATH, JSON.stringify(state), 'utf8');
  } catch (error) {
    console.warn('[window-state] Failed to write state:', error);
  }
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isWindowBoundsVisible(bounds) {
  return screen.getAllDisplays().some((display) => intersects(bounds, display.workArea));
}

function getRestoredWindowState() {
  const state = readWindowState();
  if (!state) {
    return null;
  }

  const display = screen.getDisplayMatching(state.bounds);
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, display.workArea.width);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, display.workArea.height);
  const width = clamp(state.bounds.width, MIN_WINDOW_WIDTH, maxWidth);
  const height = clamp(state.bounds.height, MIN_WINDOW_HEIGHT, maxHeight);

  const normalized = {
    x: state.bounds.x,
    y: state.bounds.y,
    width,
    height,
  };

  if (!isWindowBoundsVisible(normalized)) {
    return null;
  }

  return {
    bounds: normalized,
    isMaximized: state.isMaximized,
  };
}

function resolveRuntimeIconPath() {
  const byPlatform = {
    linux: 'build/icons/linux/512x512.png',
    win32: 'build/icons/win/icon.ico',
    darwin: 'build/icons/mac/512x512.png',
  };

  const iconRelativePath = byPlatform[process.platform];
  if (!iconRelativePath) {
    return null;
  }

  const candidate = path.join(__dirname, '..', iconRelativePath);
  return fsSync.existsSync(candidate) ? candidate : null;
}

async function moveFileWithFallback(sourcePath, destinationPath) {
  const sourceStats = await fs.stat(sourcePath);
  try {
    await fs.rename(sourcePath, destinationPath);
    const destinationStats = await fs.stat(destinationPath);
    if (destinationStats.size !== sourceStats.size) {
      throw new Error('Moved file size mismatch after rename operation.');
    }
    return;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error) || error.code !== 'EXDEV') {
      throw error;
    }
  }

  await fs.copyFile(sourcePath, destinationPath);
  const destinationStats = await fs.stat(destinationPath);
  if (destinationStats.size !== sourceStats.size) {
    await fs.rm(destinationPath, { force: true });
    throw new Error('Moved file size mismatch after cross-device copy operation. Source was not removed.');
  }
  await fs.unlink(sourcePath);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadRenderer(mainWindowInstance) {
  if (!process.env.VITE_DEV_SERVER_URL) {
    await mainWindowInstance.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    return;
  }

  const maxAttempts = 20;
  const retryDelayMs = 400;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mainWindowInstance.loadURL(process.env.VITE_DEV_SERVER_URL);
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await delay(retryDelayMs);
    }
  }
}

function createMenu() {
  const template = [
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Console',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.openDevTools();
            }
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function filterExistingPaths(pathsToFilter) {
  const results = [];

  for (const candidate of pathsToFilter) {
    try {
      await fs.access(candidate);
      results.push(candidate);
    } catch {
      // Ignore invalid paths passed by the shell or desktop environment.
    }
  }

  return results;
}

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ipc:${channel}]`, error);
      throw new Error(`[${channel}] ${message}`);
    }
  });
}

function rejectPendingMetadataWorkerRequests(reason) {
  if (pendingMetadataWorkerRequests.size === 0) {
    return;
  }

  const error = reason instanceof Error ? reason : new Error(String(reason));
  for (const pending of pendingMetadataWorkerRequests.values()) {
    pending.reject(error);
  }
  pendingMetadataWorkerRequests.clear();
}

function ensureMetadataWorker() {
  if (metadataWorker) {
    return metadataWorker;
  }

  const worker = new Worker(path.join(__dirname, 'metadata-worker.js'));

  worker.on('message', (payload) => {
    const requestId = payload?.requestId;
    if (typeof requestId !== 'number') {
      return;
    }

    const pending = pendingMetadataWorkerRequests.get(requestId);
    if (!pending) {
      return;
    }

    pendingMetadataWorkerRequests.delete(requestId);

    if (payload?.ok) {
      pending.resolve(payload.result);
      return;
    }

    pending.reject(new Error(payload?.error || 'Metadata save worker failed.'));
  });

  worker.on('error', (error) => {
    console.error('[metadata-worker] Worker error:', error);
    metadataWorker = null;
    rejectPendingMetadataWorkerRequests(error);
  });

  worker.on('exit', (code) => {
    metadataWorker = null;
    if (code !== 0) {
      rejectPendingMetadataWorkerRequests(new Error(`[metadata-worker] Exited with code ${code}`));
    }
  });

  metadataWorker = worker;
  return worker;
}

function saveMetadataInWorker(filePath, metadata) {
  const worker = ensureMetadataWorker();
  const requestId = metadataWorkerRequestSequence;
  metadataWorkerRequestSequence += 1;

  return new Promise((resolve, reject) => {
    pendingMetadataWorkerRequests.set(requestId, { resolve, reject });
    try {
      worker.postMessage({ requestId, filePath, metadata });
    } catch (error) {
      pendingMetadataWorkerRequests.delete(requestId);
      reject(error);
    }
  });
}

async function disposeMetadataWorker() {
  rejectPendingMetadataWorkerRequests(new Error('Metadata worker is shutting down.'));

  if (!metadataWorker) {
    return;
  }

  const worker = metadataWorker;
  metadataWorker = null;

  try {
    await worker.terminate();
  } catch (error) {
    console.warn('[metadata-worker] Failed to terminate cleanly:', error);
  }
}

async function disposeLibraryWatcher() {
  if (libraryWatcherDebounceTimer) {
    clearTimeout(libraryWatcherDebounceTimer);
    libraryWatcherDebounceTimer = null;
  }

  pendingLibraryChangedPath = null;

  if (!libraryWatcher) {
    return;
  }

  const watcher = libraryWatcher;
  libraryWatcher = null;

  try {
    await watcher.close();
  } catch (error) {
    console.warn('[library-watcher] Failed to close watcher cleanly:', error);
  }
}

function scheduleLibraryChangedRefresh(changedPath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  pendingLibraryChangedPath = changedPath || pendingLibraryChangedPath || '(unknown path)';

  if (libraryWatcherDebounceTimer) {
    clearTimeout(libraryWatcherDebounceTimer);
  }

  libraryWatcherDebounceTimer = setTimeout(() => {
    libraryWatcherDebounceTimer = null;

    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingLibraryChangedPath = null;
      return;
    }

    mainWindow.webContents.send('library:changed', {
      changedPath: pendingLibraryChangedPath || '(unknown path)',
      timestamp: Date.now(),
    });
    pendingLibraryChangedPath = null;
  }, 420);
}

async function resolveWatchTargets(pathsToScan) {
  const uniqueTargets = new Set();

  for (const sourcePath of pathsToScan) {
    try {
      const resolved = path.resolve(sourcePath);
      const stats = await fs.stat(resolved);
      if (stats.isFile() || stats.isDirectory()) {
        uniqueTargets.add(resolved);
      }
    } catch {
      // Ignore paths that no longer exist.
    }
  }

  return Array.from(uniqueTargets);
}

async function configureLibraryWatcher(pathsToScan) {
  await disposeLibraryWatcher();
  const watchTargets = await resolveWatchTargets(pathsToScan);
  if (watchTargets.length === 0) {
    return;
  }

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 260,
      pollInterval: 80,
    },
  });

  const onFsChanged = (changedPath) => {
    const normalizedPath = typeof changedPath === 'string' ? path.resolve(changedPath) : '(unknown path)';
    scheduleLibraryChangedRefresh(normalizedPath);
  };

  watcher.on('add', onFsChanged);
  watcher.on('change', onFsChanged);
  watcher.on('unlink', onFsChanged);
  watcher.on('addDir', onFsChanged);
  watcher.on('unlinkDir', onFsChanged);
  watcher.on('error', (error) => {
    console.warn('[library-watcher] Watcher error:', error);
  });

  libraryWatcher = watcher;
}

async function createWindow() {
  const runtimeIconPath = resolveRuntimeIconPath();
  const restoredWindowState = getRestoredWindowState();
  const customFrameOptions =
    process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#101416',
            symbolColor: '#eef4f3',
            height: 40,
          },
        }
      : {};

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    ...(restoredWindowState ? restoredWindowState.bounds : {}),
    ...(runtimeIconPath ? { icon: runtimeIconPath } : {}),
    ...customFrameOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await loadRenderer(mainWindow);

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  if (restoredWindowState?.isMaximized) {
    mainWindow.maximize();
  }

  let altPressed = false;
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!mainWindow || process.platform === 'darwin') {
      return;
    }

    if (input.key !== 'Alt') {
      return;
    }

    if (input.type === 'keyDown') {
      altPressed = true;
      return;
    }

    if (input.type === 'keyUp' && altPressed) {
      altPressed = false;
      const nextVisible = !mainWindow.isMenuBarVisible();
      mainWindow.setMenuBarVisibility(nextVisible);
      mainWindow.setAutoHideMenuBar(!nextVisible);
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingPaths.length > 0) {
      mainWindow.webContents.send('app:open-paths', pendingPaths);
      pendingPaths = [];
    }
  });

  mainWindow.on('close', () => {
    if (!mainWindow) {
      return;
    }

    const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    writeWindowState({
      bounds,
      isMaximized: mainWindow.isMaximized(),
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function revealPaths(pathsToReveal) {
  if (!pathsToReveal.length) {
    return;
  }

  if (!mainWindow) {
    pendingPaths.push(...pathsToReveal);
    return;
  }

  mainWindow.webContents.send('app:open-paths', pathsToReveal);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

app.on('second-instance', async (_event, argv) => {
  const pathsFromLaunch = await filterExistingPaths(getLaunchPaths(argv, app.isPackaged));
  revealPaths(pathsFromLaunch);
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const runtimeIconPath = resolveRuntimeIconPath();
    if (runtimeIconPath) {
      app.dock.setIcon(runtimeIconPath);
    }
  }

  protocol.handle('audio-meta', async (request) => {
    try {
      const filePath = decodeURIComponent(request.url.replace('audio-meta://', ''));
      const response = await net.fetch(pathToFileURL(filePath).toString());
      return response;
    } catch (error) {
      console.error('[audio-meta protocol error]', error);
      return new Response('Audio file not found or cannot be accessed', { status: 404 });
    }
  });

  registerIpcHandler('dialog:open-audio-files', async () => {
    console.log('[backend-action] dialog:open-audio-files:start');
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac'] }],
    });

    console.log('[backend-action] dialog:open-audio-files:done', result.canceled ? 0 : result.filePaths.length);
    return result.canceled ? [] : result.filePaths;
  });

  registerIpcHandler('dialog:open-directory', async () => {
    console.log('[backend-action] dialog:open-directory:start');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    console.log('[backend-action] dialog:open-directory:done', result.canceled ? 0 : result.filePaths.length);
    return result.canceled ? [] : result.filePaths;
  });

  registerIpcHandler('library:load', async (_event, pathsToScan) => {
    validateLibraryLoadPayload(pathsToScan);
    console.log('[backend-action] library:load:start', Array.isArray(pathsToScan) ? pathsToScan.length : 0);
    const result = await buildLibrary(pathsToScan, (progress) => {
      try {
        _event.sender.send('library:progress', progress);
      } catch (error) {
        console.warn('[backend-action] library:load:progress-send-failed', error);
      }
    });
    await configureLibraryWatcher(pathsToScan);
    console.log('[backend-action] library:load:done', result.length);
    return result;
  });

  registerIpcHandler('metadata:save', async (_event, payload) => {
    validateMetadataSavePayload(payload);
    console.log('[backend-action] metadata:save:start', payload?.filePath);
    const result = await saveMetadataInWorker(payload.filePath, payload.metadata);
    console.log('[backend-action] metadata:save:done', result?.filePath || payload?.filePath);
    return {
      sourcePath: payload.filePath,
      filePath: result.filePath,
      metadata: result.metadata,
    };
  });

  registerIpcHandler('audio:export-clip', async (_event, payload) => {
    validateExportClipPayload(payload);
    console.log('[backend-action] audio:export-clip:start', payload?.filePath, payload?.startTime, payload?.endTime);
    const defaultPath = path.join(
      path.dirname(payload.filePath),
      `${path.basename(payload.filePath, path.extname(payload.filePath))}-clip${path.extname(payload.filePath)}`,
    );

    const result = await dialog.showSaveDialog({
      title: 'Export audio clip',
      defaultPath,
      filters: [{ name: 'Audio', extensions: [path.extname(payload.filePath).slice(1)] }],
    });

    if (result.canceled || !result.filePath) {
      console.log('[backend-action] audio:export-clip:cancelled');
      return null;
    }

    const exportedPath = await exportAudioSegment(
      payload.filePath,
      payload.startTime,
      payload.endTime,
      result.filePath,
    );
    console.log('[backend-action] audio:export-clip:done', exportedPath);
    return { outputPath: exportedPath };
  });

  registerIpcHandler('audio:edit-selection', async (_event, payload) => {
    validateEditSelectionPayload(payload);
    console.log(
      '[backend-action] audio:edit-selection:start',
      payload?.mode,
      payload?.filePath,
      payload?.startTime,
      payload?.endTime,
    );

    const suffix = payload.mode === 'cut' ? 'cut' : 'trim';
    const defaultPath = path.join(
      path.dirname(payload.filePath),
      `${path.basename(payload.filePath, path.extname(payload.filePath))}-${suffix}${path.extname(payload.filePath)}`,
    );

    const result = await dialog.showSaveDialog({
      title: payload.mode === 'cut' ? 'Save cut result' : 'Save trim result',
      defaultPath,
      filters: [{ name: 'Audio', extensions: [path.extname(payload.filePath).slice(1)] }],
    });

    if (result.canceled || !result.filePath) {
      console.log('[backend-action] audio:edit-selection:cancelled');
      return null;
    }

    const outputPath = await editAudioSelection(
      payload.filePath,
      payload.startTime,
      payload.endTime,
      payload.mode,
      result.filePath,
    );

    console.log('[backend-action] audio:edit-selection:done', outputPath);
    return { outputPath };
  });

  registerIpcHandler('audio:split-selection', async (_event, payload) => {
    validateSplitSelectionPayload(payload);
    console.log(
      '[backend-action] audio:split-selection:start',
      payload?.filePath,
      payload?.startTime,
      payload?.endTime,
      payload?.title,
    );

    const sourcePath = path.resolve(payload.filePath);
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension !== '.wav') {
      throw new Error('Split to new track currently supports WAV source files only.');
    }

    const safeTitle = payload.title.trim().replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ');
    if (!safeTitle) {
      throw new Error('A non-empty split track title is required.');
    }

    const targetDirectory = path.dirname(sourcePath);
    const outputCandidate = path.join(targetDirectory, `${safeTitle}${extension}`);
    const outputPath = await ensureUniquePath(outputCandidate);
    await exportAudioSegment(sourcePath, payload.startTime, payload.endTime, outputPath);

    const metadataResult = await saveMetadataInWorker(outputPath, {
      ...payload.metadata,
      title: safeTitle,
    });

    console.log('[backend-action] audio:split-selection:done', metadataResult.filePath);
    return { outputPath: metadataResult.filePath };
  });

  registerIpcHandler('audio:convert-format', async (_event, payload) => {
    validateConvertAudioPayload(payload);
    console.log('[backend-action] audio:convert-format:start', payload?.filePath, payload?.targetFormat);

    const sourcePath = path.resolve(payload.filePath);
    const sourceExtension = path.extname(sourcePath);
    const targetFormat = payload.targetFormat;
    const defaultPath = path.join(
      path.dirname(sourcePath),
      `${path.basename(sourcePath, sourceExtension)}.${targetFormat}`,
    );

    const result = await dialog.showSaveDialog({
      title: `Convert audio to ${targetFormat.toUpperCase()}`,
      defaultPath,
      filters: [{ name: 'Audio', extensions: [targetFormat] }],
    });

    if (result.canceled || !result.filePath) {
      console.log('[backend-action] audio:convert-format:cancelled');
      return null;
    }

    const outputPath = await convertAudioFormat(sourcePath, targetFormat, result.filePath);
    console.log('[backend-action] audio:convert-format:done', outputPath);
    return { outputPath };
  });

  registerIpcHandler('audio:load-blob', async (_event, filePath) => {
    validateLoadBlobPayload(filePath);
    console.log('[backend-action] audio:load-blob:start', filePath);
    try {
      const base64 = await readFileAsBase64WithLimit(filePath, MAX_AUDIO_BLOB_BYTES);
      console.log('[backend-action] audio:load-blob:done', filePath, base64.length);
      return base64;
    } catch (error) {
      console.error('Failed to load audio blob:', error);
      throw error;
    }
  });

  registerIpcHandler('audio:download-from-url', async (_event, payload) => {
    validateDownloadFromUrlPayload(payload);
    console.log('[backend-action] audio:download-from-url:start', payload?.url);
    if (!payload?.url || typeof payload.url !== 'string') {
      throw new Error('A valid URL is required.');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(payload.url.trim());
    } catch {
      throw new Error('Invalid URL format.');
    }

    const allowPrivateHosts = process.env.AUDIO_META_ALLOW_PRIVATE_DOWNLOADS === 'true';
    if (!isAllowedDownloadUrl(parsedUrl, { allowPrivateHosts })) {
      throw new Error(
        'URL is blocked by security policy. Only public HTTP(S) hosts are allowed by default. Set AUDIO_META_ALLOW_PRIVATE_DOWNLOADS=true to override for trusted networks.',
      );
    }

    const response = await net.fetch(parsedUrl.toString());
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}).`);
    }

    const contentType = response.headers.get('content-type') || '';
    const extension = extensionFromContentType(contentType) || getSupportedExtensionFromUrl(parsedUrl.toString());
    if (!extension) {
      throw new Error(
        'Only direct MP3/WAV file URLs are supported. Streaming platform page URLs are not downloadable here.',
      );
    }

    const defaultPath = path.join(app.getPath('downloads'), fileNameFromUrl(parsedUrl.toString(), extension));
    const saveResult = await dialog.showSaveDialog({
      title: 'Download audio from URL',
      defaultPath,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      console.log('[backend-action] audio:download-from-url:cancelled');
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(saveResult.filePath, Buffer.from(arrayBuffer));

    console.log('[backend-action] audio:download-from-url:done', saveResult.filePath);

    return { outputPath: saveResult.filePath };
  });

  registerIpcHandler('track:move-to-album', async (_event, payload) => {
    validateMoveTrackPayload(payload);
    console.log('[backend-action] track:move-to-album:start', payload?.filePath, '->', payload?.targetDirectory);
    const sourcePath = path.resolve(payload.filePath);
    const destinationDirectory = path.resolve(payload.targetDirectory);

    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error('Only files can be moved to album folders.');
    }

    await fs.mkdir(destinationDirectory, { recursive: true });

    const destinationPath = await ensureUniquePath(path.join(destinationDirectory, path.basename(sourcePath)));

    await moveFileWithFallback(sourcePath, destinationPath);

    console.log('[backend-action] track:move-to-album:done', sourcePath, '->', destinationPath);

    return {
      sourcePath,
      destinationPath,
    };
  });

  registerIpcHandler('track:open-file-location', async (_event, payload) => {
    validateOpenFileLocationPayload(payload);
    console.log('[backend-action] track:open-file-location:start', payload?.filePath);

    const resolvedPath = path.resolve(payload.filePath);
    const itemExists = fsSync.existsSync(resolvedPath);
    if (!itemExists) {
      throw new Error('The selected file no longer exists on disk.');
    }

    const shown = shell.showItemInFolder(resolvedPath);
    if (!shown) {
      const opened = await shell.openPath(path.dirname(resolvedPath));
      if (opened) {
        throw new Error('Unable to open file location in the system file manager.');
      }
    }

    console.log('[backend-action] track:open-file-location:done', resolvedPath);
    return { revealedPath: resolvedPath };
  });

  registerIpcHandler('cover:save-image', async (_event, payload) => {
    validateSaveCoverImagePayload(payload);
    console.log('[backend-action] cover:save-image:start');

    const parsed = parseDataUrl(payload.dataUrl);
    if (!parsed?.buffer || !parsed?.mimeType) {
      throw new Error('Invalid cover image data.');
    }

    const extension = extensionFromMimeType(parsed.mimeType);
    if (!extension) {
      throw new Error('Unsupported image format. Use PNG, JPEG, GIF, or WebP.');
    }

    const rawName = typeof payload.suggestedName === 'string' ? payload.suggestedName.trim() : '';
    const safeBaseName = (rawName || 'cover')
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const fileBaseName = safeBaseName || 'cover';
    const defaultPath = path.join(app.getPath('downloads'), `${fileBaseName}.${extension}`);

    const result = await dialog.showSaveDialog({
      title: 'Save cover image',
      defaultPath,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });

    if (result.canceled || !result.filePath) {
      console.log('[backend-action] cover:save-image:cancelled');
      return null;
    }

    const outputPath = result.filePath;
    await fs.writeFile(outputPath, parsed.buffer);
    console.log('[backend-action] cover:save-image:done', outputPath);
    return { outputPath };
  });

  createMenu();
  await createWindow();

  const launchPaths = await filterExistingPaths(getLaunchPaths(process.argv, app.isPackaged));
  if (launchPaths.length > 0) {
    pendingPaths = launchPaths;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void disposeLibraryWatcher();
  void disposeMetadataWorker();
});
