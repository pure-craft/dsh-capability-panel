/**
 * Dead-code scan: advisory report, not a CI gate.
 *
 * Two passes over src/:
 *
 *   1. Exported symbols never referenced anywhere else in src/ (their own
 *      file excluded). Each hit is reported with its test-side reference
 *      count — a symbol referenced ONLY by tests is the classic 100%-
 *      coverage-blind-spot: dead in production but kept alive by its own
 *      tests (that is how collectReplacements survived the surface rewrite).
 *
 *   2. Module-internal functions/const arrow functions never called, even
 *      within their own file.
 *
 * Known false-positive classes (read the report with these in mind):
 *   - `interface`/`type` exports used via `import type` in tests (type-only
 *     API surface is legitimately invisible to a runtime scan);
 *   - exports that are the package's public entry contract (`apply`,
 *     `inject`, wire/parse entry points called by the host loader);
 *   - test fixture fields documenting real log shapes.
 *
 * Exit code is always 0: this is a review aid, never a merge blocker.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const TESTS = 'tests';

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

const readAll = (files) => files.map((f) => [f, readFileSync(f, 'utf8')]);
const src = readAll(collect(SRC));
const tests = readAll(collect(TESTS));

const countUses = (name, texts, excludeFile) => {
  const pat = new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`, 'g');
  let n = 0;
  for (const [f, text] of texts) {
    if (f === excludeFile) continue;
    n += (text.match(pat) ?? []).length;
  }
  return n;
};

// Pass 1: exported symbols with zero references elsewhere in src.
const exported = [];
for (const [file, text] of src) {
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
    exported.push([file, m[1], /^export\s+(?:interface|type)/.test(m[0])]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(' as ').at(-1)?.trim();
      if (name) exported.push([file, name, false]);
    }
  }
}

const deadExports = [];
for (const [file, name, isType] of exported) {
  const ownUses = countUses(name, [[file, src.find(([f]) => f === file)[1]]], null) - 1; // minus the declaration itself
  const otherUses = countUses(name, src, file);
  if (otherUses > 0) continue;
  const testUses = countUses(name, tests, null);
  const tag = isType
    ? 'type-only'
    : ownUses > 0
      ? 'own-file only (could drop the export)'
      : testUses > 0
        ? `test-only (${testUses} refs) — the coverage-blind-spot smell`
        : 'unreferenced anywhere';
  deadExports.push({ file, name, tag });
}

// Pass 2: module-internal functions never called anywhere (own file included).
const deadInternals = [];
for (const [file, text] of src) {
  for (const m of text.matchAll(/^(?:async\s+)?function\s+([a-z_$][\w$]*)\s*\(/gm)) {
    const name = m[1];
    if (new RegExp(`export[^\\n]*\\b${name}\\b`).test(text)) continue;
    const calls = src.reduce((n, [, t]) => n + (t.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length, 0);
    if (calls <= 1) deadInternals.push([file, name]);
  }
  for (const m of text.matchAll(/^const\s+([a-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) {
    const name = m[1];
    if (new RegExp(`export[^\\n]*\\b${name}\\b`).test(text)) continue;
    const calls = src.reduce((n, [, t]) => n + (t.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length, 0);
    if (calls <= 1) deadInternals.push([file, name]);
  }
}

console.log('== Exported but unreferenced outside their own file ==');
if (deadExports.length === 0) console.log('  (none)');
for (const { file, name, tag } of deadExports) {
  console.log(`  ${file}: ${name}  [${tag}]`);
}
console.log('\n== Module-internal, never called ==');
if (deadInternals.length === 0) console.log('  (none)');
for (const [file, name] of deadInternals) console.log(`  ${file}: ${name}`);
console.log('\nAdvisory only: type-only exports and host-entry contracts are expected hits; "test-only" runtime code is the smell to act on.');
