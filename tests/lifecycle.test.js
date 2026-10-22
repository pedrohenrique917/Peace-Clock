// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {makeShell} from './shell-harness.js';

function assertClean(shell) {
    assert.equal(shell.sources.size, 0, 'all GLib sources must be removed');
    assert.ok(shell.emitters.every(emitter => emitter.signals.size === 0));
    assert.ok(shell.monitors.every(monitor => monitor.cancelled));
    assert.ok(shell.streams.every(stream => stream.closed));
    assert.equal(shell.layout._backgroundGroup.children.length, 0);
    assert.equal(shell.clock._imageCache, null);
}

async function loadInitial(shell) {
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    await shell.finishDecode('file:///a.png');
}

test('initialization creates no Settings or Shell actors', () => {
    const shell = makeShell();
    assert.equal(shell.settings.size, 0);
    assert.equal(shell.actors.length, 1, 'only the mock background exists');
    assert.equal(shell.sources.size, 0);
});

test('enable/disable cancels queued work and cleans every connection', () => {
    const shell = makeShell();
    shell.clock.enable();
    assert.equal(shell.clock._day.text, 'tue.');
    assert.equal(shell.clock._time.text, '10:27');
    shell.clock.disable();
    assertClean(shell);
});

test('a partial enable failure destroys its newly created actors', () => {
    const shell = makeShell();
    shell.layout._backgroundGroup.failAdding = true;
    assert.throws(() => shell.clock.enable(), /Cannot add actor/);
    assert.ok(shell.actors.slice(1).every(actor => actor.destroyed));
    assertClean(shell);
});

test('decoded files are closed and cached for monitor/geometry updates', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await loadInitial(shell);
    assert.equal(shell.colorCalls.length, 1);
    assert.ok(shell.streams[0].closed);
    shell.layout.primaryMonitor = {x: 1920, y: 0, width: 2560, height: 1440};
    shell.layout.emit('monitors-changed');
    await shell.flushColors();
    assert.equal(shell.reads.length, 0, 'reuse the decoded thumbnail');
    assert.equal(shell.colorCalls.length, 2);
    assert.equal(shell.colorCalls[1].view.width, 2560);
    shell.clock.disable();
    assertClean(shell);
});

test('a wallpaper rewritten at the same path invalidates the thumbnail', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await loadInitial(shell);
    shell.monitors[0].emit('changed');
    await shell.flushColors();
    assert.equal(shell.reads.length, 1);
    await shell.finishRead('file:///a.png');
    await shell.finishDecode('file:///a.png');
    assert.equal(shell.colorCalls.length, 2);
    shell.clock.disable();
    assertClean(shell);
});

test('font/scale allocation changes resample the labels using the cached image', async () => {
    const shell = makeShell();
    shell.clock.enable();
    shell.clock._time.emit('notify::allocation');
    shell.clock._day.emit('notify::allocation');
    await loadInitial(shell);
    shell.clock._day.transformedSize = [450, 262];
    shell.clock._day.emit('notify::allocation');
    await shell.flushColors();
    assert.equal(shell.reads.length, 0, 'layout changes must reuse the thumbnail');
    assert.equal(shell.colorCalls.length, 2);
    assert.equal(shell.colorCalls[1].rectangles.day.width, 450);

    shell.clock._time.transformedSize = [80, 27];
    shell.clock._time.emit('notify::allocation');
    await shell.flushColors();
    assert.equal(shell.colorCalls[2].rectangles.time.width, 80);
    shell.clock.disable();
    assertClean(shell);
    assert.equal(shell.clock._geometryKey, null);
});

test('unchanged allocations cannot cause a color/style/layout update loop', async () => {
    const shell = makeShell();
    shell.clock.enable();
    shell.clock._day.emit('notify::allocation');
    await loadInitial(shell);
    for (let i = 0; i < 20; i++) {
        shell.clock._time.emit('notify::allocation');
        shell.clock._day.emit('notify::allocation');
    }
    assert.equal(shell.sources.size, 1, 'only the regular clock timer remains');
    assert.equal(shell.colorCalls.length, 1);
    shell.clock.disable();
    assertClean(shell);
});

