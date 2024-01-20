import { PassThrough } from "node:stream";

export class RefUnrefFilter extends PassThrough{
    private readonly context: any;
    private unreffedYet: boolean;

    constructor(context: any) {
        super();
        this.context = context;
        this.context.ref();
        this.unreffedYet = false;
    }

    _flush(cb: any) {
        this.unref();
        cb();
    }

    unref() {
        if (this.unreffedYet) return;
        this.unreffedYet = true;
        this.context.unref();
    }
}