import { dosDateTimeToDate, readAndAssertNoEofAsync } from './internal/utils'
import type { Transform } from 'node:stream'
import zlib from 'node:zlib'
import { AssertByteCountStream } from './internal/AssertByteCountStream'
import { ZipFile } from './ZipFile'

export type EntryExtraField = { id: number; data: Buffer }

export class Entry {
  public lastModFileDate!: number
  public lastModFileTime!: number
  public generalPurposeBitFlag!: number
  public compressionMethod!: number
  public compressedSize!: number
  public uncompressedSize!: number
  public relativeOffsetOfLocalHeader!: number
  public versionMadeBy!: number
  public versionNeededToExtract!: number
  public crc32!: number
  public fileNameLength!: number
  public extraFieldLength!: number
  public fileCommentLength!: number
  public internalFileAttributes!: number
  public externalFileAttributes!: number
  public fileName!: string | Buffer
  public extraFields!: EntryExtraField[]
  public fileComment!: string | Buffer
  public comment!: string | Buffer

  constructor(
    protected readonly zipFile: ZipFile,
  ) { }

  getLastModDate() {
    return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime)
  }

  isEncrypted() {
    return (this.generalPurposeBitFlag & 0x1) !== 0
  }

  isCompressed() {
    return this.compressionMethod === 8
  }

  isDirectory(): any {
    if (typeof this.fileName === 'string') {
      return this.fileName.endsWith('/')
    }

    return this.fileName[this.fileName.length - 1] === '/'.charCodeAt(0)
  }

  async getStream(): Promise<Transform> {
    const relativeStart = 0
    const relativeEnd = this.compressedSize

    // any further errors can either be caused by the zipfile,
    // or were introduced in a minor version of yauzl,
    // so should be passed to the client rather than thrown.
    if (!this.zipFile.isOpen)
      throw new Error('The content of the file can only be read while the zip file is open.')

    // make sure we don't lose the fd before we open the actual read stream
    this.zipFile.reader.ref()
    const buffer = Buffer.allocUnsafe(30)

    await readAndAssertNoEofAsync(
      this.zipFile.reader,
      buffer,
      0,
      buffer.length,
      this.relativeOffsetOfLocalHeader,
    );

    try {
      // 0 - Local file header signature = 0x04034b50
      const signature = buffer.readUInt32LE(0)

      if (signature !== 0x04034b50) {
        throw new Error(`invalid local file header signature: 0x${signature.toString(16)}`)
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
        this.relativeOffsetOfLocalHeader + buffer.length + fileNameLength + extraFieldLength

      let decompress: boolean
      if (this.compressionMethod === 0) {
        // 0 - The file is stored (no compression)
        decompress = false
      } else if (this.compressionMethod === 8) {
        // 8 - The file is Deflated
        decompress = !this.isEncrypted()
      } else {
        throw new Error(`unsupported compression method: ${this.compressionMethod}`)
      }

      const fileDataStart = localFileHeaderEnd
      const fileDataEnd = fileDataStart + this.compressedSize
      if (this.compressedSize !== 0) {
        // bounds check now, because the read streams will probably not complain loud enough.
        // since we're dealing with an unsigned offset plus an unsigned size,
        // we only have 1 thing to check for.
        if (fileDataEnd > this.zipFile.fileSize) {
          throw new Error(
            `file data overflows file bounds: ${fileDataStart} + ${this.compressedSize} > ${this.zipFile.fileSize}`,
          )
        }
      }

      const readStream = this.zipFile.reader.createReadStream({
        start: fileDataStart + relativeStart,
        end: fileDataStart + relativeEnd,
      })

      let endpointStream = readStream as Transform
      if (decompress) {
        let destroyed = false
        const inflateFilter = zlib.createInflateRaw()
        readStream.on('error', (err: Error) => {
          // setImmediate here because errors can be emitted during the first call to pipe()
          setImmediate(() => {
            if (!destroyed) inflateFilter.emit('error', err)
          })
        })
        readStream.pipe(inflateFilter)

        if (this.zipFile.validateEntrySizes) {
          endpointStream = new AssertByteCountStream(this.uncompressedSize)
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

      return endpointStream
    } finally {
      this.zipFile.reader.unref()
    }
  }

  /**
   * Get the file content as a Buffer.
   *
   * @throws {Error} If the zip file was closed.
   */
  public async getBuffer(): Promise<Buffer> {
    const stream = await this.getStream()
    const buffers: Buffer[] = []

    for await (const chunk of stream) {
      buffers.push(chunk)
    }

    return Buffer.concat(buffers)
  }
}
