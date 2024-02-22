import { join, resolve } from 'node:path'

import { FileTestHelper } from 'cli-testlab'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'

import { getTestFileAsBuffer } from '../../test/utils/TestFileSource'

import { readFileSync } from 'fs'
import { existsSync, statSync } from 'node:fs'
import { type TestCase, testCases } from '../../test/test-cases'
import type { Entry } from '../yauzl-ts/Entry'
import { ZipFile } from '../yauzl-ts/ZipFile'
import { type FileGenerator, unzipToFilesystem, unzipToGenerator } from './unzipomatic'

function ensureExpectedFilesExist(testCase: TestCase, targetDir: string): void {
  if (testCase.expect.success !== true) {
    throw new Error('ensureExpectedFilesExist should only be called for successful test cases')
  }

  if (testCase.expect.success && testCase.expect.files.length === 0) {
    expect(
      existsSync(targetDir),
      `Files found in ${targetDir} for testCase: ${testCase.name}`,
    ).toBe(false)
  }

  for (const file of testCase.expect.files) {
    const path = join(targetDir, file.name)

    expect(existsSync(path), `${path} do not exists for testCase: ${testCase.name}`).toBe(true)

    const stats = statSync(path)

    switch (file.type) {
      case 'file': {
        expect(stats.isFile(), `${path} is not a file for testCase: ${testCase.name}`).toBe(true)

        const readContent = readFileSync(path, 'utf8')
        expect(readContent, `${path} has unexpected content for testCase: ${testCase.name}`).toBe(
          file.content,
        )
        break
      }

      case 'directory': {
        expect(
          stats.isDirectory(),
          `${path} is not a directory for testCase: ${testCase.name}`,
        ).toBe(true)
      }
    }
  }
}

async function ensureExpectedGeneratorExist(
  testCase: TestCase,
  generator: FileGenerator,
): Promise<void> {
  if (testCase.expect.success !== true) {
    throw new Error('ensureExpectedFilesExist should only be called for successful test cases')
  }

  if (testCase.expect.success && testCase.expect.files.length === 0) {
    const result = await generator.next()

    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  }

  const results: Entry[] = []

  for await (const entry of generator) {
    results.push(entry)
  }

  expect(results.length).toBe(testCase.expect.files.length)

  expect(
    results.map((r) => [
      r.fileName,
      r.fileName.toString().endsWith('/') ? 'directory' : 'file',
      r.isEncrypted() ? 0 : r.uncompressedSize,
    ]),
  ).to.have.deep.members(
    testCase.expect.files.map((f) => [
      f.name,
      f.type,
      f.type === 'file' ? (f.encrypted ? 0 : Buffer.byteLength(f.content)) : 0,
    ]),
  )

  // TODO: Validate the content of the files
}

async function readUntilError(generator: FileGenerator): Promise<Error | null> {
  try {
    for await (const _entry of generator) {
    }

    return null
  } catch (e) {
    return e as Error
  }
}

describe('unzipomatic', () => {
  let fileHelper: FileTestHelper
  beforeEach(() => {
    fileHelper = new FileTestHelper({ basePath: __dirname, retryDelay: 10, maxRetries: 10 })
  })

  afterEach(() => {
    fileHelper.cleanup()
  })

  describe('unzipToFilesystem', () => {
    const targetDir = resolve(__dirname, 'target')

    for (const testCase of testCases) {
      const itFn = testCase.expect.success === 'flaky' ? it.skip : it
      const category =
        testCase.expect.success === true
          ? 'ok'
          : testCase.expect.success === 'flaky'
            ? 'flaky'
            : 'err'

      itFn(`[${category}] Unzip ${testCase.name}`, async () => {
        const input = await getTestFileAsBuffer(testCase.path)

        const result = await unzipToFilesystem(input, targetDir, testCase.options || {}).catch(
          (err: Error) => err,
        )

        if (testCase.expect.success) {
          ensureExpectedFilesExist(testCase, targetDir)
        } else {
          expect(result).toBeInstanceOf(Error)
          expect(result!.message).toMatchObject(testCase.expect.error!)
        }

        fileHelper.registerForCleanup(targetDir)
      })
    }
  })

  describe('unzipToReadableGenerator', () => {
    for (const testCase of testCases) {
      const skipIfNotUnzip =
        testCase.expect.success === false && testCase.expect.errorWhile !== 'unzip'
      const itFn = testCase.expect.success === 'flaky' || skipIfNotUnzip ? it.skip : it
      const category =
        testCase.expect.success === true
          ? 'ok'
          : testCase.expect.success === 'flaky'
            ? 'flaky'
            : 'err'

      itFn(`[${category}] Unzip ${testCase.name}`, async () => {
        const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

        const input = await getTestFileAsBuffer(testCase.path)

        const unzipGenerator = unzipToGenerator(input, testCase.options || {})

        if (testCase.expect.success) {
          await ensureExpectedGeneratorExist(testCase, unzipGenerator)
        } else {
          const result = await readUntilError(unzipGenerator)

          expect(result).toBeInstanceOf(Error)
          expect(result!.message).toMatchObject(testCase.expect.error!)
        }

        if (testCase.expect.success || testCase.expect.errorWhile !== 'create')
          expect(closeZipFile).toHaveBeenCalledOnce()
      })
    }

    it('should clean resources if stopped in the middle', async () => {
      const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

      const successTestCase = testCases.find(
        (t) => t.expect.success === true && t.expect.files.length > 1,
      )

      expect(successTestCase).not.toBeUndefined()

      const input = await getTestFileAsBuffer(successTestCase!.path)
      const unzipGenerator = unzipToGenerator(input, successTestCase!.options || {})

      const result = await unzipGenerator.next()
      expect(result.done).toBe(false)

      const resultDone = await unzipGenerator.return!()
      expect(resultDone.done).toBe(true)

      expect(closeZipFile).toHaveBeenCalledOnce()
    })
  })
})
