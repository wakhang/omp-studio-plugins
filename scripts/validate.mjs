import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { gunzipSync } from 'node:zlib'

const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const SHA = /^[0-9a-f]{64}$/
const PACKAGE_LIMIT = 20 * 1024 * 1024
const README_LIMIT = 256 * 1024
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const fail = (message) => { throw new Error(message) }
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

// SemVer precedence ignores build metadata and compares numeric identifiers numerically.
function compareVersions(left, right) {
  const a = VERSION.exec(left), b = VERSION.exec(right)
  const numeric = (x, y) => x.length === y.length ? (x === y ? 0 : x < y ? -1 : 1) : x.length < y.length ? -1 : 1
  for (let i = 1; i <= 3; i++) {
    const result = numeric(a[i], b[i])
    if (result) return result
  }
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : a[4] ? -1 : 1
  const ap = a[4].split('.'), bp = b[4].split('.')
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1
    if (ap[i] === bp[i]) continue
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i])
    if (an && bn) return numeric(ap[i], bp[i])
    if (an !== bn) return an ? -1 : 1
    return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}

function parse(text, label) {
  try { return JSON.parse(text) } catch (error) { fail(`${label}: invalid JSON: ${error.message}`) }
}
function entryShape(entry, filename) {
  if (!record(entry)) fail(`${filename}: expected an object`)
  if (typeof entry.id !== 'string' || !ID.test(entry.id) || filename !== `plugins/${entry.id}.json`) fail(`${filename}: id must match the filename`)
  if (typeof entry.owner !== 'string' || !OWNER.test(entry.owner)) fail(`${filename}: invalid GitHub owner`)
  if (typeof entry.version !== 'string' || entry.version.length > 40 || !VERSION.test(entry.version)) fail(`${filename}: invalid version`)
  if (typeof entry.name !== 'string' || !entry.name.trim()) fail(`${filename}: name is required`)
  if (entry.name.length > 100) fail(`${filename}: name exceeds 100 characters`)
  if (typeof entry.description !== 'string' || entry.description.length > 2000) fail(`${filename}: description must be a string of at most 2000 characters`)
  for (const [key, max] of [['author', 100], ['usage', 500], ['updatedAt', 100]]) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > max)) fail(`${filename}: invalid ${key}`)
  }
  if (entry.minAppVersion !== undefined && (typeof entry.minAppVersion !== 'string' || entry.minAppVersion.length > 40 || !VERSION.test(entry.minAppVersion))) fail(`${filename}: invalid minAppVersion`)
  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.length > 12 || entry.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 30))) fail(`${filename}: invalid tags`)
  for (const key of ['homepage', 'repository']) {
    if (entry[key] !== undefined) {
      let url
      try { url = new URL(entry[key]) } catch { fail(`${filename}: invalid ${key} URL`) }
      if (typeof entry[key] !== 'string' || url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail(`${filename}: invalid ${key} URL`)
    }
  }
}
// A maintainer may relocate unchanged release assets without publishing a new version.
// No metadata other than the source repository and asset URLs may change.
function sameVersionRelocation(old, next) {
  const normalize = (entry) => {
    const { repository, package: pkg, readme, ...rest } = entry
    const stripUrl = (ref) => {
      if (!record(ref)) return ref
      const { url, ...remaining } = ref
      return remaining
    }
    return { ...rest, package: stripUrl(pkg), readme: stripUrl(readme) }
  }
  return isDeepStrictEqual(normalize(old), normalize(next))
}

