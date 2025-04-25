import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { parseArgs, styleText, type ParseArgsOptionDescriptor } from 'node:util'
import debug from 'debug'
import sharp from 'sharp'
import { filesize } from 'filesize'

const d = debug('image-compressor:main')

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const base = path.join(dirname, '..')

const ogArgs = process.argv.slice(2)

interface CLIOptions {
	[longOption: string]: ParseArgsOptionDescriptor & { help: string }
}

const options = {
	input: {
		type: 'string',
		short: 'i',
		default: path.join(base, 'input'),
		help: 'Input directory',
	},
	output: {
		type: 'string',
		short: 'o',
		default: path.join(base, 'output'),
		help: 'Output directory',
	},
	quality: {
		type: 'string',
		short: 'q',
		default: '50',
		help: 'Quality of the output image (1-100)',
	},
} satisfies CLIOptions

function help() {
	let out = `image-compressor [ARGS?] [...OPTS?]\n`

	out += `\nargs:
help
\tShow help.`

	out += `\n\noptions:`
	for (const [k, o] of Object.entries(options)) {
		out += `
--${k} (-${o.short}):
\t${o.help}.
\tDefault: ${o.default}\n`
	}

	return out
}

if (ogArgs[0] === 'help') {
	console.log(help())
	process.exit(0)
}

const args = parseArgs({
	options,
	args: ogArgs,
})

const opts = {
	input: path.resolve(args.values.input),
	ouput: path.resolve(args.values.output),
	quality: parseInt(args.values.quality, 10),
} as const

d('args: %O', args.values)
d('opts: %O', opts)

if (opts.quality < 1 || opts.quality > 100) {
	console.error(styleText('red', 'Quality must be between 1-100.'))
	process.exit(1)
}

if (!fs.existsSync(opts.input)) {
	console.error(styleText('red', `${opts.input} does not exist.`))
	process.exit(1)
}

// @ts-expect-error
async function* walk(dir: string) {
	for await (const d of await fs.promises.opendir(dir)) {
		const entry = path.join(dir, d.name)
		if (d.isDirectory()) yield* walk(entry)
		else if (d.isFile()) yield entry
	}
}

const OUTPUT_EXTENSION = 'avif'
const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
const supportedExtensions = new Set(SUPPORTED_EXTENSIONS)
type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

const files = [] as {
	id: string
	type: SupportedExtension
	path: string
	originalSize: number
	newSize?: number
	reduction?: number
	reductionPercent?: number
	formattedReduction?: string
}[]

for await (const p of walk(opts.input)) {
	const ext = path.extname(p).split('.').at(1)

	if (!ext) continue
	// if (!supportedExtensions.has(ext as never)) continue

	const stat = await fs.promises.stat(p)

	files.push({
		id: crypto.randomUUID(),
		type: ext as SupportedExtension,
		path: p,
		originalSize: stat.size,
	})
}

d('collected files: %O', files)

for (const f of files) {
	const b = debug('image-compressor:' + f.id)
	let outputPath = f.path.replace('input', 'output')
	const outputDir = path.dirname(outputPath)

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true })
	}

	// Copy the file as is, if not supported
	if (!supportedExtensions.has(f.type)) {
		b('unsuported file %s, copying as is', f.path)
		await fs.promises.copyFile(f.path, outputPath)
		continue
	}

	outputPath = outputPath.replace('.' + f.type, '.' + OUTPUT_EXTENSION)

	b('converting and compressing %s', f.path)
	const info = await new Promise<sharp.OutputInfo>((res, rej) => {
		sharp(f.path)
			.avif({ quality: opts.quality })
			.toFile(outputPath, (err, info) => {
				if (err) rej(err)
				else res(info)
			})
	})
	b('%s converted and compressed', f.path)

	const idx = files.findIndex((file) => file.id === f.id)!
	const el = files[idx]!

	const newSize = info.size
	const decrease = el.originalSize - newSize
	el.newSize = newSize
	el.reduction = decrease
	el.reductionPercent = Math.round((decrease / el.originalSize) * 100)
	el.formattedReduction = filesize(el.reduction)
}

console.table(files)
