# Benchmarks

Some benchmarks to compare our lib with other libraries.

## How to run

First, install the dependencies:

```bash
npm install
```

Then, generate some random data using:

```bash
npm run generate-data
```

Then, create the zip to be used during the benchmarks:

```bash
npm run create-zip
```

Finally, run the bench-* files:

```bash
node bench-yarnzip.mjs
node bench-yauzl-promise.mjs
node bench-yauzl.mjs
```
