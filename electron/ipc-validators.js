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

module.exports = {
  validateLibraryLoadPayload,
  validateMetadataSavePayload,
  validateExportClipPayload,
  validateEditSelectionPayload,
  validateLoadBlobPayload,
  validateDownloadFromUrlPayload,
  validateMoveTrackPayload,
};
