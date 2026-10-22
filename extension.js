// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {chooseColors} from './colors.js';

const BACKGROUND_KEYS = [
    'picture-uri', 'picture-uri-dark', 'picture-options',
    'primary-color', 'secondary-color', 'color-shading-type',
];
const WEEKDAYS = ['mon.', 'tue.', 'wed.', 'thu.', 'fri.', 'sat.', 'sun.'];

async function readImage(file, cancellable) {
    const stream = await new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                resolve(source.read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
    try {
        return await new Promise((resolve, reject) => {
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, 240, 240, true, cancellable, (_source, result) => {
                    try {
                        resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    } finally {
        // Closing is deliberately not cancelled when the extension is disabled.
        await new Promise((resolve, reject) => {
            stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    source.close_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}

export default class PeaceClock extends Extension {
    enable() {
        this._enabled = true;
        this._request = (this._request || 0) + 1;
        this._connections = [];

        try {
            this._container = new St.Widget({
                reactive: false,
                layout_manager: new Clutter.BinLayout(),
            });
            this._box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                reactive: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                translation_y: 15,
            });
            this._time = new St.Label({
                style_class: 'peace-clock-time',
                x_align: Clutter.ActorAlign.START,
            });
            this._day = new St.Label({
                style_class: 'peace-clock-day',
                x_align: Clutter.ActorAlign.START,
                translation_y: -30,
            });
            this._box.add_child(this._time);
            this._box.add_child(this._day);
            this._container.add_child(this._box);

            // GNOME Shell's private background group keeps the clock behind
            // windows. Compatibility is intentionally limited to Shell 50.
            Main.layoutManager._backgroundGroup.add_child(this._container);

            this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._connect(this._themeContext, 'notify::scale-factor', () => this._syncScale());
            this._connect(this._background, 'changed', (_settings, key) => {
                if (BACKGROUND_KEYS.includes(key))
                    this._queueColors(key === 'picture-uri' || key === 'picture-uri-dark');
            });
            this._connect(this._interface, 'changed::color-scheme', () => this._queueColors());
            this._connect(Main.layoutManager, 'monitors-changed', () => {
                this._position();
                this._queueColors();
            });
            // Font/scale changes and proportional time digits can resize the
            // labels without changing the monitor. Resample their new area.
            this._connect(this._time, 'notify::allocation', () => this._queueGeometryColors());
            this._connect(this._day, 'notify::allocation', () => this._queueGeometryColors());
            this._syncScale();
            this._position();
            this._updateClock();
            this._clockSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
                this._updateClock();
                return GLib.SOURCE_CONTINUE;
            });
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _connect(object, signal, callback) {
        this._connections.push([object, object.connect(signal, callback)]);
    }

    _position() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) {
            this._container.hide();
            return;
        }
        this._container.set_position(monitor.x, monitor.y);
        this._container.set_size(monitor.width, monitor.height);
        this._container.show();
    }

    _syncScale() {
        // St scales CSS pixels, while Clutter translations use actor units.
        // Match those units so the close spacing survives a HiDPI change.
        const scale = this._themeContext.scale_factor;
        this._box.translation_y = 15 * scale;
        this._day.translation_y = -30 * scale;
        this._queueColors();
    }

    _updateClock() {
        const now = GLib.DateTime.new_now_local();
        const time = now.format('%H:%M');
        const day = WEEKDAYS[now.get_day_of_week() - 1];
        if (this._time.text !== time)
            this._time.text = time;
        if (this._day.text !== day) {
            this._day.text = day;
            this._queueColors();
        }
    }

    _removeSource(property) {
        if (this[property])
            GLib.Source.remove(this[property]);
        this[property] = 0;
    }

    _queueGeometryColors() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._enabled || !monitor)
            return;
        const {day, time} = this._geometry(monitor);
        const key = [day.x, day.y, day.width, day.height,
            time.x, time.y, time.width, time.height]
            .map(value => Math.round(value * 100) / 100).join(',');
        // Color styles may trigger layout notifications themselves; only
        // actual geometry changes should schedule another color calculation.
        if (key === this._geometryKey)
            return;
        this._geometryKey = key;
        this._queueColors();
    }

    _queueColors(reload = false) {
        if (!this._enabled)
            return;
        this._request++;
        this._cancellable?.cancel();
        if (reload)
            this._imageCache = null;
        this._removeSource('_colorSource');
        // Debounce settings/file changes and let the initial layout settle.
        this._colorSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._colorSource = 0;
            void this._refreshColors(this._request).catch(error => this._reportError('refresh', error));
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearFileMonitor() {
        if (this._fileMonitor) {
            if (this._fileSignal)
                this._fileMonitor.disconnect(this._fileSignal);
            this._fileMonitor.cancel();
        }
        this._fileMonitor = null;
        this._fileSignal = 0;
        this._watchedUri = null;
    }

    _watchFile(file) {
        const uri = file?.get_uri() || null;
        if (uri === this._watchedUri)
            return;
        this._clearFileMonitor();
        if (!file)
            return;
        this._watchedUri = uri;
        try {
            this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileSignal = this._fileMonitor.connect('changed', () => this._queueColors(true));
        } catch (error) {
            // A read-only/unmonitorable file can still be used as a wallpaper.
            this._reportError(`monitor:${uri}`, error);
        }
    }

    _reportError(key, error) {
        if (this._enabled && key !== this._lastError) {
            this._lastError = key;
            console.warn(`${this.uuid}: ${error.message}`);
        }
    }

    _geometry(monitor) {
        const rectangle = actor => {
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            return {x: x - monitor.x, y: y - monitor.y, width, height};
        };
        let time = rectangle(this._time);
        let day = rectangle(this._day);
        if (time.width <= 0 || day.width <= 0) {
            // Before the first allocation use the same centered layout math.
            const dw = this._day.get_preferred_width(-1)[1];
            const dh = this._day.get_preferred_height(dw)[1];
            const tw = this._time.get_preferred_width(-1)[1];
            const th = this._time.get_preferred_height(tw)[1];
            const top = (monitor.height - dh - th) / 2 + this._box.translation_y;
            time = {x: (monitor.width - dw) / 2, y: top, width: tw, height: th};
            day = {x: time.x, y: top + th + this._day.translation_y, width: dw, height: dh};
        }
        return {day, time};
    }

    _applyColors(image, mode, background) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._enabled || !monitor)
            return;
        const colors = chooseColors({
            image,
            view: {width: monitor.width, height: monitor.height},
            rectangles: this._geometry(monitor),
            mode, background,
        });
        this._day.set_style(`color: ${colors.day};`);
        this._time.set_style(`color: ${colors.time};`);
    }

    async _refreshColors(request) {
        if (!this._enabled || request !== this._request || !Main.layoutManager.primaryMonitor)
            return;
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const uri = this._background.get_string(dark ? 'picture-uri-dark' : 'picture-uri') ||
            this._background.get_string('picture-uri');
        const mode = this._background.get_string('picture-options');
        const background = this._background.get_string('primary-color');
        const supported = ['zoom', 'scaled', 'stretched'].includes(mode);
        const file = uri && supported ? Gio.File.new_for_uri(uri) : null;
        const nativeFile = file?.is_native() ? file : null;
        this._watchFile(nativeFile);
        if (!nativeFile) {
            this._imageCache = null;
            this._applyColors(null, mode, background);
            return;
        }
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        try {
            let pixbuf = this._imageCache?.uri === uri ? this._imageCache.pixbuf : null;
            if (!pixbuf) {
                pixbuf = await readImage(nativeFile, cancellable);
                if (!this._enabled || request !== this._request || cancellable.is_cancelled())
                    return;
                this._imageCache = {uri, pixbuf};
            }
            this._applyColors({
                pixels: pixbuf.get_pixels(),
                width: pixbuf.get_width(),
                height: pixbuf.get_height(),
                channels: pixbuf.get_n_channels(),
                rowstride: pixbuf.get_rowstride(),
            }, mode, background);
            this._lastError = null;
        } catch (error) {
            if (this._enabled && request === this._request && !cancellable.is_cancelled()) {
                this._applyColors(null, mode, background);
                this._reportError(`image:${uri}`, error);
            }
        } finally {
            if (this._cancellable === cancellable)
                this._cancellable = null;
        }
    }

    disable() {
        this._enabled = false;
        this._request = (this._request || 0) + 1;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._removeSource('_clockSource');
        this._removeSource('_colorSource');
        this._clearFileMonitor();
        for (const [object, signal] of this._connections || [])
            object.disconnect(signal);
        this._connections = null;
        this._container?.destroy();
        this._container = null;
        this._box = null;
        this._time = null;
        this._day = null;
        this._background = null;
        this._interface = null;
        this._themeContext = null;
        this._imageCache = null;
        this._geometryKey = null;
        this._lastError = null;
    }
}
