import { resolve } from 'node:path'

import { FileTestHelper } from 'cli-testlab'
import { afterEach, beforeEach, describe, it } from 'vitest'

import { getTestFileAsBuffer } from '../../test/utils/TestFileSource'

import { unzipToFilesystem } from './unzipomatic'

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

    it('Unzips file from buffer', async () => {
      const input = await getTestFileAsBuffer('deflate.zip')

      await unzipToFilesystem(input, targetDir, {})

      fileHelper.registerForCleanup(targetDir)
    })

    it('Unzips directories from buffer', async () => {
      const input = await getTestFileAsBuffer('directories.zip')

      await unzipToFilesystem(input, targetDir, {})

      fileHelper.registerForCleanup(targetDir)
    })
  })
})
