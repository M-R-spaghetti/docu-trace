import { describe, expect, it } from "vitest";
import { snapImageData } from "./imageTextSnapper";

function receiptImage() {
    const width = 120, height = 120;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (const top of [25, 60, 95]) for (let y = top; y < top + 7; y++) for (let x = 20; x < 90; x++) {
        if ((x % 8) < 5) {
            const offset = (y * width + x) * 4;
            data[offset] = data[offset + 1] = data[offset + 2] = 20;
        }
    }
    return { data, width, height };
}

describe("imageTextSnapper", () => {
    it("refines a prior only when it lands near a detected line", () => {
        const result = snapImageData(receiptImage(), [475, 150, 590, 800]);
        expect(result.status).toBe("refined");
        expect((result.box_2d[0] + result.box_2d[2]) / 2).toBeCloseTo(525, -1);
    });

    it("returns an honest full-width approximation for a line miss", () => {
        const result = snapImageData(receiptImage(), [330, 150, 390, 800]);
        expect(result.status).toBe("approximate");
        expect(result.box_2d[1]).toBe(0);
        expect(result.box_2d[3]).toBe(1000);
    });
});
