const { contextBridge, ipcRenderer } = require('electron');

function fileNameFromPath(filePath) {
  if (!filePath) {
    return 'track';
  }

  const normalized = String(filePath).replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || 'track';
}

const apiLogListeners = new Set();

function emitApiLog(message, level = 'info') {
  const payload = {
    level,
    message,
    timestamp: Date.now(),
  };

  const logPrefix = level === 'error' ? '[audioMetaApi:error]' : '[audioMetaApi]';
  // Logs in renderer devtools console.
  console.log(logPrefix, message);

  apiLogListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error('[audioMetaApi] Failed to emit API log listener', error);
    }
  });
}

function describeAction(callName, phase, args, result, error) {
  if (callName === 'openAudioFiles') {
    if (phase === 'start') return 'Opening file picker so you can choose one or more MP3/WAV/FLAC files.';
    if (phase === 'done') return `File picker closed. Selected ${Array.isArray(result) ? result.length : 0} file(s).`;
  }

  if (callName === 'openDirectory') {
    if (phase === 'start') return 'Opening directory picker so you can scan a folder for supported audio files.';
    if (phase === 'done')
      return `Directory picker closed. Selected ${Array.isArray(result) ? result.length : 0} folder(s).`;
  }

  if (callName === 'loadLibrary') {
    const pathCount = Array.isArray(args?.[0]) ? args[0].length : 0;
    if (phase === 'start') return `Scanning ${pathCount} selected path(s) for supported audio files and metadata.`;
    if (phase === 'done') return `Library scan finished. Loaded ${Array.isArray(result) ? result.length : 0} track(s).`;
  }

  if (callName === 'saveMetadata') {
    const filePath = args?.[0]?.filePath;
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Writing metadata tags and cover art to ${name}.`;
    if (phase === 'done') return `Metadata update finished for ${name}.`;
  }

  if (callName === 'moveTrackToAlbum') {
    const filePath = args?.[0]?.filePath;
    const targetDirectory = args?.[0]?.targetDirectory;
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Moving ${name} to target folder ${targetDirectory || '(unknown)'}.`;
    if (phase === 'done') return `Track move completed for ${name}.`;
  }

  if (callName === 'openFileLocation') {
    const filePath = args?.[0]?.filePath;
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Opening file location for ${name} in your system file manager.`;
    if (phase === 'done') return `Opened file location for ${name}.`;
  }

  if (callName === 'saveCoverImage') {
    if (phase === 'start') return 'Opening save dialog for the current cover image.';
    if (phase === 'done') {
      return result ? `Cover image saved to ${result.outputPath}.` : 'Cover image save was cancelled by user.';
    }
  }

  if (callName === 'exportClip') {
    const filePath = args?.[0]?.filePath;
    const startTime = args?.[0]?.startTime;
    const endTime = args?.[0]?.endTime;
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Exporting selected clip range (${startTime}s to ${endTime}s) from ${name}.`;
    if (phase === 'done') return result ? 'Clip export completed successfully.' : 'Clip export was cancelled by user.';
  }

  if (callName === 'editSelection') {
    const filePath = args?.[0]?.filePath;
    const startTime = args?.[0]?.startTime;
    const endTime = args?.[0]?.endTime;
    const mode = args?.[0]?.mode;
    const name = fileNameFromPath(filePath);
    if (phase === 'start')
      return `${mode === 'cut' ? 'Cutting out' : 'Trimming'} selection (${startTime}s to ${endTime}s) from ${name}.`;
    if (phase === 'done')
      return result
        ? `${mode === 'cut' ? 'Cut' : 'Trim'} operation finished: ${result.outputPath}.`
        : `${mode === 'cut' ? 'Cut' : 'Trim'} operation was cancelled by user.`;
  }

  if (callName === 'convertAudio') {
    const filePath = args?.[0]?.filePath;
    const targetFormat = args?.[0]?.targetFormat;
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Converting ${name} to ${String(targetFormat || '').toUpperCase()}.`;
    if (phase === 'done')
      return result ? `Converted file saved to ${result.outputPath}.` : 'Audio conversion was cancelled by user.';
  }

  if (callName === 'downloadFromUrl') {
    if (phase === 'start') return 'Starting URL download. This supports direct MP3/WAV/FLAC file links only.';
    if (phase === 'done')
      return result ? `Download finished and saved to ${result.outputPath}.` : 'Download was cancelled by user.';
  }

  if (callName === 'loadAudioBlob') {
    const filePath = args?.[0];
    const name = fileNameFromPath(filePath);
    if (phase === 'start') return `Preparing ${name} for waveform playback (reading local audio bytes).`;
    if (phase === 'done') return `Waveform source is ready for ${name}.`;
  }

  if (phase === 'error') {
    return `Action ${callName} failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  return `${callName}:${phase}`;
}

async function invokeLogged(callName, channel, ...args) {
  emitApiLog(describeAction(callName, 'start', args));
  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    emitApiLog(describeAction(callName, 'done', args, result));
    return result;
  } catch (error) {
    emitApiLog(describeAction(callName, 'error', args, null, error), 'error');
    throw error;
  }
}

contextBridge.exposeInMainWorld('audioMetaApi', {
  openAudioFiles: () => invokeLogged('openAudioFiles', 'dialog:open-audio-files'),
  openDirectory: () => invokeLogged('openDirectory', 'dialog:open-directory'),
  loadLibrary: (paths) => invokeLogged('loadLibrary', 'library:load', paths),
  downloadFromUrl: (payload) => invokeLogged('downloadFromUrl', 'audio:download-from-url', payload),
  saveMetadata: (payload) => invokeLogged('saveMetadata', 'metadata:save', payload),
  moveTrackToAlbum: (payload) => invokeLogged('moveTrackToAlbum', 'track:move-to-album', payload),
  openFileLocation: (payload) => invokeLogged('openFileLocation', 'track:open-file-location', payload),
  saveCoverImage: (payload) => invokeLogged('saveCoverImage', 'cover:save-image', payload),
  exportClip: (payload) => invokeLogged('exportClip', 'audio:export-clip', payload),
  editSelection: (payload) => invokeLogged('editSelection', 'audio:edit-selection', payload),
  convertAudio: (payload) => invokeLogged('convertAudio', 'audio:convert-format', payload),
  loadAudioBlob: async (filePath) => {
    try {
      const base64 = await invokeLogged('loadAudioBlob', 'audio:load-blob', filePath);
      const extension = filePath.toLowerCase().split('.').pop();
      const mimeType = extension === 'mp3' ? 'audio/mpeg' : extension === 'flac' ? 'audio/flac' : 'audio/wav';
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return dataUrl;
    } catch (error) {
      emitApiLog(describeAction('loadAudioBlob', 'error', [filePath], null, error), 'error');
      throw error;
    }
  },
  onOpenPaths: (callback) => {
    const listener = (_event, paths) => callback(paths);
    ipcRenderer.on('app:open-paths', listener);
    return () => ipcRenderer.removeListener('app:open-paths', listener);
  },
  onApiLog: (callback) => {
    apiLogListeners.add(callback);
    return () => apiLogListeners.delete(callback);
  },
  onLibraryProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('library:progress', listener);
    return () => ipcRenderer.removeListener('library:progress', listener);
  },
  onLibraryChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.removeListener('library:changed', listener);
  },
  toMediaUrl: (filePath) => `audio-meta://${encodeURIComponent(filePath)}`,
});
