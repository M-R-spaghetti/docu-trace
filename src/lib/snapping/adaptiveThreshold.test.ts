import { describe, expect, it } from "vitest";
import { adaptiveThreshold } from "./adaptiveThreshold";

function gradientImage(width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const base = 150 + Math.round(x / width * 90);
        const dark = y >= 8 && y <= 11 && x >= 4 && x <= 25;
        const value = dark ? base - 100 : base;
        const offset = (y * width + x) * 4;
        data.set([value, value, value, 255], offset);
    }
    return { data, width, height };
}

describe("adaptiveThreshold", () => {
    it("finds dark text across an uneven background", () => {
        const image = gradientImage(32, 20);
        const ink = adaptiveThreshold(image, { windowSize: 9, threshold: 0.15 });
        const textInk = Array.from(ink.slice(8 * 32, 12 * 32)).reduce((sum, value) => sum + value, 0);
        const backgroundInk = Array.from(ink.slice(0, 4 * 32)).reduce((sum, value) => sum + value, 0);
        expect(textInk).toBeGreaterThan(50);
        expect(backgroundInk).toBeLessThan(5);
    });
});
