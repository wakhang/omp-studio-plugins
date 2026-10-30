import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from('stVRWxg6iYuSNbjnrlWEuGS2EKw9CwrL1uOiMeHTWaA=', 'base64')]),
  format: 'der',
  type: 'spki'
})
const output = new URL('../dist/', import.meta.url)
const keyText = process.env.STORE_SIGNING_KEY
if (!keyText) throw new Error('STORE_SIGNING_KEY is required (Ed25519 PKCS8 PEM)')
const privateKey = createPrivateKey(keyText)
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('STORE_SIGNING_KEY must be an Ed25519 private key')

// Validation is run separately before this script; independently check all downloaded bytes.
const files = (await readdir(new URL('../plugins/', import.meta.url))).filter((name) => name.endsWith('.json')).sort()
const manifests = await Promise.all(files.map(async (name) => JSON.parse(await readFile(new URL(`../plugins/${name}`, import.meta.url), 'utf8'))))
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

async function mirror(ref, path) {
  const response = await fetch(ref.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${ref.url}`)
  const chunks = []
  let size = 0
  const hash = createHash('sha256')
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > ref.size) throw new Error(`Download exceeds declared size: ${ref.url}`)
    hash.update(chunk)
    chunks.push(chunk)
  }
  const sha256 = hash.digest('hex')
  if (size !== ref.size || sha256 !== ref.sha256) throw new Error(`Download size or sha256 mismatch: ${ref.url}`)
  const target = join(fileURLToPath(output), path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.concat(chunks, size))
  return { path, size, sha256 }
}

const plugins = []
for (const manifest of manifests.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
  const { id, name, version, description, author, homepage, repository, minAppVersion, tags, usage, updatedAt } = manifest
  const entry = { id, name, version, description, author, homepage, repository, minAppVersion, tags, usage, updatedAt }
  entry.package = await mirror(manifest.package, `packages/${id}/${version}.ompplugin`)
  if (manifest.readme) entry.readme = await mirror(manifest.readme, `readmes/${id}/${version}.md`)
  plugins.push(entry)
}
const bytes = Buffer.from(JSON.stringify({ format: 'omp-studio-plugin-store', version: 1, generatedAt: new Date().toISOString(), plugins }, null, 2) + '\n')
const signature = sign(null, bytes, privateKey)
await writeFile(new URL('index.json', output), bytes)
await writeFile(new URL('index.json.sig', output), signature.toString('base64') + '\n')
// Verify the actual files to be deployed, not a reserialized object.
const writtenBytes = await readFile(new URL('index.json', output))
const writtenSignature = Buffer.from((await readFile(new URL('index.json.sig', output), 'utf8')).trim(), 'base64')
if (writtenSignature.length !== 64 || !verify(null, writtenBytes, publicKey, writtenSignature)) throw new Error('Published index signature verification failed')
console.log(`Published ${plugins.length} plugins to ${fileURLToPath(output)}`)
