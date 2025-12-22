import { join, resolve } from 'node:path'

import { FileTestHelper } from 'cli-testlab'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'

import { getTestFileAsBuffer } from '../../test/utils/TestFileSource'

import { existsSync, readFileSync, statSync } from 'node:fs'
import type { Readable } from 'node:stream'
import { type TestCase, testCases } from '../../test/test-cases'
import type { Entry, EntryWithContent } from '../yauzl-ts/Entry'
import { ZipFile } from '../yauzl-ts/ZipFile'
import {
  type FileGenerator,
  unzipToFilesystem,
  unzipToGenerator,
  unzipToReadable,
} from './unzipomatic'

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
  generator: FileGenerator<EntryWithContent | Entry>,
): Promise<void> {
  if (testCase.expect.success !== true) {
    throw new Error('ensureExpectedFilesExist should only be called for successful test cases')
  }

  if (testCase.expect.success && testCase.expect.files.length === 0) {
    const result = await generator.next()

    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  }

  const results: Array<Entry | EntryWithContent> = []

  for await (const entry of generator) {
    const testCaseExpectedFile = testCase.expect.files.find((f) => f.name === entry.fileName)

    expect(testCaseExpectedFile).not.toBeUndefined()
    expect(testCaseExpectedFile!.name).toBe(entry.fileName)

    if (testCaseExpectedFile?.type === 'file') {
      expect(
        testCaseExpectedFile.encrypted ? 0 : Buffer.byteLength(testCaseExpectedFile.content),
      ).toStrictEqual(entry.isEncrypted() ? 0 : entry.uncompressedSize)
      expect(testCaseExpectedFile.content).toStrictEqual(
        'content' in entry
          ? entry.content.toString('utf8')
          : await entry.getBuffer().then((b) => b.toString('utf8')),
      )
    }

    results.push(entry)
  }

  expect(results.length).toBe(testCase.expect.files.length)
}

async function ensureExpectedResultList(
  testCase: TestCase,
  entries: Array<Entry | EntryWithContent>,
): Promise<void> {
  if (testCase.expect.success !== true) {
    throw new Error('ensureExpectedFilesExist should only be called for successful test cases')
  }

  if (testCase.expect.success && testCase.expect.files.length === 0) {
    expect(entries.length).toBe(0)
    return
  }

  expect(entries.length).toBe(testCase.expect.files.length)

  for (const entry of entries) {
    const testCaseExpectedFile = testCase.expect.files.find((f) => f.name === entry.fileName)

    expect(testCaseExpectedFile).not.toBeUndefined()
    expect(testCaseExpectedFile!.name).toBe(entry.fileName)

    if (testCaseExpectedFile?.type === 'file') {
      expect(
        testCaseExpectedFile.encrypted ? 0 : Buffer.byteLength(testCaseExpectedFile.content),
      ).toStrictEqual(entry.isEncrypted() ? 0 : entry.uncompressedSize)

      if ('content' in entry) {
        expect(testCaseExpectedFile.content).toStrictEqual(entry.content.toString('utf8'))
      } else {
        expect(() => entry.getBuffer()).rejects.toThrowError(
          'The content of the file can only be read while the zip file is open.',
        )
      }
    }
  }
}
async function readUntilError(
  generator: FileGenerator<EntryWithContent | Entry>,
): Promise<Error | null> {
  try {
    for await (const _entry of generator) {
    }

    return null
  } catch (e) {
    return e as Error
  }
}

async function readReadableUntilError(
  readable: Readable,
): Promise<Error | Array<Entry | EntryWithContent>> {
  try {
    const results: Array<Entry | EntryWithContent> = []

    for await (const entry of readable) {
      results.push(entry)
    }

    return results
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

        const result = await unzipToFilesystem(input, targetDir).catch((err: Error) => err)

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

      for (const withContent of [true, false]) {
        itFn(`[${category}] Unzip ${testCase.name} withContent=${withContent}`, async () => {
          const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

          const input = await getTestFileAsBuffer(testCase.path)

          const unzipGenerator = unzipToGenerator(input, {
            withContent,
          })

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
    }

    it('should clean resources if stopped in the middle', async () => {
      const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

      const successTestCase = testCases.find(
        (t) => t.expect.success === true && t.expect.files.length > 1,
      )

      expect(successTestCase).not.toBeUndefined()

      const input = await getTestFileAsBuffer(successTestCase!.path)
      const unzipGenerator = unzipToGenerator(input)

      const result = await unzipGenerator.next()
      expect(result.done).toBe(false)

      const resultDone = await unzipGenerator.return!(undefined)
      expect(resultDone.done).toBe(true)

      expect(closeZipFile).toHaveBeenCalledOnce()
    })

    it('throw error if try dispose generator while reading the zip content', async () => {
      const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

      const successTestCase = testCases.find(
        (t) => t.expect.success === true && t.expect.files.length > 0,
      )

      expect(successTestCase).not.toBeUndefined()

      const input = await getTestFileAsBuffer(successTestCase!.path)
      const unzipGenerator = unzipToGenerator(input)

      const firstZipEntry = await unzipGenerator.next()
      expect(firstZipEntry.done).toBe(false)
      expect(firstZipEntry.value!.isDirectory()).toBe(false)

      const [errorPromise, contentResult] = await Promise.allSettled([
        unzipGenerator.return!(undefined),
        firstZipEntry.value!.getBuffer(),
      ])

      expect(errorPromise.status).toBe('rejected')
      expect(errorPromise.status === 'rejected' && (errorPromise.reason as Error).message).toBe(
        'You have open streams reading the zip content after the generator was disposed.',
      )

      expect(closeZipFile).toHaveBeenCalledOnce()
    })

    it('throw error if try read entry after generator is disposed', async () => {
      const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

      const successTestCase = testCases.find(
        (t) => t.expect.success === true && t.expect.files.length > 0,
      )

      expect(successTestCase).not.toBeUndefined()

      const input = await getTestFileAsBuffer(successTestCase!.path)
      const unzipGenerator = unzipToGenerator(input)

      const firstZipEntry = await unzipGenerator.next()
      expect(firstZipEntry.done).toBe(false)
      expect(firstZipEntry.value!.isDirectory()).toBe(false)

      await unzipGenerator.return!(undefined)

      await expect(firstZipEntry.value!.getBuffer()).rejects.toThrowError(
        'The content of the file can only be read while the zip file is open.',
      )

      expect(closeZipFile).toHaveBeenCalledOnce()
    })
  })

  describe('unzipToReadable', () => {
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

      for (const withContent of [true, false]) {
        itFn(`[${category}] Unzip ${testCase.name} withContent=${withContent}`, async () => {
          const closeZipFile = vitest.spyOn(ZipFile.prototype, 'close')

          const input = await getTestFileAsBuffer(testCase.path)

          const unzipReadable = await unzipToReadable(input, {
            withContent,
          })
          const result = await readReadableUntilError(unzipReadable)

          if (testCase.expect.success) {
            await ensureExpectedResultList(testCase, result as Array<Entry | EntryWithContent>)
          } else {
            expect(result).toBeInstanceOf(Error)
            expect((result as Error).message).toMatchObject(testCase.expect.error!)
          }

          if (testCase.expect.success || testCase.expect.errorWhile !== 'create')
            expect(closeZipFile).toHaveBeenCalledOnce()
        })
      }
    }
  })
})
