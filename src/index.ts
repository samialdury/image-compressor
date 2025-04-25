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

const INPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
const inputExtensions = new Set(INPUT_EXTENSIONS)
type InputExtension = (typeof INPUT_EXTENSIONS)[number]

const OUTPUT_EXTENSIONS = ['webp', 'avif'] as const
const outputExtensions = new Set(OUTPUT_EXTENSIONS)
type OutputExtension = (typeof OUTPUT_EXTENSIONS)[number]

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
	format: {
		type: 'string',
		short: 'f',
		default: 'avif',
		help: 'Output format',
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
	format: args.values.format.toLowerCase() as OutputExtension,
}

d('args: %O', args.values)
d('opts: %O', opts)

function validate() {
	const validationErrors: string[] = []

	if (!outputExtensions.has(opts.format)) {
		validationErrors.push(
			`Invalid format "${opts.format}". Must be one of [${OUTPUT_EXTENSIONS.join(', ')}].`,
		)
	}

	if (opts.quality < 1 || opts.quality > 100) {
		validationErrors.push(
			`Invalid quality "${opts.quality}". Must be between 1-100.`,
		)
	}

	if (!fs.existsSync(opts.input)) {
		validationErrors.push(`${opts.input} does not exist.`)
	}

	return validationErrors
}

const errs = validate()
if (errs.length) {
	console.error(styleText('red', errs.join('\n')))
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

const files = [] as {
	id: string
	type: InputExtension
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
		type: ext as InputExtension,
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
	if (!inputExtensions.has(f.type)) {
		b('unsuported file %s, copying as is', f.path)
		await fs.promises.copyFile(f.path, outputPath)
		continue
	}

	outputPath = outputPath.replace('.' + f.type, '.' + opts.format)

	b('converting and compressing %s', f.path)
	const info = await new Promise<sharp.OutputInfo>((res, rej) => {
		const builder = sharp(f.path)
		if (opts.format === 'avif') {
			builder.avif({ quality: opts.quality })
		} else if (opts.format === 'webp') {
			builder.webp({ quality: opts.quality })
		}
		builder.toFile(outputPath, (err, info) => {
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
