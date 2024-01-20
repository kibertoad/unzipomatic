const cp437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function emitErrorAndAutoClose(self: any, err: Error) {
    if (self.autoClose) self.close();
    emitError(self, err);
}

export function emitError(self: any, err: Error) {
    if (self.emittedError) return;
    self.emittedError = true;
    self.emit("error", err);
}


export function dosDateTimeToDate(date: number, time: number) {
    var day = date & 0x1f; // 1-31
    var month = (date >> 5 & 0xf) - 1; // 1-12, 0-11
    var year = (date >> 9 & 0x7f) + 1980; // 0-128, 1980-2108

    var millisecond = 0;
    var second = (time & 0x1f) * 2; // 0-29, 0-58 (even numbers)
    var minute = time >> 5 & 0x3f; // 0-59
    var hour = time >> 11 & 0x1f; // 0-23

    return new Date(year, month, day, hour, minute, second, millisecond);
}


export function readAndAssertNoEof(reader: any, buffer: Buffer, offset: number, length: number, position: number, callback: any) {
    if (length === 0) {
        // fs.read will throw an out-of-bounds error if you try to read 0 bytes from a 0 byte file
        return setImmediate(function() { callback(null, Buffer.allocUnsafe(0)); });
    }
    reader.read(buffer, offset, length, position, function(err: Error | undefined, bytesRead: number) {
        if (err) return callback(err);
        if (bytesRead < length) {
            return callback(new Error("unexpected EOF"));
        }
        callback();
    });
}


export function decodeBuffer(buffer: Buffer, start: number, end: number, isUtf8: boolean) {
    if (isUtf8) {
        return buffer.toString("utf8", start, end);
    } else {
        var result = "";
        for (var i = start; i < end; i++) {
            result += cp437[buffer[i]];
        }
        return result;
    }
}


export function readUInt64LE(buffer: Buffer, offset: number) {
    // there is no native function for this, because we can't actually store 64-bit integers precisely.
    // after 53 bits, JavaScript's Number type (IEEE 754 double) can't store individual integers anymore.
    // but since 53 bits is a whole lot more than 32 bits, we do our best anyway.
    var lower32 = buffer.readUInt32LE(offset);
    var upper32 = buffer.readUInt32LE(offset + 4);
    // we can't use bitshifting here, because JavaScript bitshifting only works on 32-bit integers.
    return upper32 * 0x100000000 + lower32;
    // as long as we're bounds checking the result of this function against the total file size,
    // we'll catch any overflow errors, because we already made sure the total file size was within reason.
}

export function defaultCallback(err?: Error) {
    if (err) throw err;
}