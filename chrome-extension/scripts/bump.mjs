#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'manifest.json');
const pkgPath = resolve(root, 'package.json');

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run bump <patch|minor|major|x.y.z>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (manifest.version !== pkg.version) {
  console.error(`❌ versions out of sync: manifest=${manifest.version} package=${pkg.version}`);
  console.error('   fix manually before bumping.');
  process.exit(1);
}

const current = manifest.version;
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`❌ current version is not semver: ${current}`);
  process.exit(1);
}

let next;
if (arg === 'patch') {
  next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
} else if (arg === 'minor') {
  next = `${parts[0]}.${parts[1] + 1}.0`;
} else if (arg === 'major') {
  next = `${parts[0] + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  console.error(`❌ invalid bump arg: ${arg} (expected patch|minor|major|x.y.z)`);
  process.exit(1);
}

manifest.version = next;
pkg.version = next;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`✅ bumped ${current} → ${next}`);

try {
  execSync('git rev-parse --is-inside-work-tree', { cwd: root, stdio: 'ignore' });
} catch {
  console.log('   (not in a git repo — skipping commit/tag)');
  process.exit(0);
}

const tag = `v${next}`;
const msg = `chore: bump version to ${tag}`;

execSync(`git commit manifest.json package.json -m ${JSON.stringify(msg)}`, {
  cwd: root,
  stdio: 'inherit',
});
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' });

console.log(`✅ committed + tagged ${tag}`);
console.log(`   push with: git push && git push ${tag}`);
console.log('   next:      npm run release');
