import type { LineBand } from "./types";

export function horizontalProjection(ink: Uint8Array, width: number, height: number): Float32Array {
    const profile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let total = 0;
        for (let x = 0; x < width; x++) total += ink[y * width + x] || 0;
        profile[y] = width ? total / width : 0;
    }
    return profile;
}

export function verticalProjection(ink: Uint8Array, width: number, height: number, top = 0, bottom = height): Float32Array {
    const profile = new Float32Array(width);
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(height, Math.ceil(bottom));
    for (let x = 0; x < width; x++) {
        let total = 0;
        for (let y = y0; y < y1; y++) total += ink[y * width + x] || 0;
        profile[x] = y1 > y0 ? total / (y1 - y0) : 0;
    }
    return profile;
}

function smooth(profile: Float32Array, radius = 2): Float32Array {
    const result = new Float32Array(profile.length);
    for (let i = 0; i < profile.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - radius); j <= Math.min(profile.length - 1, i + radius); j++) {
            sum += profile[j]; count++;
        }
        result[i] = count ? sum / count : 0;
    }
    return result;
}

export function findLineBands(ink: Uint8Array, width: number, height: number): LineBand[] {
    if (!ink.length || width <= 0 || height <= 0) return [];
    const profile = smooth(horizontalProjection(ink, width, height));
    const sorted = Array.from(profile).sort((a, b) => a - b);
    const background = sorted[Math.floor(sorted.length * 0.55)] || 0;
    const peak = sorted.at(-1) || 0;
    const threshold = Math.max(0.008, background + (peak - background) * 0.14);
    const minHeight = Math.max(2, Math.round(height * 0.0015));
    const maxGap = Math.max(1, Math.round(height * 0.002));
    const bands: LineBand[] = [];
    let start = -1;
    let lastActive = -1;

    for (let y = 0; y <= height; y++) {
        const active = y < height && profile[y] >= threshold;
        if (active) {
            if (start < 0) start = y;
            lastActive = y;
        } else if (start >= 0 && y - lastActive > maxGap) {
            const top = start;
            const bottom = lastActive + 1;
            if (bottom - top >= minHeight) {
                let weighted = 0, mass = 0, maxDensity = 0;
                for (let row = top; row < bottom; row++) {
                    weighted += row * profile[row]; mass += profile[row]; maxDensity = Math.max(maxDensity, profile[row]);
                }
                bands.push({ top, bottom, center: mass ? weighted / mass : (top + bottom) / 2, baseline: bottom - 1, density: maxDensity });
            }
            start = -1;
            lastActive = -1;
        }
    }
    return bands;
}

export function medianLineSpacing(bands: LineBand[], fallback: number): number {
    if (bands.length < 2) return Math.max(8, fallback);
    const gaps = bands.slice(1).map((band, index) => band.center - bands[index].center).filter(gap => gap > 2).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : Math.max(8, fallback);
}

export interface InkSpan { left: number; right: number }

export function findInkSpans(profile: Float32Array, minimumDensity = 0.08, maxGap = 2): InkSpan[] {
    const spans: InkSpan[] = [];
    let start = -1, last = -1;
    for (let x = 0; x <= profile.length; x++) {
        if (x < profile.length && profile[x] >= minimumDensity) {
            if (start < 0) start = x;
            last = x;
        } else if (start >= 0 && x - last > maxGap) {
            spans.push({ left: start, right: last + 1 });
            start = -1; last = -1;
        }
    }
    return spans;
}
