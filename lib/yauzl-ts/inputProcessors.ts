import fs from 'node:fs'

import { createFromBuffer, createFromFd } from 'better-fd-slicer'
import type { IRandomAccessReader } from './RandomAccessReader'
import { ZipFile } from './ZipFile'
import { decodeBuffer, defaultCallback, readAndAssertNoEof, readUInt64LE } from './internal/utils'

export interface OpenOptions {
  autoClose?: boolean
  /**
   * If true, the content of the files will be read and stored in memory.
   *
   * @default false
   */
  withContent?: boolean
  /**
   * @default true
   */
  decodeStrings?: boolean
  /**
   * @default true
   */
  validateEntrySizes?: boolean
  /**
   * @default false
   */
  strictFileNames?: boolean
}

export type DefaultOpenOptions = OpenOptions & {
  /**
   * @default true
   */
  autoClose?: boolean
}

export type FdOpenOptions = OpenOptions & {
  /**
   * @default false
   */
  autoClose?: boolean
}

export type BufferOpenOptions = OpenOptions & {
  autoClose?: false
}

export type OpenCallback = (err: Error | null, zipfile?: ZipFile) => void

function parseOptions(
  optionsOrCallback: DefaultOpenOptions | OpenCallback,
  callbackOptional?: OpenCallback,
): [DefaultOpenOptions, OpenCallback] {
  if (typeof optionsOrCallback === 'function') {
    return [
      {
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: false,
        withContent: false,
      },
      optionsOrCallback,
    ]
  }

  const options = optionsOrCallback || {}

  if (options.decodeStrings == null) options.decodeStrings = true
  if (options.validateEntrySizes == null) options.validateEntrySizes = true
  if (options.strictFileNames == null) options.strictFileNames = false
  if (options.withContent == null) options.withContent = false

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return [options, callbackOptional || defaultCallback]
}

export function open(path: string, options: DefaultOpenOptions, callback: OpenCallback): void
export function open(path: string, callback: OpenCallback): void

export function open(
  path: string,
  optionsOrCallback: DefaultOpenOptions | OpenCallback,
  callbackOptional?: OpenCallback,
): void {
  const [options, callback] = parseOptions(optionsOrCallback, callbackOptional)

  if (options.autoClose == null) options.autoClose = true

  fs.open(path, 'r', (err, fd) => {
    if (err && typeof callback === 'function') return callback(err)

    fromFd(fd, options, (err, zipfile) => {
      if (err) fs.close(fd, defaultCallback)
      callback(err, zipfile)
    })
  })
}

export function fromFd(fd: number, options: FdOpenOptions, callback: OpenCallback): void
export function fromFd(fd: number, callback: OpenCallback): void

export function fromFd(
  fd: number,
  optionsOrCallback: FdOpenOptions | OpenCallback,
  callbackOptional?: OpenCallback,
): void {
  const [options, callback] = parseOptions(optionsOrCallback, callbackOptional)

  if (options.autoClose == null) options.autoClose = false

  fs.fstat(fd, (err, stats) => {
    if (err) return callback(err)
    const reader = createFromFd(fd, { autoClose: true })
    fromRandomAccessReader(reader, stats.size, options, callback)
  })
}

export function fromBuffer(buffer: Buffer, options: BufferOpenOptions, callback: OpenCallback): void
export function fromBuffer(buffer: Buffer, callback: OpenCallback): void

export function fromBuffer(
  buffer: Buffer,
  optionsOrCallback: BufferOpenOptions | OpenCallback,
  callbackOptional?: OpenCallback,
) {
  const [options, callback] = parseOptions(optionsOrCallback, callbackOptional)
  options.autoClose = false

  // limit the max chunk size. see https://github.com/thejoshwolfe/yauzl/issues/87
  const reader = createFromBuffer(buffer, { maxChunkSize: 0x10000 })
  fromRandomAccessReader(reader, buffer.length, options, callback)
}

export function fromBufferAsync(buffer: Buffer, options?: BufferOpenOptions): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, options || { }, (err, zipfile) => {
      if (err) reject(err)
      else resolve(zipfile!)
    })
  })
}

export function fromRandomAccessReader<TReader extends IRandomAccessReader>(
  reader: TReader,
  totalSize: number,
  options: OpenOptions,
  callback: OpenCallback,
): void

export function fromRandomAccessReader<TReader extends IRandomAccessReader>(
  reader: TReader,
  totalSize: number,
  callback: OpenCallback,
): void

