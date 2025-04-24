import { fileURLToPath } from "node:url"
import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { filesize } from "filesize";

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const base = path.join(dirname, '..')
const input = path.join(base, 'input')
const output = path.join(base, 'output')

async function* walk(dir: string) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
  }
}

const OUTPUT_EXTENSION = 'avif'
const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'webp'] as const
const supportedExtensions = new Set(SUPPORTED_EXTENSIONS)
type SupportedExtension = typeof SUPPORTED_EXTENSIONS[number]

const files = [] as {
  type: SupportedExtension;
  path: string;
  originalSize: number;
  newSize?: number
  reduction?: number
  formattedReduction?: string
}[]

for await (const p of walk(input)) {
  const ext = path.extname(p).split('.').at(1)

  if (!ext) continue
  if (!supportedExtensions.has(ext as never)) continue

  const stat = await fs.promises.stat(p)

  files.push({
    type: ext as SupportedExtension,
    path: p,
    originalSize: stat.size,
  })
}

for (const f of files) {
  const outputPath = f.path.replace("input", "output").replace('.' + f.type, "." + OUTPUT_EXTENSION)
  const outputDir = path.dirname(outputPath)

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const info = await new Promise<sharp.OutputInfo>((res, rej) => {
    sharp(f.path).avif({ quality: 50 }).toFile(outputPath, (err, info) => {
      if (err) rej(err)
      else res(info)
    })
  })

  const newSize = info.size
  const index = files.findIndex((file) => file.path === f.path)!
  const el = files[index]!
  el.newSize = newSize
  el.reduction = el.originalSize - newSize
  el.formattedReduction = filesize(el.reduction)
}

console.log(files)


// console.log(base, input, output)
