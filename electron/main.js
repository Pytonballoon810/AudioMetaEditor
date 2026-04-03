const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { spawn } = require('node:child_process');
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
  validateConfigureWebDownloadToolsPayload,
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
let pendingLibraryChanges = {
  added: new Set(),
  removed: new Set(),
  changed: new Set(),
};
let libraryWatcherReady = false;
let libraryWatcherSuppressUntil = 0;
let metadataWorker = null;
let metadataWorkerRequestSequence = 0;
const pendingMetadataWorkerRequests = new Map();
const MAX_AUDIO_BLOB_BYTES = 80 * 1024 * 1024;
const DEFAULT_WINDOW_WIDTH = 1520;
const DEFAULT_WINDOW_HEIGHT = 940;
const MIN_WINDOW_WIDTH = 1120;
const MIN_WINDOW_HEIGHT = 720;
const WINDOW_STATE_FILE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const LIBRARY_WATCHER_SUPPRESS_MS = 2200;
const YT_DLP_FALLBACK_DIR_PATH = path.join(app.getPath('userData'), 'dependencies', 'yt-dlp');

const YT_DLP_ASSET_BY_PLATFORM = {
  win32: { asset: 'yt-dlp.exe', fileName: 'yt-dlp.exe' },
  linux: { asset: 'yt-dlp', fileName: 'yt-dlp' },
  darwin: { asset: 'yt-dlp_macos', fileName: 'yt-dlp_macos' },
};

function isAudioFilePath(candidatePath) {
  const extension = path.extname(String(candidatePath || '')).toLowerCase();
  return extension === '.mp3' || extension === '.wav' || extension === '.flac';
}

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

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function sanitizeFileSystemSegment(value) {
  const noReserved = String(value || '').replace(/[<>:"/\\|?*]+/g, ' ');
  let cleaned = '';
  for (const char of noReserved) {
    const code = char.charCodeAt(0);
    if (code < 32) {
      continue;
    }

    cleaned += char;
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

function getManagedYtDlpDescriptor() {
  const descriptor = YT_DLP_ASSET_BY_PLATFORM[process.platform];
  if (!descriptor) {
    throw new Error(`yt-dlp is not supported on platform ${process.platform}.`);
  }

  return descriptor;
}

function getManagedYtDlpInstallDirectoryCandidates() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'audio-meta-editor-dependencies', 'yt-dlp'));
  }

  candidates.push(YT_DLP_FALLBACK_DIR_PATH);
  return Array.from(new Set(candidates));
}

