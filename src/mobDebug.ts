import { Server, Socket } from "node:net";
import EventEmitter from "node:events";
import { normalize } from "node:path";

type BreakPoint = {
    file: string;
    line: number;
    watch_idx: undefined
};

type WatchIdx = number;

type WatchPoint = {
    file: string;
    line: number;
    watch_idx: WatchIdx;
}

type StopPoint = BreakPoint | WatchPoint

type StackTrace = any

type StackOpts = {
    nocode?: boolean,
    sparse?: boolean,
    maxlevel?: number,
}

interface Debbugger {
    on(ev: "output", handler: (stream: string, msg: string) => any): Debbugger;
    step(): Promise<StopPoint>;
    run(): Promise<StopPoint>;
    out(): Promise<StopPoint>;
    delallb(): Promise<void>;
    over(): Promise<StopPoint>;
    exit(): Promise<StopPoint>;
    stack(opts?: StackOpts): Promise<StackTrace>;
    suspend();
    eval(expr: string): Promise<any>;
    setb(brk: BreakPoint): Promise<void>;
    delb(brk: BreakPoint): Promise<void>;
    setw(expr: string): Promise<WatchIdx>;
    delw(idx: WatchIdx): Promise<void>;
    output(stream: "stdout", mode: "d" | "c" | "r"): Promise<void>;
    get basedir(): string
    setbasedir(dir: string, remote?: string): Promise<void>
}

class MobDebugger extends EventEmitter implements Debbugger {
    liner: SocketLiner;
    _basedir: string

    constructor(sock: Socket) {
        super();
        this.liner = new SocketLiner(sock);
        this._basedir = "";
    }
    suspend() {
        this._write(`SUSPEND\n`)
    }
    async stack(opts?: StackOpts): Promise<StackTrace> {
        this._write(`STACK\n`)
        const resp = await this._line()
        
        return {}
    }
    async eval(expr: string): Promise<any> {
        //TODO
        return "";
    }
    async delallb(): Promise<void> {
        this._write(`DELB * 0\n`)
        if (getCode(await this._line()) != 200) {
            throw Error(`Could not delete all breakpoints`)
        }
    }
    async setb(brk: BreakPoint): Promise<void> {
        this._write(`SETB ${removeBase(brk.file, this._basedir)} ${brk.line}\n`)
        if (getCode(await this._line()) != 200) {
            throw Error(`Could not set breakpoint`)
        }
    }
    async delb(brk: BreakPoint): Promise<void> {
        this._write(`DELB ${removeBase(brk.file, this._basedir)} ${brk.line}\n`)
        if (getCode(await this._line()) != 200) {
            throw Error(`Could not delete breakpoint`)
        }
    }
    async setw(expr: string): Promise<WatchIdx> {
        this._write(`SETW ${expr}\n`);
        const resp = await this._line();
        var [_, _idx] = /^200 OK (\d+)\s*$/.exec(resp) ?? []
        var idx = parseInt(_idx)
        if (isNaN(idx)) {
            var [_, size] = /^401 Error in Expression (\d+)$/.exec(resp) ?? []
            var sz = parseInt(size)
            if (isNaN(sz)) {
                throw new Error("Unkown error setting watch")
            } else {
                throw new Error(`Error in watch expression: ${await this.liner.read(sz)}`)
            }
        } else {
            return idx
        }
    }
    async delw(idx: WatchIdx): Promise<void> {
        this._write(`DELW ${idx}\n`);
        if (getCode(await this._line()) != 200) {
            throw Error(`Could not delete watch`)
        }
    }
    async output(stream: "stdout", mode: "d" | "c" | "r"): Promise<void> {
        this._write(`OUTPUT ${stream} ${mode}\n`);
        if (getCode(await this._line()) != 200) {
            throw Error("Unknown error while redirecting")
        }
    }
    get basedir() {
        return this._basedir
    }
    async setbasedir(dir: string, remoteDir?: string): Promise<void> {
        var pending = sanitizeDir(dir);
        this._write(`BASEDIR ${remoteDir ? sanitizeDir(remoteDir) : pending}\n`)
        if (getCode(await this._line()) != 200) {
            throw Error("Unknown error while setting basedir")
        } else {
            this._basedir = pending
        }
    }
    step() {
        return this._untilBrk("STEP\n");
    }
    run() {
        return this._untilBrk("RUN\n");
    }
    out() {
        return this._untilBrk("OUT\n");
    }
    over() {
        return this._untilBrk("OVER\n");
    }
    exit() {
        return this._untilBrk("EXIT\n");
    }
    _line() {
        return this.liner.readLine()
    }
    _write(msg: string) {
        this.liner.write(msg)
    }
    async _untilBrk(cmd: string) : Promise<BreakPoint> {
        this._write(cmd);
        await this._line();
        while (true) {
            const brk = await this._line();
            const code = getCode(brk);
            if (code == 200) {
                throw new Error(`Debugging done`);
            } else if (code == 202) {
                return parseBreak(brk, false);
            } else if (code == 203) {
                return parseBreak(brk, true);
            } else if (code == 204) {
                const [_, stream, size] = /^204 Output (\w+) (\d+)$/.exec(brk) ?? [];
                if (stream && size) {
                    const msg = await this.liner.read(parseInt(size));
                    this.emit("output", stream, msg);
                } else {
                    throw new Error(`Debugging done`);
                }
            } else if (code == 401) {
                const [_, size] = checkArr(/^401 Error in Execution (\d+)$/.exec(brk), "Could not parse error");
                const msg = await this.liner.read(parseInt(size));
                throw new Error(`Error in remote app": ${msg}`);
            } else {
                throw new Error("Unknown Error");
            }
        }
    }
}

