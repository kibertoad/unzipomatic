import type { TransformCallback } from 'stream';
import { Transform } from 'stream'

export class AssertByteCountStream extends Transform {
  private actualByteCount: number
  private readonly expectedByteCount: number

  constructor(byteCount: number) {
    super()

    this.actualByteCount = 0
    this.expectedByteCount = byteCount
  }
  _transform(chunk: Buffer, encoding: BufferEncoding, cb: TransformCallback) {
    this.actualByteCount += chunk.length
    if (this.actualByteCount > this.expectedByteCount) {
      const msg =
        'too many bytes in the stream. expected ' +
        this.expectedByteCount +
        '. got at least ' +
        this.actualByteCount
      return cb(new Error(msg))
    }
    cb(null, chunk)
  }

  _flush(cb: TransformCallback) {
    if (this.actualByteCount < this.expectedByteCount) {
      const msg =
        'not enough bytes in the stream. expected ' +
        this.expectedByteCount +
        '. got only ' +
        this.actualByteCount
      return cb(new Error(msg))
    }

    cb()
  }
}