export function fromRandomAccessReader<TReader extends IRandomAccessReader>(
  reader: TReader,
  totalSize: number,
  optionsOrCallback: OpenOptions | OpenCallback,
  callbackOptional?: OpenCallback,
): void {
  const [options, callback] = parseOptions(optionsOrCallback, callbackOptional)
  const decodeStrings = !!options.decodeStrings

  if (options.autoClose == null) options.autoClose = true

  if (totalSize > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      "zip file too large. only file sizes up to 2^52 are supported due to JavaScript's Number type being an IEEE 754 double.",
    )
  }

  // the matching unref() call is in zipfile.close()
  reader.ref()

  // eocdr means End of Central Directory Record.
  // search backwards for the eocdr signature.
  // the last field of the eocdr is a variable-length comment.
  // the comment size is encoded in a 2-byte field in the eocdr, which we can't find without trudging backwards through the comment to find it.
  // as a consequence of this design decision, it's possible to have ambiguous zip file metadata if a coherent eocdr was in the comment.
  // we search backwards for a eocdr signature, and hope that whoever made the zip file was smart enough to forbid the eocdr signature in the comment.
  const eocdrWithoutCommentSize = 22
  const maxCommentSize = 0xffff // 2-byte size
  const bufferSize = Math.min(eocdrWithoutCommentSize + maxCommentSize, totalSize)
  const buffer = Buffer.allocUnsafe(bufferSize)
  const bufferReadStart = totalSize - buffer.length
  readAndAssertNoEof(reader, buffer, 0, bufferSize, bufferReadStart, (err: Error | null) => {
    if (err) return callback(err)
    for (let i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
      if (buffer.readUInt32LE(i) !== 0x06054b50) continue
      // found eocdr
      const eocdrBuffer = buffer.slice(i)

      // 0 - End of central directory signature = 0x06054b50
      // 4 - Number of this disk
      const diskNumber = eocdrBuffer.readUInt16LE(4)
      if (diskNumber !== 0) {
        return callback(
          new Error(`multi-disk zip files are not supported: found disk number: ${diskNumber}`),
        )
      }
      // 6 - Disk where central directory starts
      // 8 - Number of central directory records on this disk
      // 10 - Total number of central directory records
      let entryCount = eocdrBuffer.readUInt16LE(10)
      // 12 - Size of central directory (bytes)
      // 16 - Offset of start of central directory, relative to start of archive
      let centralDirectoryOffset = eocdrBuffer.readUInt32LE(16)
      // 20 - Comment length
      const commentLength = eocdrBuffer.readUInt16LE(20)
      const expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize
      if (commentLength !== expectedCommentLength) {
        return callback(
          new Error(
            `invalid comment length. expected: ${expectedCommentLength}. found: ${commentLength}`,
          ),
        )
      }
      // 22 - Comment
      // the encoding is always cp437.
      const comment = decodeStrings
        ? decodeBuffer(eocdrBuffer, 22, eocdrBuffer.length, false)
        : eocdrBuffer.slice(22)

      if (!(entryCount === 0xffff || centralDirectoryOffset === 0xffffffff)) {
        return callback(
          null,
          new ZipFile(
            reader,
            centralDirectoryOffset,
            totalSize,
            entryCount,
            comment,
            !!options.autoClose,
            decodeStrings,
            !!options.validateEntrySizes,
            !!options.strictFileNames,
            !!options.withContent,
          ),
        )
      }

      // ZIP64 format

      // ZIP64 Zip64 end of central directory locator
      const zip64EocdlBuffer = Buffer.allocUnsafe(20)
      const zip64EocdlOffset = bufferReadStart + i - zip64EocdlBuffer.length
      readAndAssertNoEof(
        reader,
        zip64EocdlBuffer,
        0,
        zip64EocdlBuffer.length,
        zip64EocdlOffset,
        (err: Error | null) => {
          if (err) return callback(err)

          // 0 - zip64 end of central dir locator signature = 0x07064b50
          if (zip64EocdlBuffer.readUInt32LE(0) !== 0x07064b50) {
            return callback(new Error('invalid zip64 end of central directory locator signature'))
          }
          // 4 - number of the disk with the start of the zip64 end of central directory
          // 8 - relative offset of the zip64 end of central directory record
          const zip64EocdrOffset = readUInt64LE(zip64EocdlBuffer, 8)
          // 16 - total number of disks

          // ZIP64 end of central directory record
          const zip64EocdrBuffer = Buffer.allocUnsafe(56)
          readAndAssertNoEof(
            reader,
            zip64EocdrBuffer,
            0,
            zip64EocdrBuffer.length,
            zip64EocdrOffset,
            (err: Error | null) => {
              if (err) return callback(err)

              // 0 - zip64 end of central dir signature                           4 bytes  (0x06064b50)
              if (zip64EocdrBuffer.readUInt32LE(0) !== 0x06064b50) {
                return callback(
                  new Error('invalid zip64 end of central directory record signature'),
                )
              }
              // 4 - size of zip64 end of central directory record                8 bytes
              // 12 - version made by                                             2 bytes
              // 14 - version needed to extract                                   2 bytes
              // 16 - number of this disk                                         4 bytes
              // 20 - number of the disk with the start of the central directory  4 bytes
              // 24 - total number of entries in the central directory on this disk         8 bytes
              // 32 - total number of entries in the central directory            8 bytes
              entryCount = readUInt64LE(zip64EocdrBuffer, 32)
              // 40 - size of the central directory                               8 bytes
              // 48 - offset of start of central directory with respect to the starting disk number     8 bytes
              centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48)
              // 56 - zip64 extensible data sector                                (variable size)
              return callback(
                null,
                new ZipFile(
                  reader,
                  centralDirectoryOffset,
                  totalSize,
                  entryCount,
                  comment,
                  !!options.autoClose,
                  decodeStrings,
                  !!options.validateEntrySizes,
                  !!options.strictFileNames,
                  !!options.withContent,
                ),
              )
            },
          )
        },
      )
      return
    }
    callback(new Error('end of central directory record signature not found'))
  })
}