function getExistingManagedYtDlpBinaryPath() {
  const descriptor = getManagedYtDlpDescriptor();
  for (const directoryPath of getManagedYtDlpInstallDirectoryCandidates()) {
    const candidatePath = path.join(directoryPath, descriptor.fileName);
    if (fsSync.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function resolveWritableManagedYtDlpInstallDirectory() {
  for (const directoryPath of getManagedYtDlpInstallDirectoryCandidates()) {
    try {
      await fs.mkdir(directoryPath, { recursive: true });
      const probePath = path.join(directoryPath, '.write-probe');
      await fs.writeFile(probePath, 'ok');
      await fs.rm(probePath, { force: true });
      return directoryPath;
    } catch {
      // Try next location.
    }
  }

  throw new Error('No writable directory is available for yt-dlp installation.');
}

async function ensureManagedYtDlpInstalled() {
  const descriptor = getManagedYtDlpDescriptor();
  const existingPath = getExistingManagedYtDlpBinaryPath();

  if (existingPath) {
    return existingPath;
  }

  const installDirectory = await resolveWritableManagedYtDlpInstallDirectory();
  const binaryPath = path.join(installDirectory, descriptor.fileName);

  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${descriptor.asset}`;
  const response = await net.fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp (${response.status} ${response.statusText || ''}).`.trim());
  }

  const binaryBytes = Buffer.from(await response.arrayBuffer());
  if (binaryBytes.byteLength === 0) {
    throw new Error('Downloaded yt-dlp binary is empty.');
  }

  const tempPath = `${binaryPath}.tmp`;
  await fs.writeFile(tempPath, binaryBytes);
  await fs.rename(tempPath, binaryPath);

  if (process.platform !== 'win32') {
    await fs.chmod(binaryPath, 0o755);
  }

  return binaryPath;
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

  pendingLibraryChanges = {
    added: new Set(),
    removed: new Set(),
    changed: new Set(),
  };
  libraryWatcherReady = false;
  libraryWatcherSuppressUntil = 0;

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

function scheduleLibraryChangedRefresh(eventName, changedPath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!libraryWatcherReady || Date.now() < libraryWatcherSuppressUntil) {
    return;
  }

  const normalizedPath = changedPath || '(unknown path)';

  if (eventName === 'add') {
    pendingLibraryChanges.added.add(normalizedPath);
    pendingLibraryChanges.removed.delete(normalizedPath);
    pendingLibraryChanges.changed.delete(normalizedPath);
  } else if (eventName === 'unlink') {
    pendingLibraryChanges.removed.add(normalizedPath);
    pendingLibraryChanges.added.delete(normalizedPath);
    pendingLibraryChanges.changed.delete(normalizedPath);
  } else if (!pendingLibraryChanges.added.has(normalizedPath) && !pendingLibraryChanges.removed.has(normalizedPath)) {
    pendingLibraryChanges.changed.add(normalizedPath);
  }

  if (libraryWatcherDebounceTimer) {
    clearTimeout(libraryWatcherDebounceTimer);
  }

  libraryWatcherDebounceTimer = setTimeout(() => {
    libraryWatcherDebounceTimer = null;

    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingLibraryChanges = {
        added: new Set(),
        removed: new Set(),
        changed: new Set(),
      };
      return;
    }

    const addedPaths = Array.from(pendingLibraryChanges.added);
    const removedPaths = Array.from(pendingLibraryChanges.removed);
    const changedPaths = Array.from(pendingLibraryChanges.changed);
    const changedPath = addedPaths[0] || removedPaths[0] || changedPaths[0] || '(unknown path)';

    mainWindow.webContents.send('library:changed', {
      changedPath,
      addedPaths,
      removedPaths,
      changedPaths,
      timestamp: Date.now(),
    });
    pendingLibraryChanges = {
      added: new Set(),
      removed: new Set(),
      changed: new Set(),
    };
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

  libraryWatcherReady = false;
  libraryWatcherSuppressUntil = Date.now() + LIBRARY_WATCHER_SUPPRESS_MS;

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 260,
      pollInterval: 80,
    },
  });

  const onFsChanged = (eventName, changedPath) => {
    const normalizedPath = typeof changedPath === 'string' ? path.resolve(changedPath) : '(unknown path)';
    if (!isAudioFilePath(normalizedPath)) {
      return;
    }

    scheduleLibraryChangedRefresh(eventName, normalizedPath);
  };

  watcher.on('ready', () => {
    libraryWatcherReady = true;
    libraryWatcherSuppressUntil = Date.now() + LIBRARY_WATCHER_SUPPRESS_MS;
  });
  watcher.on('add', (changedPath) => onFsChanged('add', changedPath));
  watcher.on('change', (changedPath) => onFsChanged('change', changedPath));
  watcher.on('unlink', (changedPath) => onFsChanged('unlink', changedPath));
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

  registerIpcHandler('library:load-incremental', async (_event, pathsToScan) => {
    validateLibraryLoadPayload(pathsToScan);
    console.log('[backend-action] library:load-incremental:start', Array.isArray(pathsToScan) ? pathsToScan.length : 0);
    const result = await buildLibrary(pathsToScan);
    console.log('[backend-action] library:load-incremental:done', result.length);
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

    if (payload.splitMode === 'slice' || payload.sliceFromOriginal === true) {
      const slicedOriginalTempPath = await ensureUniquePath(
        path.join(targetDirectory, `${path.basename(sourcePath, extension)}-slice-temp${extension}`),
      );

      try {
        await editAudioSelection(sourcePath, payload.startTime, payload.endTime, 'cut', slicedOriginalTempPath);
        await fs.copyFile(slicedOriginalTempPath, sourcePath);
      } finally {
        await fs.rm(slicedOriginalTempPath, { force: true });
      }
    }

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

  registerIpcHandler('settings:configure-web-download-tools', async (_event, payload) => {
    validateConfigureWebDownloadToolsPayload(payload);

    if (!payload.enabled) {
      return { enabled: false, installed: false, restartRequired: false };
    }

    const existingPath = getExistingManagedYtDlpBinaryPath();
    if (existingPath) {
      return { enabled: true, installed: false, restartRequired: false };
    }

    await ensureManagedYtDlpInstalled();
    return { enabled: true, installed: true, restartRequired: true };
  });

  registerIpcHandler('app:restart', async () => {
    if (!app.isPackaged) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await loadRenderer(mainWindow);
        mainWindow.focus();
      }

      return { restarting: false };
    }

    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 60);

    return { restarting: true };
  });

  registerIpcHandler('audio:download-from-url', async (_event, payload) => {
    validateDownloadFromUrlPayload(payload);
    console.log('[backend-action] audio:download-from-url:start', payload?.url);
    if (!payload?.url || typeof payload.url !== 'string') {
      throw new Error('A valid URL is required.');
    }

    const ytDlpPath = getExistingManagedYtDlpBinaryPath();
    if (!ytDlpPath) {
      throw new Error('Enable web downloads in Settings and save changes to install yt-dlp first.');
    }

    const downloadFormat = payload.downloadFormat || 'flac';

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

    const splitIntoChapters = payload.splitIntoChapters === true;
    const useVideoNameAsAlbum = payload.useVideoNameAsAlbum === true;

    const isExistingAlbumTarget = typeof payload.targetAlbumDirectory === 'string' && payload.targetAlbumDirectory.trim();
    let targetAlbumDirectory = '';
    if (isExistingAlbumTarget) {
      const rawTargetDirectory = payload.targetAlbumDirectory.trim();
      if (!path.isAbsolute(rawTargetDirectory)) {
        throw new Error('Download target directory must be an absolute path.');
      }

      targetAlbumDirectory = path.resolve(rawTargetDirectory);
    } else {
      const newAlbumNameRaw = typeof payload.newAlbumName === 'string' ? payload.newAlbumName.trim() : '';
      const newAlbumParentDirectory =
        typeof payload.newAlbumParentDirectory === 'string' ? payload.newAlbumParentDirectory.trim() : '';
      if (!newAlbumParentDirectory || (!newAlbumNameRaw && !useVideoNameAsAlbum)) {
        throw new Error('A valid album destination is required.');
      }

      if (!path.isAbsolute(newAlbumParentDirectory)) {
        throw new Error('New album parent directory must be an absolute path.');
      }

      if (useVideoNameAsAlbum) {
        targetAlbumDirectory = path.resolve(newAlbumParentDirectory);
      } else {
        const sanitizedAlbumFolderName = sanitizeFileSystemSegment(newAlbumNameRaw);

        if (!sanitizedAlbumFolderName) {
          throw new Error('New album name is invalid after sanitization.');
        }

        targetAlbumDirectory = path.resolve(newAlbumParentDirectory, sanitizedAlbumFolderName);
      }
    }

    await fs.mkdir(targetAlbumDirectory, { recursive: true });

    const outputTemplate = '%(title)s.%(ext)s';
    const chapterOutputTemplate = useVideoNameAsAlbum
      ? '%(title)s/%(section_title)s.%(ext)s'
      : '%(section_title)s.%(ext)s';
    const expectedExtension = `.${downloadFormat.toLowerCase()}`;
    const commandStartedAt = Date.now();
    const normalizePathForComparison = (candidatePath) => {
      const normalized = path.resolve(candidatePath).replace(/\\/g, '/').replace(/\/+$/g, '');
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    const isPathWithinDirectory = (candidatePath, directoryPath) => {
      const normalizedCandidate = normalizePathForComparison(candidatePath);
      const normalizedDirectory = normalizePathForComparison(directoryPath);
      return normalizedCandidate === normalizedDirectory || normalizedCandidate.startsWith(`${normalizedDirectory}/`);
    };
    let splitFullLengthTempDirectory = null;

    if (splitIntoChapters) {
      splitFullLengthTempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ame-yt-split-'));
    }

    try {
      const commandArgs = [
        '--no-playlist',
        '--format',
        'bestaudio/best',
        '--extract-audio',
        '--audio-format',
        downloadFormat,
        '--no-keep-video',
        '--no-progress',
        '--no-warnings',
        '--print',
        'after_move:filepath',
      ];

      if (splitIntoChapters) {
        commandArgs.push('--split-chapters');
        commandArgs.push('--output', `chapter:${path.join(targetAlbumDirectory, chapterOutputTemplate)}`);
      }

      commandArgs.push(
        '--output',
        splitIntoChapters
          ? path.join(splitFullLengthTempDirectory, outputTemplate)
          : path.join(targetAlbumDirectory, outputTemplate),
        parsedUrl.toString(),
      );

      const { stdout } = await runCommandCapture(ytDlpPath, commandArgs);

      const printedLines = stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
      const existingPrintedPaths = printedLines.filter((line) => fsSync.existsSync(line));
      const discoveredPaths = [];

      for (const candidatePath of existingPrintedPaths) {
        if (!discoveredPaths.includes(candidatePath)) {
          discoveredPaths.push(candidatePath);
        }
      }

      const collectRecentFiles = async (rootDirectory) => {
        const stack = [rootDirectory];
        const files = [];

        while (stack.length > 0) {
          const nextDirectory = stack.pop();
          const entries = await fs.readdir(nextDirectory, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(nextDirectory, entry.name);
            if (entry.isDirectory()) {
              stack.push(fullPath);
            } else if (entry.isFile()) {
              files.push(fullPath);
            }
          }
        }

        return files;
      };

      const expectedDiscoveredPaths = discoveredPaths.filter(
        (candidatePath) => path.extname(candidatePath).toLowerCase() === expectedExtension,
      );

      if (expectedDiscoveredPaths.length === 0) {
        const candidatePaths = await collectRecentFiles(targetAlbumDirectory);
        const candidateStats = await Promise.all(
          candidatePaths
            .filter((candidatePath) => path.extname(candidatePath).toLowerCase() === expectedExtension)
            .map(async (candidatePath) => ({
              candidatePath,
              stats: await fs.stat(candidatePath),
            })),
        );

        const recentFileCandidates = candidateStats
          .filter((candidate) => candidate.stats.isFile() && candidate.stats.mtimeMs >= commandStartedAt - 5000)
          .sort((left, right) =>
            splitIntoChapters ? left.stats.mtimeMs - right.stats.mtimeMs : right.stats.mtimeMs - left.stats.mtimeMs,
          )
          .map((candidate) => candidate.candidatePath);

        for (const candidatePath of recentFileCandidates) {
          if (!expectedDiscoveredPaths.includes(candidatePath)) {
            expectedDiscoveredPaths.push(candidatePath);
          }
        }
      }

      if (expectedDiscoveredPaths.length === 0 && discoveredPaths.length > 0) {
        const discoveredExtensions = Array.from(
          new Set(discoveredPaths.map((candidatePath) => path.extname(candidatePath).toLowerCase())),
        ).join(', ');
        throw new Error(
          `Downloaded files did not match the selected ${downloadFormat.toUpperCase()} format. Found: ${discoveredExtensions || 'unknown'}. Ensure ffmpeg is installed and available for yt-dlp post-processing.`,
        );
      }

      let resolvedOutputPaths = [...expectedDiscoveredPaths];

      if (splitIntoChapters) {
        resolvedOutputPaths = resolvedOutputPaths.filter((candidatePath) => isPathWithinDirectory(candidatePath, targetAlbumDirectory));

        if (resolvedOutputPaths.length === 0) {
          const candidatePaths = await collectRecentFiles(targetAlbumDirectory);
          const candidateStats = await Promise.all(
            candidatePaths
              .filter((candidatePath) => path.extname(candidatePath).toLowerCase() === expectedExtension)
              .map(async (candidatePath) => ({
                candidatePath,
                stats: await fs.stat(candidatePath),
              })),
          );

          resolvedOutputPaths = candidateStats
            .filter((candidate) => candidate.stats.isFile() && candidate.stats.mtimeMs >= commandStartedAt - 5000)
            .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs)
            .map((candidate) => candidate.candidatePath);
        }
      }

      if (splitIntoChapters && resolvedOutputPaths.length > 0) {
        try {
          const toPathKey = (candidatePath) => normalizePathForComparison(candidatePath);
          const chapterOrderByPath = new Map(
            resolvedOutputPaths.map((candidatePath, index) => [toPathKey(candidatePath), index + 1]),
          );
          const downloadedPathKeys = new Set(Array.from(chapterOrderByPath.keys()));
          const albumItems = await buildLibrary([targetAlbumDirectory]);
          const downloadedMetadataByPath = new Map(
            albumItems
              .filter((item) => downloadedPathKeys.has(toPathKey(item.path)) && item.isMetadataLoaded)
              .map((item) => [toPathKey(item.path), item.metadata]),
          );

          const renumberedOutputPaths = [];
          for (const outputCandidatePath of resolvedOutputPaths) {
            const outputPathKey = toPathKey(outputCandidatePath);
            const chapterTrackNumber = chapterOrderByPath.get(outputPathKey);
            const currentMetadata = downloadedMetadataByPath.get(outputPathKey);
            if (!chapterTrackNumber || !currentMetadata) {
              renumberedOutputPaths.push(outputCandidatePath);
              continue;
            }

            const saveResult = await saveMetadataInWorker(outputCandidatePath, {
              ...currentMetadata,
              track: String(chapterTrackNumber),
            });
            renumberedOutputPaths.push(saveResult.filePath);
          }

          resolvedOutputPaths = renumberedOutputPaths;
        } catch (trackNumberApplyError) {
          console.warn('[backend-action] audio:download-from-url:chapter-track-number-apply-failed', trackNumberApplyError);
        }
      }

      if (isExistingAlbumTarget && resolvedOutputPaths.length > 0) {
        try {
          const toPathKey = (candidatePath) => normalizePathForComparison(candidatePath);
          const downloadedPathKeys = new Set(resolvedOutputPaths.map((candidatePath) => toPathKey(candidatePath)));
          const albumItems = await buildLibrary([targetAlbumDirectory]);
          const sourceAlbumItems = albumItems.filter(
            (item) => item.isMetadataLoaded && !downloadedPathKeys.has(toPathKey(item.path)),
          );

          if (sourceAlbumItems.length > 0) {
            const pickInheritedValue = (fieldName) => {
              for (const item of sourceAlbumItems) {
                const value = item?.metadata?.[fieldName];
                if (typeof value === 'string' && value.trim()) {
                  return value;
                }
              }

              return '';
            };

            const inheritedCoverArt =
              sourceAlbumItems.find((item) => typeof item.metadata.coverArt === 'string' && item.metadata.coverArt.trim())
                ?.metadata.coverArt || null;

            const inheritedAlbumMetadata = {
              album: pickInheritedValue('album'),
              artist: pickInheritedValue('artist'),
              albumArtist: pickInheritedValue('albumArtist'),
              composer: pickInheritedValue('composer'),
              producer: pickInheritedValue('producer'),
              genre: pickInheritedValue('genre'),
              year: pickInheritedValue('year'),
              comment: pickInheritedValue('comment'),
              coverArt: inheritedCoverArt,
            };

            const downloadedMetadataByPath = new Map(
              albumItems
                .filter((item) => downloadedPathKeys.has(toPathKey(item.path)) && item.isMetadataLoaded)
                .map((item) => [toPathKey(item.path), item.metadata]),
            );
            const nextOutputPaths = [];

            for (const outputCandidatePath of resolvedOutputPaths) {
              const outputPathKey = toPathKey(outputCandidatePath);
              const currentMetadata = downloadedMetadataByPath.get(outputPathKey);
              if (!currentMetadata) {
                nextOutputPaths.push(outputCandidatePath);
                continue;
              }

              const extension = path.extname(outputCandidatePath).toLowerCase();
              const supportsCoverWrite = extension === '.mp3';
              const nextMetadata = {
                ...currentMetadata,
                album: inheritedAlbumMetadata.album || currentMetadata.album,
                artist: inheritedAlbumMetadata.artist || currentMetadata.artist,
                albumArtist: inheritedAlbumMetadata.albumArtist || currentMetadata.albumArtist,
                composer: inheritedAlbumMetadata.composer || currentMetadata.composer,
                producer: inheritedAlbumMetadata.producer || currentMetadata.producer,
                genre: inheritedAlbumMetadata.genre || currentMetadata.genre,
                year: inheritedAlbumMetadata.year || currentMetadata.year,
                comment: inheritedAlbumMetadata.comment || currentMetadata.comment,
                coverArt: supportsCoverWrite
                  ? inheritedAlbumMetadata.coverArt || currentMetadata.coverArt
                  : currentMetadata.coverArt,
              };

              const saveResult = await saveMetadataInWorker(outputCandidatePath, nextMetadata);
              nextOutputPaths.push(saveResult.filePath);
            }

            resolvedOutputPaths = nextOutputPaths;
          }
        } catch (metadataApplyError) {
          console.warn('[backend-action] audio:download-from-url:album-metadata-apply-failed', metadataApplyError);
        }
      }

      const outputPath = resolvedOutputPaths[0] || '';

      if (!fsSync.existsSync(outputPath)) {
        throw new Error('yt-dlp finished but no output file was found at the expected location.');
      }

      console.log('[backend-action] audio:download-from-url:done', outputPath, resolvedOutputPaths.length);
      return {
        outputPath,
        outputPaths: resolvedOutputPaths,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error('yt-dlp executable is missing. Re-enable web downloads in Settings to reinstall it.');
      }

      throw error;
    } finally {
      if (splitFullLengthTempDirectory) {
        await fs.rm(splitFullLengthTempDirectory, { recursive: true, force: true });
      }
    }
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

  registerIpcHandler('track:duplicate', async (_event, payload) => {
    validateOpenFileLocationPayload(payload);
    console.log('[backend-action] track:duplicate:start', payload?.filePath);

    const sourcePath = path.resolve(payload.filePath);
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error('Only files can be duplicated.');
    }

    const extension = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, extension);
    const destinationCandidate = path.join(path.dirname(sourcePath), `${baseName} (Copy)${extension}`);
    const destinationPath = await ensureUniquePath(destinationCandidate);

    await fs.copyFile(sourcePath, destinationPath);

    console.log('[backend-action] track:duplicate:done', sourcePath, '->', destinationPath);
    return {
      sourcePath,
      destinationPath,
    };
  });

  registerIpcHandler('track:delete', async (_event, payload) => {
    validateOpenFileLocationPayload(payload);
    console.log('[backend-action] track:delete:start', payload?.filePath);

    const sourcePath = path.resolve(payload.filePath);
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error('Only files can be deleted.');
    }

    await fs.rm(sourcePath);

    console.log('[backend-action] track:delete:done', sourcePath);
    return { sourcePath };
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
