import EventEmitter from 'node:events'
import zlib from 'node:zlib'
import type { Transform } from 'stream'

import crc32 from 'buffer-crc32'

import { Entry } from './Entry'
import type { RandomAccessReader } from './RandomAccessReader'
import { AssertByteCountStream } from './internal/AssertByteCountStream'
import {
  decodeBuffer,
  emitError,
  emitErrorAndAutoClose,
  readAndAssertNoEof,
  readUInt64LE,
} from './internal/utils'
import { validateFileName } from './validations'

export interface OpenReadStreamOptions {
  decrypt?: false
  decompress?: false
  start?: number
  end?: number
}

export type OpenReadStreamCallback = (err: Error | null, stream?: Transform) => void

export class ZipFile<TReader extends RandomAccessReader = RandomAccessReader> extends EventEmitter {
  private readonly validateEntrySizes: boolean
  private readonly reader: TReader
  private readonly lazyEntries: boolean
  private readonly entryCount: number
  private entriesRead: number
  public autoClose: boolean
  public emittedError: boolean
  private readonly strictFileNames: boolean
  private readEntryCursor: number
  private fileSize: number
  private comment: string | Buffer
  private readonly decodeStrings: boolean
  private isOpen: boolean

  constructor(
    reader: TReader,
    centralDirectoryOffset: number,
    fileSize: number,
    entryCount: number,
    comment: string | Buffer,
    autoClose: boolean,
    lazyEntries: boolean,
    decodeStrings: boolean,
    validateEntrySizes: boolean,
    strictFileNames: boolean,
  ) {
    super()

    this.reader = reader
    // forward close events
    this.reader.on('error', (err: Error) => {
      // error closing the fd
      emitError(this, err)
    })
    this.reader.once('close', () => {
      this.emit('close')
    })
    this.readEntryCursor = centralDirectoryOffset
    this.fileSize = fileSize
    this.entryCount = entryCount
    this.comment = comment
    this.entriesRead = 0
    this.autoClose = autoClose
    this.lazyEntries = lazyEntries
    this.decodeStrings = decodeStrings
    this.validateEntrySizes = validateEntrySizes
    this.strictFileNames = strictFileNames
    this.isOpen = true
    this.emittedError = false

    if (!this.lazyEntries) this._readEntry()
  }

  readEntry() {
    if (!this.lazyEntries) throw new Error('readEntry() called without lazyEntries:true')
    this._readEntry()
  }

