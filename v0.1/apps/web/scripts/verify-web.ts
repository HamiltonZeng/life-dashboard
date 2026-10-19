#!/usr/bin/env -S node --import tsx
/**
 * Portable, dependency-free (beyond the pinned `tsx`) verification runner for
 * the DOM-less S0-B / S1 front-end logic suite in `apps/web/tests`.
 *
 * Unlike the earlier macOS-only Python + JavaScriptCore runner that this file
 * replaces, this runner executes in plain Node.js (and therefore inside the
 * Docker `tools` service):
 *
 *   cd v0.1
 *   docker compose run --rm tools corepack pnpm exec tsx apps/web/scripts/verify-web.ts
 *
 * It imports `runAllWebVerificationTests()` from the in-repo TypeScript suite,
 * prints a per-suite PASS/FAIL summary with assertion totals, writes the JSON
 * report to `.runtime/test-artifacts/stage2-web/s0b-s1-verification-report.json`
 * and exits non-zero if any suite fails.
 *
 * Honest scope note: this suite renders HTML strings and exercises the storage
 * / state helpers under Node. It does NOT drive a real browser, so it does not
 * prove visual layout, CSS rendering or real Cookie/session behaviour. A real
 * browser smoke must be run separately on the host (see README).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TestCaseResult } from '../tests/s0b-s1.test.js';
import { runAllWebVerificationTests } from '../tests/s0b-s1.test.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..', '..');
const artifactDir = join(repoRoot, '.runtime', 'test-artifacts', 'stage2-web');
const reportPath = join(artifactDir, 's0b-s1-verification-report.json');

function formatSummary(results: TestCaseResult[]): string {
  const passedCount = results.filter(result => result.passed).length;
  const totalAssertions = results.reduce((sum, result) => sum + result.assertions, 0);
  const lines: string[] = ['=== @life-dashboard/web S0-B & S1 Verification Summary ==='];
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    lines.push(`[${status}] ${result.id} (${result.category}) ${result.name} (${result.assertions} assertions)`);
    lines.push(`       -> ${result.details}`);
  }
  lines.push(
    `Total: ${passedCount}/${results.length} test suites passed (${totalAssertions} total assertions).`
  );
  lines.push(`Artifact saved to: ${reportPath}`);
  return lines.join('\n');
}

function writeReport(results: TestCaseResult[]): void {
  mkdirSync(artifactDir, { recursive: true });
  // Keep the same top-level shape (a JSON array of suite results) as the
  // previous runner so downstream readers can just read `.length`.
  writeFileSync(reportPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
}

async function main(): Promise<number> {
  let results: TestCaseResult[];
  try {
    results = await runAllWebVerificationTests();
  } catch (err) {
    console.error('verify-web: the test suite crashed before producing results.');
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    return 2;
  }

  writeReport(results);
  console.log(formatSummary(results));

  const passedCount = results.filter(result => result.passed).length;
  return passedCount === results.length && results.length > 0 ? 0 : 1;
}

main().then(
  exitCode => process.exit(exitCode),
  err => {
    console.error('verify-web: unexpected fatal error.');
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(2);
  }
);
