#!/usr/bin/env node
/**
 * Reproducible build for the T1 frontend.
 *
 * Compiles `packages/ui/src` and `apps/web/src` with the TypeScript compiler API
 * (typescript is pinned in the root devDependencies) into:
 *   - packages/ui/dist/*.js   ES modules for the shared UI library
 *   - apps/web/dist/*.js      ES modules for the dashboard app
 *   - apps/web/dist/app.js    copy of the compiled main.js (entry loaded by index.html)
 *
 * The browser-facing import specifier `../../../packages/ui/src/index.js` is
 * rewritten to `/packages/ui/dist/index.js` so the static server in
 * apps/web/dev-server.mjs can serve the compiled UI bundle from the repo root.
 *
 * `dist/` directories are gitignored; run through the tools container:
 *   docker compose run --rm tools corepack pnpm build:web
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const UI_SRC_DIR = path.join(repoRoot, 'packages', 'ui', 'src');
const UI_DIST_DIR = path.join(repoRoot, 'packages', 'ui', 'dist');
const WEB_SRC_DIR = path.join(repoRoot, 'apps', 'web', 'src');
const WEB_DIST_DIR = path.join(repoRoot, 'apps', 'web', 'dist');
const BUILD_DIR = path.join(repoRoot, '.runtime', 'build-web');

const UI_SOURCE_SPECIFIER = '../../../packages/ui/src/index.js';
const UI_BROWSER_SPECIFIER = '/packages/ui/dist/index.js';

function listSourceFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .sort()
    .map(name => path.join(dir, name));
}

function fail(message) {
  console.error(`build-web: ${message}`);
  process.exit(1);
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyJsFiles(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(fromDir).sort()) {
    if (!name.endsWith('.js')) continue;
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
    copied += 1;
  }
  return copied;
}

function formatDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || typeof diagnostic.start !== 'number') return message;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${path.relative(repoRoot, diagnostic.file.fileName)}:${line + 1}:${character + 1} ${message}`;
}

const uiSources = listSourceFiles(UI_SRC_DIR);
const webSources = listSourceFiles(WEB_SRC_DIR);
if (uiSources.length === 0) fail(`no TypeScript sources found in ${path.relative(repoRoot, UI_SRC_DIR)}`);
if (webSources.length === 0) fail(`no TypeScript sources found in ${path.relative(repoRoot, WEB_SRC_DIR)}`);

resetDir(BUILD_DIR);

const compilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  forceConsistentCasingInFileNames: true,
  types: ['node'],
  rootDir: repoRoot,
  outDir: BUILD_DIR,
  noEmit: false,
  declaration: false,
  sourceMap: false,
  newLine: ts.NewLineKind.LineFeed,
  pretty: false
};

const program = ts.createProgram({ rootNames: [...uiSources, ...webSources], options: compilerOptions });
const preEmitErrors = ts
  .getPreEmitDiagnostics(program)
  .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);

if (preEmitErrors.length > 0) {
  for (const diagnostic of preEmitErrors) console.error(`build-web: ${formatDiagnostic(diagnostic)}`);
  fail(`TypeScript reported ${preEmitErrors.length} error(s); dist was not written`);
}

const emitResult = program.emit();
if (emitResult.emitSkipped) fail('TypeScript emit was skipped');
const emitErrors = emitResult.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
if (emitErrors.length > 0) {
  for (const diagnostic of emitErrors) console.error(`build-web: ${formatDiagnostic(diagnostic)}`);
  fail(`TypeScript emit reported ${emitErrors.length} error(s)`);
}

const emittedUiDir = path.join(BUILD_DIR, 'packages', 'ui', 'src');
const emittedWebDir = path.join(BUILD_DIR, 'apps', 'web', 'src');
if (!fs.existsSync(emittedUiDir)) fail('UI emit directory is missing');
if (!fs.existsSync(emittedWebDir)) fail('web emit directory is missing');

resetDir(UI_DIST_DIR);
const uiFileCount = copyJsFiles(emittedUiDir, UI_DIST_DIR);

resetDir(WEB_DIST_DIR);
const webFileCount = copyJsFiles(emittedWebDir, WEB_DIST_DIR);

// Rewrite browser-facing UI import specifiers to the statically served dist path.
let rewrittenFiles = 0;
for (const name of fs.readdirSync(WEB_DIST_DIR).sort()) {
  if (!name.endsWith('.js')) continue;
  const filePath = path.join(WEB_DIST_DIR, name);
  const source = fs.readFileSync(filePath, 'utf8');
  if (!source.includes(UI_SOURCE_SPECIFIER)) continue;
  fs.writeFileSync(filePath, source.split(UI_SOURCE_SPECIFIER).join(UI_BROWSER_SPECIFIER), 'utf8');
  rewrittenFiles += 1;
}

for (const name of fs.readdirSync(WEB_DIST_DIR).sort()) {
  if (!name.endsWith('.js')) continue;
  const source = fs.readFileSync(path.join(WEB_DIST_DIR, name), 'utf8');
  if (source.includes('/packages/ui/src/')) {
    fail(`${name} still imports from packages/ui/src after rewrite`);
  }
}

const mainPath = path.join(WEB_DIST_DIR, 'main.js');
const appPath = path.join(WEB_DIST_DIR, 'app.js');
if (!fs.existsSync(mainPath)) fail('apps/web/dist/main.js was not emitted');
fs.copyFileSync(mainPath, appPath);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

console.log(
  `build-web: ok -> packages/ui/dist (${uiFileCount} files), apps/web/dist (${webFileCount} files, ` +
    `${rewrittenFiles} rewritten, app.js entry)`
);
