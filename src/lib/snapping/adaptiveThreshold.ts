export interface AdaptiveThresholdOptions {
    windowSize?: number;
    threshold?: number;
}

/** Bradley-Roth adaptive threshold. Output is 1 for ink and 0 for background. */
export function adaptiveThreshold(
    image: Pick<ImageData, "data" | "width" | "height">,
    options: AdaptiveThresholdOptions = {},
): Uint8Array {
    const { width, height, data } = image;
    if (width <= 0 || height <= 0 || data.length < width * height * 4) return new Uint8Array();

    const requestedWindow = options.windowSize ?? Math.max(15, Math.round(Math.min(width, height) / 16));
    const windowSize = Math.max(3, requestedWindow | 1);
    const half = Math.floor(windowSize / 2);
    const threshold = Math.min(0.45, Math.max(0.02, options.threshold ?? 0.15));
    const stride = width + 1;
    const integral = new Float64Array((width + 1) * (height + 1));
    const gray = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const value = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
            gray[y * width + x] = value;
            rowSum += value;
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
        }
    }

    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - half);
        const y1 = Math.min(height - 1, y + half);
        for (let x = 0; x < width; x++) {
            const x0 = Math.max(0, x - half);
            const x1 = Math.min(width - 1, x + half);
            const count = (x1 - x0 + 1) * (y1 - y0 + 1);
            const sum = integral[(y1 + 1) * stride + x1 + 1]
                - integral[y0 * stride + x1 + 1]
                - integral[(y1 + 1) * stride + x0]
                + integral[y0 * stride + x0];
            ink[y * width + x] = gray[y * width + x] < (sum / count) * (1 - threshold) ? 1 : 0;
        }
    }
    return ink;
}
