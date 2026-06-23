import { build } from 'vite';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const target = process.argv[2] || 'chromium';

if (target !== 'chromium') {
  throw new Error(`Unsupported build target: ${target}`);
}

const distDir = path.join(rootDir, 'dist', target);
const srcDir = path.join(rootDir, 'src');

async function buildEntry(input, outputDir, format = 'es') {
  const bundleName = `UltimateMoocs${outputDir.replace(/[^a-z0-9]/gi, '')}`;
  await build({
    root: rootDir,
    logLevel: 'warn',
    build: {
      emptyOutDir: false,
      outDir: path.join(distDir, outputDir),
      lib: {
        entry: path.join(srcDir, input),
        formats: [format],
        name: bundleName,
        fileName: () => 'index.js',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
      sourcemap: true,
      target: 'es2022',
    },
  });
}

async function buildPageScript(input, outputDir, fileName) {
  await build({
    root: rootDir,
    logLevel: 'warn',
    build: {
      emptyOutDir: false,
      outDir: path.join(distDir, outputDir),
      lib: {
        entry: path.join(srcDir, input),
        formats: ['es'],
        fileName: () => fileName,
      },
      rollupOptions: {
        output: {
          entryFileNames: fileName,
        },
      },
      sourcemap: true,
      target: 'es2022',
    },
  });
}

async function copyManifest() {
  const source = path.join(srcDir, 'manifest', 'manifest.chromium.json');
  const manifest = JSON.parse(await readFile(source, 'utf8'));
  await writeFile(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function copyStaticFiles() {
  await mkdir(path.join(distDir, 'options'), { recursive: true });
  await mkdir(path.join(distDir, 'popup'), { recursive: true });
  await mkdir(path.join(distDir, 'icons'), { recursive: true });
  await mkdir(path.join(distDir, 'page'), { recursive: true });
  await mkdir(path.join(distDir, 'styles'), { recursive: true });

  await cp(
    path.join(srcDir, 'options', 'index.html'),
    path.join(distDir, 'options', 'index.html'),
  );
  await cp(
    path.join(srcDir, 'popup', 'index.html'),
    path.join(distDir, 'popup', 'index.html'),
  );
  await cp(
    path.join(srcDir, 'assets', 'icons', 'icon16.png'),
    path.join(distDir, 'icons', 'icon16.png'),
  );
  await cp(
    path.join(srcDir, 'assets', 'icons', 'icon32.png'),
    path.join(distDir, 'icons', 'icon32.png'),
  );
  await cp(
    path.join(srcDir, 'assets', 'icons', 'icon48.png'),
    path.join(distDir, 'icons', 'icon48.png'),
  );
  await cp(
    path.join(srcDir, 'assets', 'icons', 'icon128.png'),
    path.join(distDir, 'icons', 'icon128.png'),
  );
  await cp(
    path.join(srcDir, 'styles', 'content.css'),
    path.join(distDir, 'styles', 'content.css'),
  );
  await cp(
    path.join(srcDir, 'page', 'alert-hook.js'),
    path.join(distDir, 'page', 'alert-hook.js'),
  );
  await cp(
    path.join(srcDir, 'page', 'dev-alert.js'),
    path.join(distDir, 'page', 'dev-alert.js'),
  );
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyManifest();
await copyStaticFiles();
await buildEntry('background/index.js', 'background');
await buildEntry('ace/index.js', 'ace', 'iife');
await buildEntry('content/index.js', 'content', 'iife');
await buildEntry('slides/index.js', 'slides', 'iife');
await buildPageScript('options/options.js', 'options', 'options.js');
await buildPageScript('popup/popup.js', 'popup', 'popup.js');

console.log(`Built MOOCs Ultimate for ${target}: ${path.relative(rootDir, distDir)}`);
