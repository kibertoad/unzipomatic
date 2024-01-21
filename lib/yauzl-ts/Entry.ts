import { dosDateTimeToDate } from './internal/utils'

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
  public extraFields!: { id: number, data: Buffer }[]
  public fileComment!: string | Buffer
  public comment!: string | Buffer

  getLastModDate() {
    return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime)
  }

  isEncrypted() {
    return (this.generalPurposeBitFlag & 0x1) !== 0
  }

  isCompressed() {
    return this.compressionMethod === 8
  }
}
