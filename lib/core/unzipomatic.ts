import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { Entry } from '../yauzl-ts/Entry'
import type { ZipFile } from '../yauzl-ts/ZipFile'
import { fromBuffer } from '../yauzl-ts/inputProcessors'

export type UnzipOptions = {
  // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type TargetFileMetadata = {
  fullPath: string
  fileSize: number
}

// ToDo
export type FileGenerator = Generator<Entry, void, void>

export async function unzipToFilesystem(
  source: SourceType,
  targetDir: string,
  options: UnzipOptions,
): Promise<void> {
  if (!Buffer.isBuffer(source)) {
    throw new Error('Only buffer is currently supported')
  }

  const fileWrites: Promise<void>[] = [] // Array to track file write promises

  const zipFileOrError = await new Promise<Error | ZipFile>((openResolve) => {
    fromBuffer(source, { lazyEntries: true }, (err, result) => {
      if (err) {
        return openResolve(err)
      }
      openResolve(result!)
    })
  })

  if (zipFileOrError instanceof Error) {
    throw zipFileOrError
  }

  const zipfile = zipFileOrError

  await new Promise((operationResolve, operationReject) => {
    zipfile.on('entry', (entry) => {
      if (/\/$/.test(entry.fileName)) {
        // Directory: create if doesn't exist
        const directoryPath = join(targetDir, entry.fileName)
        void mkdir(directoryPath, { recursive: true })
          .then(() => {
            zipfile.readEntry()
          })
          .catch((err) => {
            operationReject(err)
          })
      } else {
        // File: extract
        zipfile.openReadStream(
          entry,
          { decrypt: entry.isEncrypted() ? false : undefined, ...options },
          (err, readStream) => {
            if (err) {
              operationReject(err)
              return
            }
            if (!readStream) {
              operationReject(new Error('No readstream'))
              return
            }

            const filePath = join(targetDir, entry.fileName)
            fileWrites.push(
              (async () => {
                await mkdir(dirname(filePath), { recursive: true })
                await pipeline(readStream, createWriteStream(filePath)) // Use pipeline for proper error handling
              })(),
            )

            readStream.on('end', () => {
              zipfile.readEntry()
            })
          },
        )
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
 * Used to iterate over multiple files in an archive
 */
export function unzipToReadableGenerator(
  source: SourceType,
  options: UnzipOptions,
): Promise<FileGenerator> {
  throw new Error('Not implemented')
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
