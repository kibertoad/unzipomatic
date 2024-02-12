import type { Readable, Transform } from 'stream'
import { PassThrough, Writable } from 'stream'

import { AssertByteCountStream } from './internal/AssertByteCountStream'
import { RefUnrefFilter } from './internal/RefUnrefFilter'
import EventEmitter from 'node:events'
import { FdSlicer, ReadStream } from 'better-fd-slicer'

export interface RandomAccessReaderCreateReadStream {
  start: number
  end: number
}

export interface IRandomAccessReader extends EventEmitter {
  createReadStream(options: { start?: number, end?: number }): Transform | ReadStream

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: ((error: Error | null, bytesRead: number) => void) | ((error: Error | null, bytesRead: number, buffer: Buffer) => void),
  ): void

  ref(): void;

  unref(): void;
}

export class RandomAccessReader extends EventEmitter implements IRandomAccessReader {
  private refCount: number

  constructor() {
    super()
    this.refCount = 0
  }

  ref() {
    this.refCount += 1
  }

  unref() {
    this.refCount -= 1

    if (this.refCount > 0) return
    if (this.refCount < 0) throw new Error('invalid unref')

    this.close((err?: Error) => {
      if (err) return this.emit('error', err)

      this.emit('close')
    })
  }

  createReadStream(options: RandomAccessReaderCreateReadStream): Transform {
    const start = options.start
    const end = options.end

    if (start === end) {
      const emptyStream = new PassThrough()
      setImmediate(() => {
        emptyStream.end()
      })
      return emptyStream
    }
    const stream = this._readStreamForRange(start, end)

    let destroyed = false
    const refUnrefFilter = new RefUnrefFilter(this)
    stream.on('error', (err) => {
      setImmediate(() => {
        if (!destroyed) refUnrefFilter.emit('error', err)
      })
    })
    refUnrefFilter.destroy = function(_?: Error) {
      stream.unpipe(refUnrefFilter)
      refUnrefFilter.unref()
      stream.destroy()

      return this
    }

    const byteCounter = new AssertByteCountStream(end - start)
    refUnrefFilter.on('error', (err) => {
      setImmediate(() => {
        if (!destroyed) byteCounter.emit('error', err)
      })
    })
    byteCounter.destroy = function() {
      destroyed = true
      refUnrefFilter.unpipe(byteCounter)
      refUnrefFilter.destroy()

      return this
    }

    return stream.pipe(refUnrefFilter as Writable).pipe(byteCounter)
  }

  _readStreamForRange(_start: number, _end: number): Readable {
    throw new Error('not implemented')
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | null, bytesRead: number) => void,
  ) {
    const readStream = this.createReadStream({ start: position, end: position + length })
    const writeStream = new Writable()
    let written = 0
    writeStream._write = (chunk: Buffer, encoding, cb) => {
      chunk.copy(buffer, offset + written, 0, chunk.length)
      written += chunk.length
      cb()
    }
    writeStream.on('finish', callback)
    readStream.on('error', (error: Error) => {
      callback(error, 0)
    })
    readStream.pipe(writeStream)
  }

  close(callback: () => void) {
    setImmediate(callback)
  }
}
