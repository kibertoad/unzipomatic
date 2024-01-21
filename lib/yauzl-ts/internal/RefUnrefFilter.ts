import { PassThrough } from 'node:stream'

import type { RandomAccessReader } from '../RandomAccessReader'

export class RefUnrefFilter<TReader extends RandomAccessReader> extends PassThrough {
  private readonly context: TReader
  private unreffedYet: boolean

  constructor(context: TReader) {
    super()

    this.context = context
    this.context.ref()
    this.unreffedYet = false
  }

  _flush(cb: () => void) {
    this.unref()
    cb()
  }

  unref() {
    if (this.unreffedYet) return
    this.unreffedYet = true
    this.context.unref()
  }
}
