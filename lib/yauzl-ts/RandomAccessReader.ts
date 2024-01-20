import EventEmitter from "node:events";
import {PassThrough, Readable, Writable} from "stream";
import {RefUnrefFilter} from "./internal/RefUnrefFilter";
import {AssertByteCountStream} from "./internal/AssertByteCountStream";

export class RandomAccessReader extends EventEmitter {
    private refCount: number;

    constructor() {
        super();
        this.refCount = 0;
    }

    ref() {
        this.refCount += 1;
    };

    unref() {
        var self = this;
        self.refCount -= 1;

        if (self.refCount > 0) return;
        if (self.refCount < 0) throw new Error("invalid unref");

        self.close(onCloseDone);

        function onCloseDone(err?: Error) {
            if (err) return self.emit('error', err);
            self.emit('close');
        }
    };

    createReadStream(options: any) {
        var start = options.start;
        var end = options.end;
        if (start === end) {
            var emptyStream = new PassThrough();
            setImmediate(function () {
                emptyStream.end();
            });
            return emptyStream;
        }
        var stream = this._readStreamForRange(start, end);

        var destroyed = false;
        var refUnrefFilter = new RefUnrefFilter(this);
        stream.on("error", function (err) {
            setImmediate(function () {
                if (!destroyed) refUnrefFilter.emit("error", err);
            });
        });
        refUnrefFilter.destroy = function () {
            stream.unpipe(refUnrefFilter);
            refUnrefFilter.unref();
            stream.destroy();
        };

        var byteCounter = new AssertByteCountStream(end - start);
        refUnrefFilter.on("error", function (err) {
            setImmediate(function () {
                if (!destroyed) byteCounter.emit("error", err);
            });
        });
        byteCounter.destroy = function () {
            destroyed = true;
            refUnrefFilter.unpipe(byteCounter);
            refUnrefFilter.destroy();
        };

        return stream.pipe(refUnrefFilter).pipe(byteCounter);
    };

    _readStreamForRange(start, end): Readable {
        throw new Error("not implemented");
    };

    read(buffer: Buffer, offset: number, length: number, position: number, callback: any) {
        var readStream = this.createReadStream({start: position, end: position + length});
        var writeStream = new Writable();
        var written = 0;
        writeStream._write = function (chunk, encoding, cb) {
            chunk.copy(buffer, offset + written, 0, chunk.length);
            written += chunk.length;
            cb();
        };
        writeStream.on("finish", callback);
        readStream.on("error", function (error?: Error) {
            callback(error);
        });
        readStream.pipe(writeStream);
    };

    close(callback: any) {
        setImmediate(callback);
    };
}