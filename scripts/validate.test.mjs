import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const validator = fileURLToPath(new URL('./validate.mjs', import.meta.url))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'registry-validator-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Registry Test')
  mkdirSync(join(dir, 'plugins'))
  const manifest = Buffer.from(JSON.stringify({ id: 'example', version: '1.0.0' })).toString('base64')
  const pkg = gzipSync(Buffer.from(JSON.stringify({ format: 'omp-studio-plugin-package', version: 1, id: 'example', pluginVersion: '1.0.0', files: { 'plugin.json': manifest } })))
  const readme = Buffer.from('Example plugin')
  const entry = {
    id: 'example', name: 'Example', version: '1.0.0', description: 'Example', owner: 'alice',
    repository: 'https://github.com/alice/original',
    package: { url: 'https://github.com/alice/original/releases/download/v1/example.ompplugin', sha256: hash(pkg), size: pkg.length },
    readme: { url: 'https://github.com/alice/original/releases/download/v1/example.md', sha256: hash(readme), size: readme.length }
  }
  const save = (value) => writeFileSync(join(dir, 'plugins/example.json'), JSON.stringify(value, null, 2) + '\n')
  save(entry)
  git('add', '.')
  git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD')
  const preload = join(dir, 'fetch-mock.mjs')
  writeFileSync(preload, `globalThis.fetch = async (url) => new Response(Buffer.from(String(url).endsWith('.md') ? process.env.MOCK_README : process.env.MOCK_PACKAGE, 'base64'))\n`)
  const run = (next, author, mockReadme = readme) => {
    save(next)
    git('add', 'plugins/example.json')
    git('commit', '-qm', 'change')
    return spawnSync(process.execPath, ['--import', preload, validator], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_SHA: base, PR_AUTHOR: author, MOCK_PACKAGE: pkg.toString('base64'), MOCK_README: mockReadme.toString('base64') }
    })
  }
  return { entry, run }
}

function relocated(entry) {
  return {
    ...entry,
    repository: 'https://github.com/alice/new-repository',
    package: { ...entry.package, url: 'https://github.com/alice/new-repository/releases/download/v1/example.ompplugin' },
    readme: { ...entry.readme, url: 'https://github.com/alice/new-repository/releases/download/v1/example.md' }
  }
}

test('maintainer may relocate unchanged assets without a version bump', (t) => {
  const { entry, run } = fixture(t)
  const result = run(relocated(entry), 'wakhang')
  assert.equal(result.status, 0, result.stderr)
})

test('other authors cannot relocate assets without a version bump', (t) => {
  const { entry, run } = fixture(t)
  const result = run(relocated(entry), 'alice')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /version.*newer/i)
})

test('a changed hash cannot use the same-version relocation exception', (t) => {
  const { entry, run } = fixture(t)
  const next = relocated(entry)
  const changed = Buffer.from('Changed plugin')
  next.readme.sha256 = hash(changed)
  next.readme.size = changed.length
  const result = run(next, 'wakhang', changed)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /version.*newer/i)
})
