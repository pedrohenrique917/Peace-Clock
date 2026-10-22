// SPDX-License-Identifier: GPL-3.0-or-later
// These mocks exercise resource lifetime and async races, not Shell rendering.
import {readFileSync} from 'node:fs';

export function makeShell() {
    let nextId = 1;
    const sources = new Map();
    const emitters = [];
    const actors = [];
    const settings = new Map();
    const files = new Map();
    const reads = [];
    const decodes = [];
    const streams = [];
    const monitors = [];
    const colorCalls = [];
    const warnings = [];

    class Emitter {
        constructor() {
            this.signals = new Map();
            emitters.push(this);
        }
        connect(signal, callback) {
            const id = nextId++;
            this.signals.set(id, {signal, callback});
            return id;
        }
        disconnect(id) {
            if (!this.signals.delete(id))
                throw new Error(`Unknown signal ${id}`);
        }
        emit(signal, ...args) {
            for (const value of [...this.signals.values()]) {
                if (value.signal === signal)
                    value.callback(this, ...args);
            }
        }
    }

    class Actor extends Emitter {
        constructor(properties = {}) {
            super();
            Object.assign(this, properties);
            this.children = [];
            this.text = '';
            actors.push(this);
        }
        add_child(child) {
            if (this.failAdding)
                throw new Error('Cannot add actor');
            this.children.push(child);
            child.parent = this;
        }
        destroy() {
            this.destroyed = true;
            for (const child of [...this.children])
                child.destroy();
            this.children = [];
            if (this.parent)
                this.parent.children = this.parent.children.filter(child => child !== this);
        }
        set_position(x, y) { this.position = [x, y]; }
        set_size(width, height) { this.size = [width, height]; }
        set_style(style) {
            if (this.destroyed)
                throw new Error('Styled destroyed actor');
            this.style = style;
        }
        show() { this.visible = true; }
        hide() { this.visible = false; }
        get_transformed_position() {
            if (this.transformedPosition)
                return this.transformedPosition;
            return this.style_class === 'peace-clock-time' ? [810, 454] : [810, 451];
        }
        get_transformed_size() {
            if (this.transformedSize)
                return this.transformedSize;
            return this.style_class === 'peace-clock-time' ? [60, 27] : [300, 175];
        }
        get_preferred_width() { return this.style_class === 'peace-clock-time' ? [60, 60] : [300, 300]; }
        get_preferred_height() { return this.style_class === 'peace-clock-time' ? [27, 27] : [175, 175]; }
    }

    class Settings extends Emitter {
        constructor({schema_id: schema}) {
            super();
            this.values = schema.endsWith('.background') ? {
                'picture-uri': 'file:///a.png',
                'picture-uri-dark': 'file:///dark.png',
                'picture-options': 'zoom',
                'primary-color': '#282828',
            } : {'color-scheme': 'default'};
            settings.set(schema, this);
        }
        get_string(key) { return this.values[key] || ''; }
    }

    class Stream {
        constructor(uri) { this.uri = uri; streams.push(this); }
        close_async(_priority, _cancellable, callback) { callback(this, {}); }
        close_finish() { this.closed = true; }
    }

    class File extends Emitter {
        constructor(uri) { super(); this.uri = uri; }
        get_uri() { return this.uri; }
        is_native() { return this.uri.startsWith('file:'); }
        read_async(_priority, cancellable, callback) {
            reads.push({file: this, cancellable, callback});
        }
        read_finish(result) {
            if (result.error)
                throw result.error;
            return new Stream(this.uri);
        }
        monitor_file() {
            const monitor = new Emitter();
            monitor.uri = this.uri;
            monitor.cancel = () => { monitor.cancelled = true; };
            monitors.push(monitor);
            return monitor;
        }
    }

    const Gio = {
        Settings,
        File: {new_for_uri(uri) {
            if (!files.has(uri))
                files.set(uri, new File(uri));
            return files.get(uri);
        }},
        FileMonitorFlags: {NONE: 0},
        Cancellable: class {
            cancel() { this.cancelled = true; }
            is_cancelled() { return Boolean(this.cancelled); }
        },
    };
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
        Source: {remove(id) {
            if (!sources.delete(id))
                throw new Error(`Unknown source ${id}`);
        }},
        timeout_add(_priority, delay, callback) {
            const id = nextId++;
            sources.set(id, {delay, callback});
            return id;
        },
        timeout_add_seconds(priority, seconds, callback) {
            return GLib.timeout_add(priority, seconds * 1000, callback);
        },
        DateTime: {new_now_local: () => ({
            format: () => '10:27',
            get_day_of_week: () => 2,
        })},
    };
    const GdkPixbuf = {Pixbuf: {
        new_from_stream_at_scale_async(stream, _w, _h, _aspect, cancellable, callback) {
            decodes.push({stream, cancellable, callback});
        },
        new_from_stream_finish(result) {
            if (result.error)
                throw result.error;
            return result.pixbuf;
        },
    }};
    const layout = new Emitter();
    layout.primaryMonitor = {x: 0, y: 0, width: 1920, height: 1080};
    layout._backgroundGroup = new Actor();
    const Main = {layoutManager: layout};
    const Clutter = {
        ActorAlign: {CENTER: 'center', START: 'start'},
        Orientation: {VERTICAL: 'vertical'},
        BinLayout: class {},
    };
    const themeContext = new Emitter();
    themeContext.scale_factor = 1;
    const St = {
        Widget: Actor, BoxLayout: Actor, Label: Actor,
        ThemeContext: {get_for_stage: () => themeContext},
    };
    const chooseColors = options => {
        colorCalls.push(options);
        return {day: '#123456', time: '#56789a'};
    };
    const source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export default class PeaceClock', 'return class PeaceClock');
    const Clock = new Function('Clutter', 'Gio', 'GdkPixbuf', 'GLib', 'St', 'Main', 'global',
        'Extension', 'chooseColors', 'console', source)(
        Clutter, Gio, GdkPixbuf, GLib, St, Main, {stage: {}},
        class {uuid = 'relogio-desktop@local';}, chooseColors,
        {warn: message => warnings.push(message)});

    const settle = () => new Promise(resolve => setImmediate(resolve));
    return {
        clock: new Clock(), sources, settings, reads, decodes, streams, monitors,
        actors, emitters, layout, themeContext, colorCalls, warnings, settle,
        background: () => settings.get('org.gnome.desktop.background'),
        interface: () => settings.get('org.gnome.desktop.interface'),
        async flushColors() {
            const entry = [...sources].find(([_id, value]) => value.delay === 150);
            if (!entry)
                throw new Error('No queued color update');
            const [id, value] = entry;
            if (!value.callback())
                sources.delete(id);
            await settle();
        },
        async finishRead(uri, error = null) {
            const index = reads.findIndex(read => read.file.uri === uri);
            if (index < 0)
                throw new Error(`No read for ${uri}`);
            const [read] = reads.splice(index, 1);
            read.callback(read.file, {error});
            await settle();
        },
        async finishDecode(uri, error = null) {
            const index = decodes.findIndex(decode => decode.stream.uri === uri);
            if (index < 0)
                throw new Error(`No decode for ${uri}`);
            const [decode] = decodes.splice(index, 1);
            const marker = uri.includes('a.png') ? 10 : 20;
            decode.callback(null, {error, pixbuf: {
                get_pixels: () => new Uint8Array([marker, marker, marker]),
                get_width: () => 1, get_height: () => 1,
                get_n_channels: () => 3, get_rowstride: () => 3,
            }});
            await settle();
        },
    };
}
