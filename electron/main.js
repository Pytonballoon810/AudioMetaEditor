const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, net, protocol, Menu } = require('electron');

const { buildLibrary, editAudioSelection, exportAudioSegment, saveMetadata } = require('./media-service');
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
  validateLoadBlobPayload,
  validateDownloadFromUrlPayload,
  validateMoveTrackPayload,
} = require('./ipc-validators');

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
const MAX_AUDIO_BLOB_BYTES = 80 * 1024 * 1024;

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
  try {
    await fs.rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error) || error.code !== 'EXDEV') {
      throw error;
    }
  }

  await fs.copyFile(sourcePath, destinationPath);
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

async function createWindow() {
  const runtimeIconPath = resolveRuntimeIconPath();

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    ...(runtimeIconPath ? { icon: runtimeIconPath } : {}),
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
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }],
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
    const result = await buildLibrary(pathsToScan);
    console.log('[backend-action] library:load:done', result.length);
    return result;
  });

  registerIpcHandler('metadata:save', async (_event, payload) => {
    validateMetadataSavePayload(payload);
    console.log('[backend-action] metadata:save:start', payload?.filePath);
    const metadata = await saveMetadata(payload.filePath, payload.metadata);
    console.log('[backend-action] metadata:save:done', payload?.filePath);
    return {
      filePath: payload.filePath,
      metadata,
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
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }],
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

    await fs.mkdir(destinationDirectory, { recursive: true });

    const destinationPath = await ensureUniquePath(path.join(destinationDirectory, path.basename(sourcePath)));

    await moveFileWithFallback(sourcePath, destinationPath);

    console.log('[backend-action] track:move-to-album:done', sourcePath, '->', destinationPath);

    return {
      sourcePath,
      destinationPath,
    };
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
