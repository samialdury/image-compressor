# `image-compressor`

Convert a directory of jpg/png/webp/avif files to webp/avif.

## Usage

```sh
$ image-compressor help

image-compressor [ARGS?] [...OPTS?]

args:
help:
        Show help.

options:
--input (-i):
        Input directory.
        Default: $PWD/input

--output (-o):
        Output directory.
        Default: $PWD/output

--quality (-q):
        Quality of the output image (1-100).
        Default: 50

--format (-f):
        Output format (webp, avif).
        Default: avif
```

## License

[MIT](LICENSE)
