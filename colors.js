// SPDX-License-Identifier: GPL-3.0-or-later

// Gruvbox-inspired colors. These static arrays contain no Shell objects.
const FAMILIES = [
    ['#fb4934', '#cc241d', '#9d0006'],
    ['#fe8019', '#d65d0e', '#af3a03'],
    ['#fabd2f', '#d79921', '#b57614'],
    ['#b8bb26', '#98971a', '#79740e'],
    ['#8ec07c', '#689d6a', '#427b58'],
    ['#83a598', '#458588', '#076678'],
    ['#d3869b', '#b16286', '#8f3f71'],
];
const NEUTRALS = [
    '#fbf1c7', '#ebdbb2', '#d5c4a1', '#bdae93', '#928374',
    '#665c54', '#504945', '#3c3836', '#282828',
];

export function parseHex(hex) {
    if (typeof hex !== 'string')
        return null;
    if (/^#[\da-f]{3}$/i.test(hex))
        hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
    if (!/^#[\da-f]{6}$/i.test(hex))
        return null;
    return [1, 3, 5].map(p => parseInt(hex.slice(p, p + 2), 16));
}

function toHex(rgb) {
    return '#' + rgb.map(c => Math.round(Math.max(0, Math.min(255, c)))
        .toString(16).padStart(2, '0')).join('');
}

function mix(a, b, amount) {
    return a.map((channel, i) => channel * (1 - amount) + b[i] * amount);
}

function luminance(rgb) {
    const linear = rgb.map(c => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(rgb, samples) {
    const light = luminance(rgb);
    const values = samples.map(background =>
        (Math.max(light, background) + 0.05) /
        (Math.min(light, background) + 0.05)).sort((a, b) => a - b);
    return {
        low: values[Math.floor(values.length * 0.1)],
        coverage: values.filter(value => value >= 3).length / values.length,
    };
}

function colorFamily(rgb) {
    const max = Math.max(...rgb);
    const delta = max - Math.min(...rgb);
    if (max < 35 || delta < 20 || delta / max < 0.16)
        return null;
    let hue = max === rgb[0] ? ((rgb[1] - rgb[2]) / delta) % 6
        : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2
        : (rgb[0] - rgb[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const family = hue < 15 || hue >= 345 ? 0 : hue < 45 ? 1
        : hue < 75 ? 2 : hue < 155 ? 3 : hue < 185 ? 4 : hue < 265 ? 5 : 6;
    return {family, weight: delta / 255};
}

// Image pixels are a small decoded thumbnail of the original aspect ratio.
function transform(image, view, mode) {
    let sx = view.width / image.width;
    let sy = view.height / image.height;
    if (mode === 'zoom')
        sx = sy = Math.max(sx, sy);
    else if (mode === 'scaled')
        sx = sy = Math.min(sx, sy);
    return {
        sx, sy,
        x: (view.width - image.width * sx) / 2,
        y: (view.height - image.height * sy) / 2,
    };
}

function imagePixel(image, x, y, fallback) {
    const offset = y * image.rowstride + x * image.channels;
    const alpha = image.channels === 4 ? image.pixels[offset + 3] / 255 : 1;
    return [0, 1, 2].map(channel =>
        image.pixels[offset + channel] * alpha + fallback[channel] * (1 - alpha));
}

function sampleRectangle(image, view, rectangle, t, fallback) {
    const left = Math.max(0, rectangle.x);
    const top = Math.max(0, rectangle.y);
    const width = Math.min(view.width, rectangle.x + rectangle.width) - left;
    const height = Math.min(view.height, rectangle.y + rectangle.height) - top;
    if (width <= 0 || height <= 0)
        return [luminance(fallback)];

    // Sample the label itself so even a small time label gets samples on an
    // ultrawide display. Include letterboxing rather than borrowing day pixels.
    const columns = Math.min(64, Math.max(4, Math.ceil(width / t.sx)));
    const rows = Math.min(64, Math.max(4, Math.ceil(height / t.sy)));
    const samples = [];
    const backgroundLight = luminance(fallback);
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const x = Math.floor((left + (column + 0.5) * width / columns - t.x) / t.sx);
            const y = Math.floor((top + (row + 0.5) * height / rows - t.y) / t.sy);
            samples.push(x >= 0 && x < image.width && y >= 0 && y < image.height
                ? luminance(imagePixel(image, x, y, fallback)) : backgroundLight);
        }
    }
    return samples;
}

function sampleImage(image, view, rectangles, mode, fallback) {
    const votes = Array(7).fill(0);
    let total = 0;
    const t = transform(image, view, mode);

    // Tiled, native-size and spanned backgrounds need additional source/virtual
    // screen geometry. Use a documented fallback instead of guessing the crop.
    if (!['zoom', 'scaled', 'stretched'].includes(mode))
        return sampleSolid(fallback);

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const px = t.x + (x + 0.5) * t.sx;
            const py = t.y + (y + 0.5) * t.sy;
            if (px < 0 || px >= view.width || py < 0 || py >= view.height)
                continue;
            const rgb = imagePixel(image, x, y, fallback);
            const colored = colorFamily(rgb);
            if (colored)
                votes[colored.family] += colored.weight;
            total++;
        }
    }

    if (!total)
        return sampleSolid(fallback);
    return {
        votes, total,
        day: sampleRectangle(image, view, rectangles.day, t, fallback),
        time: sampleRectangle(image, view, rectangles.time, t, fallback),
    };
}

function sampleSolid(rgb) {
    const votes = Array(7).fill(0);
    const colored = colorFamily(rgb);
    if (colored)
        votes[colored.family] = colored.weight;
    const light = luminance(rgb);
    return {votes, day: [light], time: [light], total: 1};
}

function makePair(base, daySamples, timeSamples) {
    const [r, g, b] = base.map(c => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 1 / 12;
    if (delta) {
        hue = max === r ? ((g - b) / delta) % 6
            : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        hue = (hue / 6 + 1) % 1;
    }
    const saturation = Math.min(0.65, Math.max(0.18,
        delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0.18));
    const tone = light => {
        const a = saturation * Math.min(light, 1 - light);
        const channel = n => {
            const k = (n + hue * 12) % 12;
            return Math.round(255 * (light - a * Math.max(-1,
                Math.min(k - 3, 9 - k, 1))));
        };
        return [channel(0), channel(8), channel(4)];
    };
    return [0.24, 0.28, 0.32, 0.36, 0.40, 0.44, 0.48, 0.52, 0.56, 0.60]
        .map(light => {
            const day = tone(light);
            const time = tone(light + 0.16);
            return {
                day: toHex(day), time: toHex(time),
                score: Math.min(contrast(day, daySamples).low / 3, 1) +
                    Math.min(contrast(time, timeSamples).low / 4.5, 1) -
                    Math.abs(light - 0.36) * 0.15,
            };
        }).sort((a, b) => b.score - a.score)[0];
}

/** Pure color analysis; performs no file access or Shell changes. */
export function chooseColors({image = null, view, rectangles, mode = 'zoom', background = '#282828'}) {
    const fallback = parseHex(background) || parseHex('#282828');
    const sample = image
        ? sampleImage(image, view, rectangles, mode, fallback)
        : sampleSolid(fallback);
    const highest = Math.max(...sample.votes);
    const family = highest < sample.total * 0.015 ? -1 : sample.votes.indexOf(highest);
    const palette = family < 0 ? NEUTRALS : FAMILIES[family];
    const neutralColors = NEUTRALS.map(parseHex);
    const options = palette.map((hex, index) => {
        const base = parseHex(hex);
        const neutral = [...neutralColors].sort((a, b) =>
            Math.abs(luminance(a) - luminance(base)) -
            Math.abs(luminance(b) - luminance(base)))[0];
        const tone = parseHex(toHex(mix(base, neutral, 0.25)));
        const reading = contrast(tone, sample.day);
        return {
            tone,
            score: Math.min(reading.low, 3) + reading.coverage * 0.5 +
                (index === 1 ? 0.02 : 0),
        };
    }).sort((a, b) => b.score - a.score);
    const pair = makePair(options[0].tone, sample.day, sample.time);
    return {day: pair.day, time: pair.time};
}