  _readEntry() {
    if (this.entryCount === this.entriesRead) {
      // done with metadata
      return setImmediate(() => {
        if (this.autoClose) this.close()
        if (this.emittedError) return

        this.emit('end')
      })
    }

    if (this.emittedError) return
    let buffer = Buffer.allocUnsafe(46)

    readAndAssertNoEof(
      this.reader,
      buffer,
      0,
      buffer.length,
      this.readEntryCursor,
      (err: Error | null, _) => {
        if (err) return emitErrorAndAutoClose(this, err)
        if (this.emittedError) return

        const entry = new Entry()
        // 0 - Central directory file header signature
        const signature = buffer.readUInt32LE(0)

        if (signature !== 0x02014b50) {
          return emitErrorAndAutoClose(
            this,
            new Error(
              `invalid central directory file header signature: 0x${signature.toString(16)}`,
            ),
          )
        }

        // 4 - Version made by
        entry.versionMadeBy = buffer.readUInt16LE(4)
        // 6 - Version needed to extract (minimum)
        entry.versionNeededToExtract = buffer.readUInt16LE(6)
        // 8 - General purpose bit flag
        entry.generalPurposeBitFlag = buffer.readUInt16LE(8)
        // 10 - Compression method
        entry.compressionMethod = buffer.readUInt16LE(10)
        // 12 - File last modification time
        entry.lastModFileTime = buffer.readUInt16LE(12)
        // 14 - File last modification date
        entry.lastModFileDate = buffer.readUInt16LE(14)
        // 16 - CRC-32
        entry.crc32 = buffer.readUInt32LE(16)
        // 20 - Compressed size
        entry.compressedSize = buffer.readUInt32LE(20)
        // 24 - Uncompressed size
        entry.uncompressedSize = buffer.readUInt32LE(24)
        // 28 - File name length (n)
        entry.fileNameLength = buffer.readUInt16LE(28)
        // 30 - Extra field length (m)
        entry.extraFieldLength = buffer.readUInt16LE(30)
        // 32 - File comment length (k)
        entry.fileCommentLength = buffer.readUInt16LE(32)
        // 34 - Disk number where file starts
        // 36 - Internal file attributes
        entry.internalFileAttributes = buffer.readUInt16LE(36)
        // 38 - External file attributes
        entry.externalFileAttributes = buffer.readUInt32LE(38)
        // 42 - Relative offset of local file header
        entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42)

        if (entry.generalPurposeBitFlag & 0x40)
          return emitErrorAndAutoClose(this, new Error('strong encryption is not supported'))

        this.readEntryCursor += 46

        buffer = Buffer.allocUnsafe(
          entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength,
        )

        readAndAssertNoEof(
          this.reader,
          buffer,
          0,
          buffer.length,
          this.readEntryCursor,
          (err: Error | null) => {
            let extraField
            if (err) return emitErrorAndAutoClose(this, err)
            if (this.emittedError) return
            // 46 - File name
            const isUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0
            entry.fileName = this.decodeStrings
              ? decodeBuffer(buffer, 0, entry.fileNameLength, isUtf8)
              : buffer.slice(0, entry.fileNameLength)

            // 46+n - Extra field
            const fileCommentStart = entry.fileNameLength + entry.extraFieldLength
            const extraFieldBuffer = buffer.slice(entry.fileNameLength, fileCommentStart)
            entry.extraFields = []

            let i = 0

            while (i < extraFieldBuffer.length - 3) {
              const headerId = extraFieldBuffer.readUInt16LE(i + 0)
              const dataSize = extraFieldBuffer.readUInt16LE(i + 2)
              const dataStart = i + 4
              const dataEnd = dataStart + dataSize
              if (dataEnd > extraFieldBuffer.length)
                return emitErrorAndAutoClose(
                  this,
                  new Error('extra field length exceeds extra field buffer size'),
                )
              const dataBuffer = Buffer.allocUnsafe(dataSize)
              extraFieldBuffer.copy(dataBuffer, 0, dataStart, dataEnd)
              entry.extraFields.push({
                id: headerId,
                data: dataBuffer,
              })
              i = dataEnd
            }

            // 46+n+m - File comment
            entry.fileComment = this.decodeStrings
              ? decodeBuffer(
                  buffer,
                  fileCommentStart,
                  fileCommentStart + entry.fileCommentLength,
                  isUtf8,
                )
              : buffer.slice(fileCommentStart, fileCommentStart + entry.fileCommentLength)
            // compatibility hack for https://github.com/thejoshwolfe/yauzl/issues/47
            entry.comment = entry.fileComment

            this.readEntryCursor += buffer.length
            this.entriesRead += 1

            if (
              entry.uncompressedSize === 0xffffffff ||
              entry.compressedSize === 0xffffffff ||
              entry.relativeOffsetOfLocalHeader === 0xffffffff
            ) {
              // ZIP64 format
              // find the Zip64 Extended Information Extra Field
              let zip64EiefBuffer = null
              for (i = 0; i < entry.extraFields.length; i++) {
                extraField = entry.extraFields[i]
                if (extraField.id === 0x0001) {
                  zip64EiefBuffer = extraField.data
                  break
                }
              }
              if (zip64EiefBuffer == null) {
                return emitErrorAndAutoClose(
                  this,
                  new Error('expected zip64 extended information extra field'),
                )
              }
              let index = 0
              // 0 - Original Size          8 bytes
              if (entry.uncompressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                  return emitErrorAndAutoClose(
                    this,
                    new Error(
                      'zip64 extended information extra field does not include uncompressed size',
                    ),
                  )
                }
                entry.uncompressedSize = readUInt64LE(zip64EiefBuffer, index)
                index += 8
              }
              // 8 - Compressed Size        8 bytes
              if (entry.compressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                  return emitErrorAndAutoClose(
                    this,
                    new Error(
                      'zip64 extended information extra field does not include compressed size',
                    ),
                  )
                }
                entry.compressedSize = readUInt64LE(zip64EiefBuffer, index)
                index += 8
              }
              // 16 - Relative Header Offset 8 bytes
              if (entry.relativeOffsetOfLocalHeader === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                  return emitErrorAndAutoClose(
                    this,
                    new Error(
                      'zip64 extended information extra field does not include relative header offset',
                    ),
                  )
                }
                entry.relativeOffsetOfLocalHeader = readUInt64LE(zip64EiefBuffer, index)
                index += 8
              }
              // 24 - Disk Start Number      4 bytes
            }

            // check for Info-ZIP Unicode Path Extra Field (0x7075)
            // see https://github.com/thejoshwolfe/yauzl/issues/33
            if (this.decodeStrings) {
              for (i = 0; i < entry.extraFields.length; i++) {
                extraField = entry.extraFields[i]
                if (extraField.id === 0x7075) {
                  if (extraField.data.length < 6) {
                    // too short to be meaningful
                    continue
                  }
                  // Version       1 byte      version of this extra field, currently 1
                  if (extraField.data.readUInt8(0) !== 1) {
                    // > Changes may not be backward compatible so this extra
                    // > field should not be used if the version is not recognized.
                    continue
                  }
                  // NameCRC32     4 bytes     File Name Field CRC32 Checksum
                  const oldNameCrc32 = extraField.data.readUInt32LE(1)
                  if (crc32.unsigned(buffer.slice(0, entry.fileNameLength)) !== oldNameCrc32) {
                    // > If the CRC check fails, this UTF-8 Path Extra Field should be
                    // > ignored and the File Name field in the header should be used instead.
                    continue
                  }
                  // UnicodeName   Variable    UTF-8 version of the entry File Name
                  entry.fileName = decodeBuffer(extraField.data, 5, extraField.data.length, true)
                  break
                }
              }
            }

            // validate file size
            if (this.validateEntrySizes && entry.compressionMethod === 0) {
              let expectedCompressedSize = entry.uncompressedSize
              if (entry.isEncrypted()) {
                // traditional encryption prefixes the file data with a header
                expectedCompressedSize += 12
              }
              if (entry.compressedSize !== expectedCompressedSize) {
                const msg = `compressed/uncompressed size mismatch for stored file: ${entry.compressedSize} != ${entry.uncompressedSize}`
                return emitErrorAndAutoClose(this, new Error(msg))
              }
            }

            if (this.decodeStrings) {
              if (!this.strictFileNames) {
                // allow backslash
                entry.fileName = (entry.fileName as string).replace(/\\/g, '/')
              }
              const errorMessage = validateFileName(entry.fileName as string)
              if (errorMessage != null) return emitErrorAndAutoClose(this, new Error(errorMessage))
            }

            this.emit('entry', entry)

            if (!this.lazyEntries) this._readEntry()
          },
        )
      },
    )
  }

  openReadStream(
    entry: Entry,
    options: OpenReadStreamOptions,
    callback: OpenReadStreamCallback,
  ): void

  openReadStream(entry: Entry, callback: OpenReadStreamCallback): void

  openReadStream(
    entry: Entry,
    optionsOrCallback: OpenReadStreamOptions | OpenReadStreamCallback,
    maybeCallback?: OpenReadStreamCallback,
  ): void {
    // parameter validation
    let relativeStart = 0
    let relativeEnd = entry.compressedSize

    let options: OpenReadStreamOptions
    let callback: OpenReadStreamCallback

    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback
      options = {}
    } else {
      options = optionsOrCallback
      callback = maybeCallback as OpenReadStreamCallback

      // validate options that the caller has no excuse to get wrong
      if (options.decrypt != null) {
        if (!entry.isEncrypted()) {
          throw new Error('options.decrypt can only be specified for encrypted entries')
        }
        if (optionsOrCallback.decrypt !== false)
          throw new Error(`invalid options.decrypt value: ${options.decrypt as boolean}`)
        if (entry.isCompressed()) {
          if (optionsOrCallback.decompress !== false)
            throw new Error('entry is encrypted and compressed, and options.decompress !== false')
        }
      }
      if (options.decompress != null) {
        if (!entry.isCompressed()) {
          throw new Error('options.decompress can only be specified for compressed entries')
        }
        if (!(options.decompress === false || options.decompress === true)) {
          throw new Error(`invalid options.decompress value: ${options.decompress as boolean}`)
        }
      }
      if (options.start != null || options.end != null) {
        if (entry.isCompressed() && optionsOrCallback.decompress !== false) {
          throw new Error(
            'start/end range not allowed for compressed entry without options.decompress === false',
          )
        }
        if (entry.isEncrypted() && optionsOrCallback.decrypt !== false) {
          throw new Error(
            'start/end range not allowed for encrypted entry without options.decrypt === false',
          )
        }
      }
      if (options.start != null) {
        relativeStart = options.start
        if (relativeStart < 0) throw new Error('options.start < 0')
        if (relativeStart > entry.compressedSize)
          throw new Error('options.start > entry.compressedSize')
      }
      if (options.end != null) {
        relativeEnd = options.end
        if (relativeEnd < 0) throw new Error('options.end < 0')
        if (relativeEnd > entry.compressedSize)
          throw new Error('options.end > entry.compressedSize')
        if (relativeEnd < relativeStart) throw new Error('options.end < options.start')
      }
    }
    // any further errors can either be caused by the zipfile,
    // or were introduced in a minor version of yauzl,
    // so should be passed to the client rather than thrown.
    if (!this.isOpen) return callback(new Error('closed'))
    if (entry.isEncrypted()) {
      if (options.decrypt !== false)
        return callback(new Error('entry is encrypted, and options.decrypt !== false'))
    }
    // make sure we don't lose the fd before we open the actual read stream
    this.reader.ref()
    const buffer = Buffer.allocUnsafe(30)
    readAndAssertNoEof(
      this.reader,
      buffer,
      0,
      buffer.length,
      entry.relativeOffsetOfLocalHeader,
      (err: Error | null) => {
        try {
          if (err) return callback(err)
          // 0 - Local file header signature = 0x04034b50
          const signature = buffer.readUInt32LE(0)
          if (signature !== 0x04034b50) {
            return callback(
              new Error(`invalid local file header signature: 0x${signature.toString(16)}`),
            )
          }
          // all this should be redundant
          // 4 - Version needed to extract (minimum)
          // 6 - General purpose bit flag
          // 8 - Compression method
          // 10 - File last modification time
          // 12 - File last modification date
          // 14 - CRC-32
          // 18 - Compressed size
          // 22 - Uncompressed size
          // 26 - File name length (n)
          const fileNameLength = buffer.readUInt16LE(26)
          // 28 - Extra field length (m)
          const extraFieldLength = buffer.readUInt16LE(28)
          // 30 - File name
          // 30+n - Extra field
          const localFileHeaderEnd =
            entry.relativeOffsetOfLocalHeader + buffer.length + fileNameLength + extraFieldLength
          let decompress
          if (entry.compressionMethod === 0) {
            // 0 - The file is stored (no compression)
            decompress = false
          } else if (entry.compressionMethod === 8) {
            // 8 - The file is Deflated
            decompress = options.decompress != null ? options.decompress : true
          } else {
            return callback(new Error(`unsupported compression method: ${entry.compressionMethod}`))
          }
          const fileDataStart = localFileHeaderEnd
          const fileDataEnd = fileDataStart + entry.compressedSize
          if (entry.compressedSize !== 0) {
            // bounds check now, because the read streams will probably not complain loud enough.
            // since we're dealing with an unsigned offset plus an unsigned size,
            // we only have 1 thing to check for.
            if (fileDataEnd > this.fileSize) {
              return callback(
                new Error(
                  `file data overflows file bounds: ${fileDataStart} + ${entry.compressedSize} > ${this.fileSize}`,
                ),
              )
            }
          }
          const readStream = this.reader.createReadStream({
            start: fileDataStart + relativeStart,
            end: fileDataStart + relativeEnd,
          })
          let endpointStream = readStream
          if (decompress) {
            let destroyed = false
            const inflateFilter = zlib.createInflateRaw()
            readStream.on('error', (err) => {
              // setImmediate here because errors can be emitted during the first call to pipe()
              setImmediate(() => {
                if (!destroyed) inflateFilter.emit('error', err)
              })
            })
            readStream.pipe(inflateFilter)

            if (this.validateEntrySizes) {
              endpointStream = new AssertByteCountStream(entry.uncompressedSize)
              inflateFilter.on('error', (err) => {
                // forward zlib errors to the client-visible stream
                setImmediate(() => {
                  if (!destroyed) endpointStream.emit('error', err)
                })
              })
              inflateFilter.pipe(endpointStream)
            } else {
              // the zlib filter is the client-visible stream
              endpointStream = inflateFilter
            }
            // this is part of yauzl's API, so implement this function on the client-visible stream
            endpointStream.destroy = function () {
              destroyed = true
              if (inflateFilter !== endpointStream) inflateFilter.unpipe(endpointStream)
              readStream.unpipe(inflateFilter)
              // TODO: the inflateFilter may cause a memory leak. see Issue #27.
              readStream.destroy()

              return this
            }
          }
          callback(null, endpointStream)
        } finally {
          this.reader.unref()
        }
      },
    )
  }

  close() {
    if (!this.isOpen) return
    this.isOpen = false
    this.reader.unref()
  }
}
