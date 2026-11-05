import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = [JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name.split('/').at(-1)];
const temporary = await mkdtemp(join(tmpdir(), 'developer-pain-pack-'));
const checks = [];

function run(command, args, cwd, timeout = 120_000) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.slice(-2000)}`);
  return result.stdout;
}

try {
  const emptyConfig = join(temporary, 'empty.npmrc');
  const globalConfig = join(temporary, 'global.npmrc');
  await writeFile(emptyConfig, 'registry=https://registry.npmjs.org/\n');
  await writeFile(globalConfig, '');
  for (const project of projects) {
    try {
      const directory = root;
      const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], directory))[0];
      const files = packed.files.map(file => file.path);
      if (!files.includes('src/index.js') || !files.includes('README.md') || !files.includes('LICENSE')) throw new Error('Package is missing its public entrypoint or documentation');
      if (files.some(path => /(^|\/)(tests?|artifacts|node_modules|\.env|test-results)(\/|$)/.test(path))) throw new Error('Package includes local-only files');
      const consumer = join(temporary, project);
      await mkdir(consumer);
      await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig', emptyConfig, '--globalconfig', globalConfig, join(temporary, packed.filename)], consumer);
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      const exports = JSON.parse(run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(manifest.name)}); if (!Object.keys(m).length) throw new Error('No public exports'); console.log(JSON.stringify(Object.keys(m)));`], consumer));
      if (manifest.bin) {
        const binary = join(consumer, 'node_modules', '.bin', project);
        if (process.platform === 'win32') run(process.execPath, [binary, '--help'], consumer, 10_000);
        else run(binary, ['--help'], consumer, 10_000);
      }
      checks.push({ project, status: 'passed', files: files.length, compressedBytes: packed.size, exports, checks: ['packed allowlist', 'independent clean npm install', 'public API import', ...(manifest.bin ? ['installed CLI --help'] : [])] });
    } catch (error) {
      checks.push({ project, status: 'failed', reason: error.message });
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, checks }, null, 2)}\n`);
process.exitCode = checks.every(check => check.status === 'passed') ? 0 : 1;
