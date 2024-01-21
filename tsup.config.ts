import { defineConfig } from 'tsup'

export default defineConfig({
  outDir: './dist',
  clean: true,
  dts: true,
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.mjs',
  }),
  cjsInterop: true,
  entry: {
    index: './lib/yauzl-ts/inputProcessors.ts',
  },
  sourcemap: true,
  skipNodeModulesBundle: true,
  target: 'es2022',
  tsconfig: './tsconfig.build.json',
  keepNames: true,
  bundle: true,
})
