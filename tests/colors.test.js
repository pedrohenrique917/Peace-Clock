// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {chooseColors, parseHex} from '../colors.js';

const view = {width: 1920, height: 1080};
const rectangles = {
    time: {x: 810, y: 454, width: 60, height: 27},
    day: {x: 810, y: 451, width: 300, height: 175},
};

function imageOf(pixel, width = 240, height = 135, channels = 3, padding = 0) {
    const rowstride = width * channels + padding;
    const pixels = new Uint8Array(rowstride * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++)
            pixels.set(pixel(x, y), y * rowstride + x * channels);
    }
    return {pixels, width, height, channels, rowstride};
}

function hsl(hex) {
    const [r, g, b] = parseHex(hex).map(c => c / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    const light = (max + min) / 2;
    let hue = delta ? max === r ? ((g - b) / delta) % 6
        : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4 : 0;
    hue = (hue / 6 + 1) % 1;
    return {hue, light, saturation: delta ? delta / (1 - Math.abs(2 * light - 1)) : 0};
}

function assertPair(pair) {
    assert.match(pair.day, /^#[0-9a-f]{6}$/);
    assert.match(pair.time, /^#[0-9a-f]{6}$/);
    const day = hsl(pair.day), time = hsl(pair.time);
    assert.ok(time.light > day.light, 'time must stay lighter than day');
    const difference = Math.abs(day.hue - time.hue);
    assert.ok(Math.min(difference, 1 - difference) < 0.02, 'pair must share a hue');
    assert.ok(Math.abs(day.saturation - time.saturation) < 0.03);
}

for (const [name, color] of [
    ['dark blue', [15, 35, 65]], ['light blue', [150, 205, 235]],
    ['green', [45, 115, 55]], ['orange', [190, 110, 55]],
    ['purple', [145, 60, 170]], ['light gray', [240, 240, 240]],
    ['dark gray', [20, 20, 20]],
]) {
    test(`a coherent tonal pair on ${name}`, () => {
        assertPair(chooseColors({image: imageOf(() => color), view, rectangles}));
    });
}

test('white clouds do not turn a blue wallpaper into a red clock', () => {
    const image = imageOf((_x, y) => y < 72 ? [80, 175, 225] : [245, 245, 245]);
    const pair = chooseColors({image, view, rectangles});
    assertPair(pair);
    const hue = hsl(pair.day).hue;
    assert.ok(hue > 0.40 && hue < 0.60, 'blue/teal family is expected');
});

test('a cloud behind the time never reverses the tonal pair', () => {
    const image = imageOf((_x, y) => y >= 53 && y <= 63
        ? [250, 250, 250] : [20, 40, 75]);
    assertPair(chooseColors({image, view, rectangles}));
});

test('RGB row padding does not alter the selected colors', () => {
    const a = imageOf(() => [70, 150, 210], 240, 135, 3, 0);
    const b = imageOf(() => [70, 150, 210], 240, 135, 3, 7);
    assert.deepEqual(chooseColors({image: a, view, rectangles}),
        chooseColors({image: b, view, rectangles}));
});

test('fully transparent colors are composited onto the desktop background', () => {
    const image = imageOf(() => [255, 0, 0, 0], 240, 135, 4);
    const options = {view, rectangles, background: '#234567'};
    assert.deepEqual(chooseColors({...options, image}), chooseColors(options));
});

test('zoom analysis ignores colored edges cropped out of the display', () => {
    const image = imageOf((x, _y) => x < 75 || x >= 165
        ? [255, 30, 20] : [50, 150, 220], 240, 80);
    const pair = chooseColors({image, view, rectangles, mode: 'zoom'});
    assert.ok(hsl(pair.day).hue > 0.40 && hsl(pair.day).hue < 0.60);
});

test('scaled image with clock on letterboxing uses the background color', () => {
    const image = imageOf(() => [255, 0, 0], 80, 240);
    const outside = {
        day: {x: 10, y: 300, width: 100, height: 100},
        time: {x: 10, y: 270, width: 60, height: 25},
    };
    const options = {image, view, rectangles: outside, mode: 'scaled'};
    const dark = chooseColors({...options, background: '#202020'});
    const light = chooseColors({...options, background: '#eeeeee'});
    assertPair(dark);
    assertPair(light);
    assert.ok(hsl(dark.day).light > hsl(light.day).light,
        'letterboxing background must influence text lightness');
});

test('time in letterboxing samples its own background while day stays on the image', () => {
    const smallView = {width: 240, height: 160};
    const labels = {
        day: {x: 100, y: 70, width: 50, height: 40},
        time: {x: 10, y: 40, width: 30, height: 20},
    };
    const image = imageOf(() => [240, 240, 240], 40, 80);
    const padded = imageOf(x => x < 40 || x >= 80
        ? [255, 255, 255] : [240, 240, 240], 120, 80);
    const options = {view: smallView, rectangles: labels, background: '#ffffff'};
    assert.deepEqual(chooseColors({...options, image, mode: 'scaled'}),
        chooseColors({...options, image: padded, mode: 'stretched'}));
});

test('a label partly outside the image includes letterboxing in its contrast', () => {
    const smallView = {width: 240, height: 160};
    const labels = {
        day: {x: 159, y: 70, width: 80, height: 40},
        time: {x: 159, y: 40, width: 60, height: 20},
    };
    const image = imageOf(() => [240, 240, 240], 40, 80);
    const padded = imageOf(x => x < 40 || x >= 80
        ? [0, 0, 0] : [240, 240, 240], 120, 80);
    const options = {view: smallView, rectangles: labels, background: '#000000'};
    assert.deepEqual(chooseColors({...options, image, mode: 'scaled'}),
        chooseColors({...options, image: padded, mode: 'stretched'}));
});

test('a small time label on an ultrawide display does not miss its background', () => {
    const largeView = {width: 7680, height: 2160};
    const labels = {
        day: {x: 3000, y: 1020, width: 300, height: 175},
        time: {x: 3000, y: 974, width: 60, height: 22},
    };
    const pixel = (_x, y) => y === 30 || y === 31
        ? [255, 255, 255] : [240, 240, 240];
    const image = imageOf(pixel, 240, 68);
    const doubled = imageOf((x, y) => pixel(Math.floor(x / 2), Math.floor(y / 2)), 480, 136);
    const options = {view: largeView, rectangles: labels, mode: 'stretched'};
    // Both images describe the same screen; neither should miss the white area
    // beneath the time just because thumbnail pixel centers fall outside it.
    assert.deepEqual(chooseColors({...options, image}),
        chooseColors({...options, image: doubled}));
});

test('unsupported modes use the documented solid-background fallback', () => {
    const options = {view, rectangles, background: '#abcdef'};
    for (const mode of ['centered', 'wallpaper', 'spanned', 'none']) {
        assert.deepEqual(chooseColors({...options, image: imageOf(() => [255, 0, 0]), mode}),
            chooseColors(options));
    }
});

test('hex parsing and invalid background fallback are deterministic', () => {
    assert.deepEqual(parseHex('#abc'), [170, 187, 204]);
    assert.deepEqual(parseHex('#ABCDEF'), [171, 205, 239]);
    assert.equal(parseHex('not-a-color'), null);
    assertPair(chooseColors({view, rectangles, background: 'invalid'}));
});
