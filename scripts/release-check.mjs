import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../src/shared/defaultSettings.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const ignoredFiles = new Set(['scripts/release-check.mjs']);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.yaml',
  '.yml',
]);
const forbiddenFilePatterns = [
  /^\.env(?:\.|$)/i,
  /\.(?:key|p12|pfx|pem)$/i,
];
const sensitiveContentPatterns = [
  ['OpenAI-style API key', new RegExp(`\\b${'s' + 'k'}-[A-Za-z0-9_-]{20,}\\b`, 'g')],
  ['Google API key', new RegExp(`\\b${'AI' + 'za'}[A-Za-z0-9_-]{20,}\\b`, 'g')],
  ['GitHub token', new RegExp(`\\b${'gh' + 'p'}_[A-Za-z0-9_]{20,}\\b`, 'g')],
  ['private key', new RegExp(`${'-'.repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${'-'.repeat(5)}`, 'g')],
  ['local home path', /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)/g],
];

async function collectFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = path.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

if (String(DEFAULT_SETTINGS.ai?.apiKey || '') !== '') {
  throw new Error('Default AI API key must be empty before release.');
}

const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(
  await readFile(path.join(rootDir, 'src/manifest/manifest.chromium.json'), 'utf8'),
);
if (packageJson.version !== manifest.version_name) {
  throw new Error('package.json version and manifest version_name must match.');
}

const files = await collectFiles(rootDir);
const findings = [];

for (const relativePath of files) {
  const baseName = path.basename(relativePath);
  if (forbiddenFilePatterns.some((pattern) => pattern.test(baseName))) {
    findings.push(`${relativePath}: sensitive filename`);
  }
  if (ignoredFiles.has(relativePath) || !textExtensions.has(path.extname(relativePath))) continue;
  const content = await readFile(path.join(rootDir, relativePath), 'utf8');
  for (const [label, pattern] of sensitiveContentPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${relativePath}: ${label}`);
  }
}

if (findings.length > 0) {
  throw new Error(`Release safety check failed:\n- ${findings.join('\n- ')}`);
}

runNodeScript('scripts/check.mjs');
runNodeScript('scripts/build-extension.mjs');

console.log('Release check passed: no embedded secrets or personal paths were detected.');
