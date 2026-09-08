import { describe, expect, it } from "vitest";
import { findInkSpans, findLineBands, horizontalProjection, medianLineSpacing, verticalProjection } from "./projectionProfile";

describe("projection profiles", () => {
    it("detects text lines, spacing and word spans", () => {
        const width = 60, height = 40;
        const ink = new Uint8Array(width * height);
        for (const top of [5, 20]) for (let y = top; y < top + 5; y++) {
            for (let x = 5; x < 18; x++) ink[y * width + x] = 1;
            for (let x = 25; x < 42; x++) ink[y * width + x] = 1;
        }
        expect(horizontalProjection(ink, width, height)[6]).toBeGreaterThan(0.4);
        const bands = findLineBands(ink, width, height);
        expect(bands).toHaveLength(2);
        expect(medianLineSpacing(bands, 10)).toBeCloseTo(15, 0);
        const spans = findInkSpans(verticalProjection(ink, width, height, bands[0].top, bands[0].bottom), 0.2, 1);
        expect(spans).toEqual([{ left: 5, right: 18 }, { left: 25, right: 42 }]);
    });
});