test('HiDPI spacing follows the CSS scale and its listener is removed on disable', async () => {
    const shell = makeShell();
    shell.themeContext.scale_factor = 2;
    shell.clock.enable();
    assert.equal(shell.clock._box.translation_y, 30);
    assert.equal(shell.clock._day.translation_y, -60);
    await loadInitial(shell);

    shell.themeContext.scale_factor = 1;
    shell.themeContext.emit('notify::scale-factor');
    assert.equal(shell.clock._box.translation_y, 15);
    assert.equal(shell.clock._day.translation_y, -30);
    await shell.flushColors();
    assert.equal(shell.reads.length, 0);
    shell.clock.disable();
    assertClean(shell);
    assert.equal(shell.clock._themeContext, null);
});

test('old decoding work cannot update a clock that was disabled and re-enabled', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    shell.clock.disable();
    shell.clock.enable();
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    await shell.finishDecode('file:///a.png');
    assert.equal(shell.colorCalls.length, 0);
    await shell.finishDecode('file:///a.png');
    assert.equal(shell.colorCalls.length, 1);
    shell.clock.disable();
    assertClean(shell);
});

test('disable during file reading cannot update a destroyed clock', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await shell.flushColors();
    shell.clock.disable();
    await shell.finishRead('file:///a.png', new Error('Cancelled'));
    assert.equal(shell.colorCalls.length, 0);
    assert.equal(shell.warnings.length, 0);
    assertClean(shell);
});

test('disable during image decoding still closes the input stream', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    shell.clock.disable();
    await shell.finishDecode('file:///a.png');
    assert.equal(shell.colorCalls.length, 0);
    assertClean(shell);
});

test('an old wallpaper finishing last cannot overwrite the new colors', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    shell.background().values['picture-uri'] = 'file:///b.png';
    shell.background().emit('changed', 'picture-uri');
    await shell.flushColors();
    await shell.finishRead('file:///b.png');
    await shell.finishDecode('file:///b.png');
    await shell.finishDecode('file:///a.png');
    assert.equal(shell.colorCalls.length, 1);
    assert.equal(shell.clock._imageCache.uri, 'file:///b.png');
    assert.equal(shell.colorCalls[0].image.pixels[0], 20);
    shell.clock.disable();
    assertClean(shell);
});

test('decode errors use the fallback and close the stream', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await shell.flushColors();
    await shell.finishRead('file:///a.png');
    await shell.finishDecode('file:///a.png', new Error('Unsupported XML background'));
    assert.equal(shell.colorCalls.length, 1);
    assert.equal(shell.colorCalls[0].image, null);
    assert.equal(shell.warnings.length, 1);
    shell.clock.disable();
    assertClean(shell);
});

test('dark mode selects picture-uri-dark rather than a stale cached image', async () => {
    const shell = makeShell();
    shell.clock.enable();
    await loadInitial(shell);
    shell.interface().values['color-scheme'] = 'prefer-dark';
    shell.interface().emit('changed::color-scheme');
    await shell.flushColors();
    assert.equal(shell.reads[0].file.uri, 'file:///dark.png');
    await shell.finishRead('file:///dark.png');
    await shell.finishDecode('file:///dark.png');
    shell.clock.disable();
    assertClean(shell);
});

test('remote and unsupported backgrounds do not start file or network reads', async () => {
    for (const [uri, mode] of [['https://example.invalid/image.png', 'zoom'], ['file:///a.png', 'spanned']]) {
        const shell = makeShell();
        shell.clock.enable();
        shell.background().values['picture-uri'] = uri;
        shell.background().values['picture-options'] = mode;
        await shell.flushColors();
        assert.equal(shell.reads.length, 0);
        assert.equal(shell.monitors.length, 0);
        assert.equal(shell.colorCalls[0].image, null);
        shell.clock.disable();
        assertClean(shell);
    }
});

test('a temporarily absent primary monitor is handled without image reads', async () => {
    const shell = makeShell();
    shell.layout.primaryMonitor = null;
    shell.clock.enable();
    assert.equal(shell.clock._container.visible, false);
    await shell.flushColors();
    assert.equal(shell.reads.length, 0);
    shell.clock.disable();
    assertClean(shell);
});

test('repeated enable/disable cycles leave no retained resources', async () => {
    const shell = makeShell();
    for (let i = 0; i < 10; i++) {
        shell.clock.enable();
        await loadInitial(shell);
        shell.clock.disable();
        assertClean(shell);
    }
});
