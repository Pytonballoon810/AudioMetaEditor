// Tests: tests/ipc-validators.test.js

function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}

function assertNumber(value, fieldName) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
}

function assertArrayOfStrings(value, fieldName) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }
}

function validateLibraryLoadPayload(pathsToScan) {
  assertArrayOfStrings(pathsToScan, 'pathsToScan');
}

function validateMetadataSavePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.filePath, 'payload.filePath');

  if (!payload.metadata || typeof payload.metadata !== 'object') {
    throw new Error('payload.metadata must be an object.');
  }
}

function validateExportClipPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.filePath, 'payload.filePath');
  assertNumber(payload.startTime, 'payload.startTime');
  assertNumber(payload.endTime, 'payload.endTime');

  if (payload.endTime <= payload.startTime) {
    throw new Error('payload.endTime must be greater than payload.startTime.');
  }
}

function validateEditSelectionPayload(payload) {
  validateExportClipPayload(payload);

  if (payload.mode !== 'trim' && payload.mode !== 'cut') {
    throw new Error("payload.mode must be either 'trim' or 'cut'.");
  }
}

function validateSplitSelectionPayload(payload) {
  validateExportClipPayload(payload);

  assertString(payload.title, 'payload.title');

  if (payload.splitMode !== 'keep' && payload.splitMode !== 'slice') {
    throw new Error("payload.splitMode must be either 'keep' or 'slice'.");
  }

  if (payload.sliceFromOriginal !== undefined && typeof payload.sliceFromOriginal !== 'boolean') {
    throw new Error('payload.sliceFromOriginal must be a boolean when provided.');
  }

  if (!payload.metadata || typeof payload.metadata !== 'object') {
    throw new Error('payload.metadata must be an object.');
  }
}

function validateConvertAudioPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.filePath, 'payload.filePath');

  if (payload.targetFormat !== 'mp3' && payload.targetFormat !== 'flac') {
    throw new Error("payload.targetFormat must be either 'mp3' or 'flac'.");
  }
}

function validateLoadBlobPayload(filePath) {
  assertString(filePath, 'filePath');
}

function validateDownloadFromUrlPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.url, 'payload.url');

  if (payload.targetAlbumDirectory !== undefined) {
    assertString(payload.targetAlbumDirectory, 'payload.targetAlbumDirectory');
  }

  if (payload.newAlbumName !== undefined) {
    assertString(payload.newAlbumName, 'payload.newAlbumName');
  }

  if (payload.newAlbumParentDirectory !== undefined) {
    assertString(payload.newAlbumParentDirectory, 'payload.newAlbumParentDirectory');
  }

  if (payload.splitIntoChapters !== undefined && typeof payload.splitIntoChapters !== 'boolean') {
    throw new Error('payload.splitIntoChapters must be a boolean when provided.');
  }

  if (
    payload.downloadFormat !== undefined &&
    payload.downloadFormat !== 'flac' &&
    payload.downloadFormat !== 'mp3' &&
    payload.downloadFormat !== 'wav' &&
    payload.downloadFormat !== 'm4a'
  ) {
    throw new Error("payload.downloadFormat must be one of 'flac', 'mp3', 'wav', or 'm4a' when provided.");
  }

  const hasExistingTarget = typeof payload.targetAlbumDirectory === 'string';
  const hasNewAlbumTarget = typeof payload.newAlbumName === 'string';

  if (hasExistingTarget === hasNewAlbumTarget) {
    throw new Error('payload must include exactly one destination target.');
  }

  if (hasNewAlbumTarget && typeof payload.newAlbumParentDirectory !== 'string') {
    throw new Error('payload.newAlbumParentDirectory is required when payload.newAlbumName is provided.');
  }
}

function validateConfigureWebDownloadToolsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  if (typeof payload.enabled !== 'boolean') {
    throw new Error('payload.enabled must be a boolean.');
  }

  if (payload.acceptedWarning !== undefined && typeof payload.acceptedWarning !== 'boolean') {
    throw new Error('payload.acceptedWarning must be a boolean when provided.');
  }

  if (payload.enabled && payload.acceptedWarning !== true) {
    throw new Error('payload.acceptedWarning must be true when enabling web downloads.');
  }
}

function validateMoveTrackPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.filePath, 'payload.filePath');
  assertString(payload.targetDirectory, 'payload.targetDirectory');
}

function validateOpenFileLocationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.filePath, 'payload.filePath');
}

function validateSaveCoverImagePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object.');
  }

  assertString(payload.dataUrl, 'payload.dataUrl');

  if (payload.suggestedName !== undefined && typeof payload.suggestedName !== 'string') {
    throw new Error('payload.suggestedName must be a string when provided.');
  }
}

module.exports = {
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
};
