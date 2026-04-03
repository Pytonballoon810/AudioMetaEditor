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
  validateMoveTrackPayload,
  validateOpenFileLocationPayload,
  validateSaveCoverImagePayload,
};
