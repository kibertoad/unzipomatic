import { PassThrough } from 'node:stream'

import type { IRandomAccessReader } from '../RandomAccessReader'

export class RefUnrefFilter<TReader extends IRandomAccessReader> extends PassThrough {
  private readonly context: TReader
  private unreffedYet: boolean

  constructor(context: TReader) {
    super()

    this.context = context
    this.context.ref()
    this.unreffedYet = false
  }

  get refCount(): number {
    return this.context.refCount;
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
