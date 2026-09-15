import EventEmitter from 'node:events'

import crc32 from 'buffer-crc32'

import { Entry, EntryWithContent, getBufferFromEntry } from './Entry'
import type { IRandomAccessReader } from './RandomAccessReader'
import { decodeBuffer, emitError, emitErrorAndAutoClose, readAndAssertNoEof, readUInt64LE } from './internal/utils'
import { validateFileName } from './validations'

export class ZipFile<TReader extends IRandomAccessReader = IRandomAccessReader> extends EventEmitter {
  public autoClose: boolean
  public emittedError: boolean
  public readonly reader: TReader
  public isOpen: boolean
  public readonly fileSize: number
  public readonly comment: string | Buffer
  public readonly decodeStrings: boolean
  public readonly validateEntrySizes: boolean
  public readonly withContent: boolean
  public readonly entryCount: number
  public readonly strictFileNames: boolean

  #entriesRead: number
  #readEntryCursor: number

  constructor(
    reader: TReader,
    centralDirectoryOffset: number,
    fileSize: number,
    entryCount: number,
    comment: string | Buffer,
    autoClose: boolean,
    decodeStrings: boolean,
    validateEntrySizes: boolean,
    strictFileNames: boolean,
    withContent: boolean
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
    this.#readEntryCursor = centralDirectoryOffset
    this.fileSize = fileSize
    this.entryCount = entryCount
    this.comment = comment
    this.#entriesRead = 0
    this.autoClose = autoClose
    this.decodeStrings = decodeStrings
    this.validateEntrySizes = validateEntrySizes
    this.strictFileNames = strictFileNames
    this.withContent = withContent
    this.isOpen = true
    this.emittedError = false
  }

  readEntry() {
    this._readEntry()
  }

  _readEntry() {
    if (this.entryCount === this.#entriesRead) {
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
      this.#readEntryCursor,
      (err: Error | null, _) => {
        if (err) return emitErrorAndAutoClose(this, err)
        if (this.emittedError) return

        const entry = this.withContent ? new EntryWithContent() : new Entry(this)
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

        this.#readEntryCursor += 46

        buffer = Buffer.allocUnsafe(
          entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength,
        )

        readAndAssertNoEof(
          this.reader,
          buffer,
          0,
          buffer.length,
          this.#readEntryCursor,
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

            this.#readEntryCursor += buffer.length
            this.#entriesRead += 1

            if (
              entry.uncompressedSize === 0xffffffff ||
              entry.compressedSize === 0xffffffff ||
              entry.relativeOffsetOfLocalHeader === 0xffffffff
            ) {
              // ZIP64 format
              // find the Zip64 Extended Information Extra Field
              let zip64EiefBuffer: Buffer | null = null
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

            if (entry instanceof Entry) {
              this.emit('entry', entry)
            } else {
              getBufferFromEntry(this, entry).then(buffer => {
                entry.content = buffer

                this.emit('entry', entry)
              }).catch(error => {
                emitErrorAndAutoClose(this, error)
              })
            }
          },
        )
      },
    )
  }

  close() {
    if (!this.isOpen) return

    this.removeAllListeners()
    this.isOpen = false
    this.reader.unref()
  }
}
