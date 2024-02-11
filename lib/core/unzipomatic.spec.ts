import { describe, it } from 'vitest'
import { resolve } from 'node:path'

import { getTestFileAsBuffer } from '../../test/utils/TestFileSource'

import { unzipToFilesystem } from './unzipomatic'

describe('unzipomatic', () => {
  describe('unzipToFilesystem', () => {
    it('Unzips file from buffer', async () => {
      const input = await getTestFileAsBuffer('traditional-encryption.zip')

      await unzipToFilesystem(input, resolve(__dirname, 'target'), {})
    })

    it('Unzips directories from buffer', async () => {
      const input = await getTestFileAsBuffer('directories.zip')

      await unzipToFilesystem(input, resolve(__dirname, 'target2'), {})
    })
  })
})
