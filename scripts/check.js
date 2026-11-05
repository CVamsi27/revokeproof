import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
let checked = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'artifacts', '.git', 'test-results'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', timeout: 10_000 });
      checked++;
      if (result.error || result.status !== 0) {
        failed = true;
        process.stderr.write(`${path}: ${result.error?.message ?? result.stderr}\n`);
      }
    }
  }
}
await visit(root);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
process.stdout.write(`Syntax checked ${checked} JavaScript files.\n`);
if (!failed && manifest.types) {
  const types = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'scripts/type-consumer.ts'], { cwd: root, stdio: 'inherit', timeout: 30_000 });
  failed = Boolean(types.error) || types.status !== 0;
}
if (!failed) {
  const tests = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit', timeout: 120_000 });
  failed = Boolean(tests.error) || tests.status !== 0;
}
process.exitCode = failed ? 1 : 0;
