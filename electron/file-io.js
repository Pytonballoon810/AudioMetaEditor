// Tests: tests/file-io.test.js

const fs = require('node:fs/promises');

function bytesToMegabytes(value) {
  return (value / (1024 * 1024)).toFixed(1);
}

async function readFileAsBase64WithLimit(filePath, maxBytes) {
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) {
    throw new Error(
      `Audio file is too large for in-memory waveform loading (${bytesToMegabytes(stats.size)} MB). ` +
        `Limit is ${bytesToMegabytes(maxBytes)} MB.`,
    );
  }

  const { createReadStream } = await import('node:fs');

  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;

    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      chunks.push(chunk);
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        stream.destroy(new Error(`Audio stream exceeded limit of ${bytesToMegabytes(maxBytes)} MB.`));
      }
    });

    stream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.toString('base64'));
    });

    stream.on('error', (error) => {
      reject(
        new Error(`Failed to stream audio file ${filePath}: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  });
}

module.exports = {
  bytesToMegabytes,
  readFileAsBase64WithLimit,
};
