import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export const Vcp = {
    BRIGHTNESS: 0x10,
    CONTRAST: 0x12,
    COLOR_PRESET: 0x14,
    INPUT_SOURCE: 0x60,
    VOLUME: 0x62,
};

const hex = code => code.toString(16).padStart(2, '0');

export function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED);
}

// Concurrent ddcutil processes interfere with each other, even on
// different buses: one of them often fails with "No monitor detected".
// So every invocation, for any display, goes through one serial queue.
let queue = Promise.resolve();

function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
}

function ddcutil(args, cancellable = null, check = true) {
    return enqueue(() => run(args, cancellable, check));
}

async function run(args, cancellable, check) {
    // The task may have waited in the queue after its display went away
    cancellable?.set_error_if_cancelled();
    const proc = Gio.Subprocess.new(['ddcutil', ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (check && !proc.get_successful())
        throw new Error(`ddcutil ${args.join(' ')} failed: ${(stderr || stdout).trim()}`);
    return stdout;
}

/**
 * Parse `ddcutil detect --brief`. Blocks for monitors that do not
 * talk DDC start with "Invalid display" and are skipped.
 *
 * @param {string} stdout
 * @returns {{bus: number, number: number, connector: ?string, name: string}[]}
 */
export function parseDetect(stdout) {
    const displays = [];
    for (const block of stdout.split(/\n\s*\n/)) {
        const number = block.trim().match(/^Display (\d+)/);
        const bus = block.match(/I2C bus:\s+\/dev\/i2c-(\d+)/);
        if (!number || !bus)
            continue;
        const [mfg = '', model = ''] =
            block.match(/Monitor:\s+(.*)/)?.[1].split(':') ?? [];
        displays.push({
            bus: Number(bus[1]),
            number: Number(number[1]),
            // "card1-DP-2" -> "DP-2", the name the compositor uses
            connector: block.match(/DRM[ _]connector:\s+(?:card\d+-)?(\S+)/)?.[1] ?? null,
            name: `${mfg} ${model}`.trim() || `Display ${number[1]}`,
        });
    }
    return displays;
}

/**
 * Parse `ddcutil capabilities` into the supported features and, for
 * non-continuous ones, their allowed values.
 *
 * @param {string} stdout
 * @returns {Map<number, {name: string, values: Map<number, string>}>}
 */
export function parseCapabilities(stdout) {
    const features = new Map();
    let current = null;
    for (const line of stdout.split('\n')) {
        let match;
        if ((match = line.match(/^\s*Feature: ([0-9A-F]{2}) \((.*)\)/i))) {
            current = {name: match[2], values: new Map()};
            features.set(parseInt(match[1], 16), current);
        } else if (!current) {
            continue;
        } else if ((match = line.match(/^\s+Values: ((?:[0-9A-F]{2}\s+)+)\(interpretation unavailable\)/i))) {
            for (const value of match[1].trim().split(/\s+/))
                current.values.set(parseInt(value, 16), `0x${value.toLowerCase()}`);
        } else if ((match = line.match(/^\s+([0-9A-F]{2}): (.+)/i))) {
            const name = match[2].startsWith('Unrecognized')
                ? `0x${match[1].toLowerCase()}` : match[2].trim();
            current.values.set(parseInt(match[1], 16), name);
        }
    }
    return features;
}

/**
 * Parse `ddcutil getvcp --brief`. Some monitors report continuous
 * features as "CNC" (four raw bytes: mh ml sh sl), so both forms yield
 * a value and a maximum; `low` is the low byte, which is what
 * non-continuous features use.
 *
 * @param {string} stdout
 * @returns {Map<number, {value: number, max: number, low: number}>}
 */
export function parseVcp(stdout) {
    const values = new Map();
    for (const line of stdout.split('\n')) {
        const match = line.match(/^VCP ([0-9A-F]{2}) (C|SNC|CNC) (.+)/i);
        if (!match)
            continue;
        const code = parseInt(match[1], 16);
        const fields = match[3].trim().split(/\s+/);
        if (match[2] === 'C') {
            const [value, max] = fields.map(Number);
            values.set(code, {value, max, low: value & 0xff});
        } else if (match[2] === 'SNC') {
            const value = parseInt(fields[0].slice(1), 16);
            values.set(code, {value, max: 0xff, low: value});
        } else {
            const [mh, ml, sh, sl] = fields.map(f => parseInt(f.slice(1), 16));
            values.set(code, {value: sh << 8 | sl, max: mh << 8 | ml, low: sl});
        }
    }
    return values;
}

export class Display {
    constructor({bus, number, connector, name}) {
        this.bus = bus;
        this.number = number;
        this.connector = connector;
        this.name = name;
        this.features = new Map();

        this._cancellable = new Gio.Cancellable();
        this._pending = new Map();
    }

    _run(args, check = true) {
        return ddcutil(['--bus', `${this.bus}`, ...args], this._cancellable, check);
    }

    async loadCapabilities() {
        this.features = parseCapabilities(await this._run(['capabilities']));
    }

    supports(code) {
        return this.features.has(code);
    }

    /**
     * @param {number[]} codes
     * @returns {Promise<Map<number, {value: number, max: number, low: number}>>}
     */
    async read(codes) {
        // A single unreadable feature makes ddcutil exit non-zero while
        // still printing the others, so the exit status is not checked.
        return parseVcp(await this._run(
            ['--brief', 'getvcp', ...codes.map(hex)], false));
    }

    /**
     * Queue a write. Writes to the same feature that pile up while the
     * monitor is busy (e.g. during a slider drag) collapse into the latest.
     *
     * @param {number} code
     * @param {number} value
     */
    set(code, value) {
        const scheduled = this._pending.has(code);
        this._pending.set(code, value);
        if (scheduled)
            return;

        enqueue(() => {
            const latest = this._pending.get(code);
            this._pending.delete(code);
            return run(['--bus', `${this.bus}`, '--noverify', 'setvcp', hex(code), `${latest}`],
                this._cancellable, true);
        }).catch(e => {
            if (!isCancelled(e))
                console.error(`DDC: ${this.name}: ${e.message}`);
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._pending.clear();
    }
}

/**
 * Find all monitors that respond to DDC and load their capabilities.
 *
 * @returns {Promise<Display[]>}
 */
export async function detect() {
    const displays = parseDetect(await ddcutil(['detect', '--brief']))
        .map(info => new Display(info));

    const results = await Promise.allSettled(
        displays.map(display => display.loadCapabilities()));

    return displays.filter((display, i) => {
        if (results[i].status === 'fulfilled')
            return true;
        console.warn(`DDC: skipping ${display.name}: ${results[i].reason.message}`);
        display.destroy();
        return false;
    });
}
