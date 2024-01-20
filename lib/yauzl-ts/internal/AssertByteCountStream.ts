import {Transform} from "stream";

export class AssertByteCountStream extends Transform{
    private actualByteCount: number;
    private expectedByteCount: number;
    constructor(byteCount: number) {
        super();
        this.actualByteCount = 0;
        this.expectedByteCount = byteCount;
    }
    _transform(chunk: any, encoding: any, cb: any) {
        this.actualByteCount += chunk.length;
        if (this.actualByteCount > this.expectedByteCount) {
            var msg = "too many bytes in the stream. expected " + this.expectedByteCount + ". got at least " + this.actualByteCount;
            return cb(new Error(msg));
        }
        cb(null, chunk);
    };
    _flush(cb: any) {
        if (this.actualByteCount < this.expectedByteCount) {
            var msg = "not enough bytes in the stream. expected " + this.expectedByteCount + ". got only " + this.actualByteCount;
            return cb(new Error(msg));
        }
        cb();
    };
}