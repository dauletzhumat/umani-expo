#!/usr/bin/env node
/**
 * Architecture guard: src/domain is pure TypeScript (CLAUDE.md, "Code layout").
 * Files in src/domain may import only other files in src/domain. Test files may
 * also import the test runner, fast-check and supabase/fixtures.
 *
 * Plain JS (like reset-project.js) so it needs no @types/node. Runs before Jest
 * in `npm test`. Kept as a script because ECC's config-protection hook blocks
 * edits to eslint.config.js; a `no-restricted-imports` rule can replace it later.
 */
const fs = require('fs');
const path = require('path');

// Run via npm scripts, which always execute from the project root.
const ROOT = process.cwd();
const DOMAIN = path.join(ROOT, 'src', 'domain');
const FIXTURES = path.join(ROOT, 'supabase', 'fixtures');
const TEST_ONLY_PACKAGES = new Set(['@jest/globals', 'fast-check']);
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function listTs(dir) {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return listTs(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

function inside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function violation(file, spec) {
  const isTest = file.endsWith('.test.ts');
  if (isTest && TEST_ONLY_PACKAGES.has(spec)) return null;
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec);
    if (inside(target, DOMAIN)) return null;
    if (isTest && inside(target, FIXTURES)) return null;
    return `relative import leaves src/domain: ${spec}`;
  }
  if (spec.startsWith('@/domain/')) return null;
  return `non-domain import: ${spec}`;
}

if (!fs.existsSync(DOMAIN)) {
  console.error('check-domain-boundary: src/domain not found');
  process.exit(1);
}

const problems = [];
for (const file of listTs(DOMAIN)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    const v = violation(file, spec);
    if (v) problems.push(`${path.relative(ROOT, file)}: ${v}`);
  }
}

if (problems.length > 0) {
  console.error('src/domain boundary violations:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('check-domain-boundary: OK');
