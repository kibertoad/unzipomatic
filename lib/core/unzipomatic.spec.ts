import { join, resolve } from 'node:path'

import { FileTestHelper } from 'cli-testlab'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getTestFileAsBuffer } from '../../test/utils/TestFileSource'

import { readFileSync } from 'fs'
import { existsSync, statSync } from 'node:fs'
import { type TestCase, testCases } from '../../test/test-cases'
import { unzipToFilesystem } from './unzipomatic'

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
})
