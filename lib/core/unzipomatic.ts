import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { Entry } from '../yauzl-ts/Entry'
import { fromBufferAsync } from '../yauzl-ts/inputProcessors'

export type UnzipOptions = {
  // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type FileGenerator = AsyncGenerator<Entry, undefined, void>

export async function unzipToFilesystem(
  source: SourceType,
  targetDir: string,
  options?: UnzipOptions,
): Promise<void> {
  if (!Buffer.isBuffer(source)) {
    return Promise.reject(new Error('Only buffer is currently supported'))
  }

  const fileWrites: Promise<void>[] = [] // Array to track file write promises

  const zipFileOrError = await fromBufferAsync(source, { ...options, lazyEntries: true }).catch(
    (err: Error) => err,
  )

  if (zipFileOrError instanceof Error) {
    return Promise.reject(zipFileOrError)
  }

  const zipfile = zipFileOrError

  await new Promise((operationResolve, operationReject) => {
    zipfile.on('entry', (entry: Entry) => {
      if (entry.isDirectory()) {
        // Directory: create if doesn't exist
        const directoryPath = join(targetDir, entry.fileName.toString())
        void mkdir(directoryPath, { recursive: true })
          .then(() => {
            zipfile.readEntry()
          })
          .catch((err) => {
            operationReject(err)
          })
      } else {
        // File: extract
        entry
          .getStream()
          .then((readStream) => {
            const filePath = join(targetDir, entry.fileName.toString())

            fileWrites.push(
              (async () => {
                // perf(h4ad): Only run this once per directory
                await mkdir(dirname(filePath), { recursive: true })
                await pipeline(readStream, createWriteStream(filePath)) // Use pipeline for proper error handling
              })(),
            )

            readStream.on('end', () => {
              zipfile.readEntry()
            })
          })
          .catch(operationReject)
      }
    })

    zipfile.on('end', () => {
      // Wait for all file writes to complete
      void Promise.all(fileWrites)
        .then(() => {
          operationResolve(undefined)
        })
        .catch((err) => {
          operationReject(err)
        })
    })

    zipfile.on('error', (err) => {
      operationReject(err)
    })

    zipfile.readEntry()
  })
}

/**
 * Used to iterate over multiple files in an archive.
 *
 * In case you want to stop the iteration in the middle, you MUST call `generator.return(undefined)` to dispose the resources,
 * otherwise, the generator will keep the resources open and you will have a memory leak.
 *
 * To read the content of the file, you can use `entry.getBuffer()` or `entry.getStream()`.
 * These methods can only be called while iterating over the generator, and they will throw an error if called after the generator is done.
 *
 * @throws {Error} If you try to dispose/close the generator while there are open streams reading the zip content.
 */
export async function* unzipToGenerator(source: SourceType, options?: UnzipOptions): FileGenerator {
  if (!Buffer.isBuffer(source)) {
    throw new Error('Only buffer is currently supported')
  }

  const zipFileOrError = await fromBufferAsync(source, { ...options, lazyEntries: true }).catch(
    (err: Error) => err,
  )

  if (zipFileOrError instanceof Error) {
    throw zipFileOrError
  }

  const zipfile = zipFileOrError
  type ResolvedData = { error?: Error; entry?: Entry }
  let resolveNextEntry: (data?: ResolvedData) => void

  zipfile.on('entry', (entry) => {
    resolveNextEntry({ entry })
  })

  zipfile.on('end', () => {
    resolveNextEntry()
  })

  zipfile.on('error', (error) => {
    resolveNextEntry({ error })
  })

  let alreadyThrowRefCountError = false

  try {
    do {
      const waitResolve = new Promise<ResolvedData | undefined>((resolve) => {
        resolveNextEntry = resolve
      })

      zipfile.readEntry()
      const resolvedData = await waitResolve

      if (!resolvedData) {
        // is normal to have refCount == 1 because the zipFile holds a reference to the reader
        if (zipfile.reader.refCount > 1) {
          alreadyThrowRefCountError = true

          throw new Error(
            'You have opened streams reading the zip content while the generator was finished.',
          )
        }

        break
      }

      if (resolvedData.entry) {
        yield resolvedData.entry
        continue
      }

      yield Promise.reject(resolvedData.error)
      break
    } while (true)
  } finally {
    const refCount = zipfile.reader.refCount

    zipfile.removeAllListeners()
    zipfile.close()

    // is normal to have refCount == 1 because the zipFile holds a reference to the reader
    if (refCount > 1 && !alreadyThrowRefCountError) {
      yield Promise.reject(
        new Error(
          'You have open streams reading the zip content after the generator was disposed.',
        ),
      )
    }
  }
}

/**
 * Used to extract a single-file archive
 */
export function unzipToReadable(source: SourceType, options: UnzipOptions): Promise<Readable> {
  throw new Error('Not implemented')
}

/**
 * Used to extract a single-file archive
 */
export function unzipToBuffer(source: SourceType, options: UnzipOptions): Promise<Buffer> {
  throw new Error('Not implemented')
}

// TBD
// Do we need to support filters for extracting just a subset of files?
//