function removeBase(path: string, base: string) {
    var temp = sanitizeFile(path)
    if (temp.startsWith(base)) {
        return temp.substring(base.length)
    } else {
        return path
    }
}

function sanitizeFile(path: string) {
    return new String(path).toLowerCase().replaceAll("\\", "/");
}

function sanitizeDir(dir: string) {
    var temp = sanitizeFile(dir)
    return temp.endsWith("/") ? temp : temp + "/"
}

function checkArr(arr: string[] | null, errMsg: string) {
    if (!arr) throw new Error(errMsg);
    return arr;
}

function getCode(resp: string): number {
    const res = /^(\d+)/.exec(resp);
    if (!res) throw Error("Could not parse responce code");
    const [_, r] = res;
    return parseInt(r);
}

function parseBreak(brk: string, watch: boolean): BreakPoint {
    const [_, file, line, idx] = watch
        ? checkArr(
            /^203 Paused\s+(.-)\s+(\d+)\s+(\d+)\s*$/.exec(brk),
            "Invalid breakpoint responce",
        )
        : checkArr(
            /^202 Paused\s+(.+)\s+(\d+)\s*$/.exec(brk),
            "Invalid watch responce",
        );
    return <BreakPoint> {
        file: file,
        line: parseInt(line),
        watch_idx: watch ? parseInt(idx) : undefined,
    };
}

async function startMobdebug(
    host: string,
    port: number = 8172,
): Promise<Debbugger> {
    return new Promise(r => {
        var srv = new Server((sock) => {
            r(new MobDebugger(sock));
        });
        srv.maxConnections = 1
        srv.listen(port, host);
    });
}

type StringRes = (msg: string) => any;

class SocketLiner {
    sock: Socket;
    _backlog: string;
    _reqs: [{
        type: "read",
        size: number,
        res: StringRes,
        rej: CallableFunction,
    } | {
        type: "line",
        res: StringRes,
        rej: CallableFunction,
    }]
    
    constructor(sock: Socket) {
        this.sock = sock;
        this._backlog = ""
        this._reqs = [] as any
        sock.on("data", (data) => {
            this._backlog += data
            if (!this._reqs.length) return;
            const req = this._reqs.at(0)!;
            var res;
            if (req.type == "line") {
                const n = this._backlog.indexOf("\n");
                if (n == -1) return;
                res = this._backlog.substring(0, n);
                this._backlog = this._backlog.substring(n + 1);
                req.res(res)
            } else if (req.type == "read") {
                if (this._backlog.length < req.size) return;
                res = this._backlog.substring(0, req.size + 1);
                this._backlog = this._backlog.substring(req.size + 1);
            }
            req.res(res)
            this._reqs.shift();
        })
        sock.on("close", () => {
            this._reqs.forEach(r => {
                r.rej(new Error("Socket closed"))
            })
        })
    }
    write(msg: string) {
        this.sock.write(msg);
    }
    read(count: number) {
        if (this._backlog.length >= count) {
            const res = this._backlog.substring(0, count + 1);
            this._backlog = this._backlog.substring(count + 1);
            return Promise.resolve(res);
        } else {
            return new Promise((res, rej) => {
                this._reqs.push({
                    type: "read",
                    size: count,
                    res: res,
                    rej: rej,
                })
            })
        }
    }
    readLine(): Promise<string> {
        var n = this._backlog.indexOf("\n");
        if (n == -1) {
            return new Promise((res, rej) => {
                this._reqs.push({
                    type: "line",
                    res: res,
                    rej: rej,
                })
            })
        } else {
            const res = this._backlog.substring(0, n);
            this._backlog = this._backlog.substring(n + 1);
            return Promise.resolve(res);
        }
    }
}

const mob = await startMobdebug("0.0.0.0");
mob.on("output", (stream, msg) => {
    console.log(`Msg on ${stream} => ${msg}`)
})
await mob.step()
await mob.output("stdout", "d")
while (true) {
    const brk = await mob.step();
    console.log(brk);
    await mob.stack()
    await new Promise((r) => setTimeout(r, 1000));
}
