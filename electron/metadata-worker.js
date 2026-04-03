const { parentPort } = require('node:worker_threads');
const { saveMetadata } = require('./media-service');

if (!parentPort) {
  throw new Error('metadata-worker must be started as a worker thread.');
}

parentPort.on('message', async (message) => {
  const requestId = message?.requestId;
  const filePath = message?.filePath;
  const metadata = message?.metadata;

  if (typeof requestId !== 'number') {
    return;
  }

  try {
    const result = await saveMetadata(filePath, metadata);
    parentPort.postMessage({
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
