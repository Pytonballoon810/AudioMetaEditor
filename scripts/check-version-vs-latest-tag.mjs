import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function normalizeTag(tag) {
  return tag.trim().replace(/^v(?=\d)/, '');
}

function readPackageVersion() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);
  const packagePath = path.resolve(currentDirPath, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return String(packageJson.version || '').trim();
}

function getLatestTag() {
  const output = execSync('git for-each-ref refs/tags --sort=-creatordate --format="%(refname:strip=2)"', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function fail(message) {
  console.error(`[version-check] ${message}`);
  process.exit(1);
}

const packageVersion = readPackageVersion();
if (!packageVersion) {
  fail('Unable to read a valid version from package.json.');
}

let latestTag;
try {
  latestTag = getLatestTag();
} catch (error) {
  fail(`Unable to read git tags. ${error instanceof Error ? error.message : String(error)}`);
}

if (!latestTag) {
  fail('No git tags were found. Create a release tag before running publish verification.');
}

const normalizedTag = normalizeTag(latestTag);
if (normalizedTag !== packageVersion) {
  fail(
    `package.json version (${packageVersion}) does not match latest git tag (${latestTag}). ` +
      `Update package.json or create a new matching tag (for example: v${packageVersion}).`,
  );
}

console.log(`[version-check] OK: package.json version ${packageVersion} matches latest git tag ${latestTag}.`);