function releaseRef(ref, owner, label, max) {
  if (!record(ref)) fail(`${label}: expected a file reference`)
  if (!Number.isSafeInteger(ref.size) || ref.size < 1 || ref.size > max) fail(`${label}: size must be between 1 and ${max} bytes`)
  if (typeof ref.sha256 !== 'string' || !SHA.test(ref.sha256)) fail(`${label}: sha256 must be lowercase hex`)
  let url
  try { url = new URL(ref.url) } catch { fail(`${label}: invalid URL`) }
  const parts = url.pathname.split('/')
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
      parts.length !== 7 || parts[1].toLowerCase() !== owner.toLowerCase() || !parts[2] || parts[3] !== 'releases' || parts[4] !== 'download' || !parts[5] || !parts[6] || /%2f|%5c/i.test(url.pathname)) {
    fail(`${label}: URL must be a GitHub release asset owned by ${owner}`)
  }
}
async function download(ref, label) {
  const response = await fetch(ref.url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok || !response.body) fail(`${label}: download failed (HTTP ${response.status})`)
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > ref.size) { await response.body.cancel().catch(() => {}); fail(`${label}: download exceeds declared size`) }
    chunks.push(chunk)
  }
  if (size !== ref.size) fail(`${label}: size mismatch (declared ${ref.size}, received ${size})`)
  const bytes = Buffer.concat(chunks, size)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== ref.sha256) fail(`${label}: sha256 mismatch (received ${digest})`)
  return bytes
}
function validatePackage(data, entry, label) {
  let raw
  try { raw = parse(gunzipSync(data, { maxOutputLength: PACKAGE_LIMIT }).toString('utf8'), label) }
  catch (error) { fail(`${label}: invalid gzip package: ${error.message}`) }
  if (!record(raw) || raw.format !== 'omp-studio-plugin-package' || raw.version !== 1 || raw.id !== entry.id || raw.pluginVersion !== entry.version || !record(raw.files)) fail(`${label}: package format, id or version does not match registry entry`)
  const paths = Object.keys(raw.files)
  if (!paths.length || paths.length > 2000) fail(`${label}: invalid number of files`)
  const seen = new Set()
  for (const path of paths) {
    if (path.length > 400 || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[:*?"<>|\u0000-\u001f]/.test(path) || path.split('/').some((part) => !part || part.startsWith('.') || /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(part))) fail(`${label}: unsafe package path ${JSON.stringify(path)}`)
    if (seen.has(path.toLowerCase())) fail(`${label}: duplicate package path ${path}`)
    seen.add(path.toLowerCase())
    const encoded = raw.files[path]
    if (typeof encoded !== 'string' || Buffer.from(encoded, 'base64').toString('base64') !== encoded) fail(`${label}: invalid base64 for ${path}`)
  }
  if (!Object.hasOwn(raw.files, 'plugin.json')) fail(`${label}: missing plugin.json`)
  const manifest = parse(Buffer.from(raw.files['plugin.json'], 'base64').toString('utf8').replace(/^\uFEFF/, ''), `${label}/plugin.json`)
  if (!record(manifest) || manifest.id !== entry.id || manifest.version !== entry.version) fail(`${label}: plugin.json id or version does not match registry entry`)
}

async function main() {
  const base = process.env.BASE_SHA
  const author = process.env.PR_AUTHOR
  const versionChecks = []
  if (Boolean(base) !== Boolean(author)) fail('BASE_SHA and PR_AUTHOR must both be set for pull requests')
  if (base) {
    if (!/^[0-9a-f]{40}$/.test(base)) fail('invalid BASE_SHA')
    const changes = git('diff', '--no-renames', '--name-only', '-z', base, 'HEAD').split('\0').filter(Boolean)
    for (const file of changes) {
      if (!/^plugins\/[^/]+\.json$/.test(file)) {
        if (author.toLowerCase() !== 'wakhang') fail(`${file}: only plugins/*.json may be changed by external contributors`)
        continue
      }
      const exists = git('ls-tree', '--name-only', base, '--', file).trim() === file
      const old = exists ? parse(git('show', `${base}:${file}`), `${file} at base`) : undefined
      let current
      try { current = readFileSync(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
      const next = current === undefined ? undefined : parse(current, file)
      if (old) entryShape(old, file)
      if (next) entryShape(next, file)
      if (author.toLowerCase() !== 'wakhang') {
        if (old && !next) fail(`${file}: external contributors cannot delete registry entries`)
        if (old && old.owner.toLowerCase() !== author.toLowerCase()) fail(`${file}: only the existing owner ${old.owner} can change this entry`)
        if (next && next.owner.toLowerCase() !== author.toLowerCase()) fail(`${file}: owner must match pull request author ${author}`)
      }
      if (old && next) versionChecks.push({ file, old, next })
    }
  }
  const names = readdirSync('plugins').sort()
  for (const name of names) {
    const file = `plugins/${name}`
    if (!name.endsWith('.json') || !lstatSync(file).isFile()) fail(`${file}: only regular JSON files are allowed in plugins/`)
    const entry = parse(readFileSync(file, 'utf8'), file)
    entryShape(entry, file)
    releaseRef(entry.package, entry.owner, `${file} package`, PACKAGE_LIMIT)
    if (entry.readme !== undefined) releaseRef(entry.readme, entry.owner, `${file} readme`, README_LIMIT)
    validatePackage(await download(entry.package, `${file} package`), entry, `${file} package`)
    if (entry.readme !== undefined) await download(entry.readme, `${file} readme`)
    console.log(`Validated ${file} (${entry.version})`)
  }
  for (const { file, old, next } of versionChecks) {
    if (compareVersions(next.version, old.version) <= 0 &&
        !(author.toLowerCase() === 'wakhang' && next.version === old.version && sameVersionRelocation(old, next))) {
      fail(`${file}: version must be newer than base version ${old.version}`)
    }
  }
}
main().catch((error) => { console.error(`Validation failed: ${error.message}`); process.exitCode = 1 })
