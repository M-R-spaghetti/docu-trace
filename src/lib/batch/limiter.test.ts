import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./limiter";

describe("mapWithConcurrency", () => {
    it("limits the entire worker pipeline", async () => {
        let active = 0;
        let peak = 0;
        const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
            return value * 2;
        });

        expect(peak).toBe(2);
        expect(values).toEqual([2, 4, 6, 8, 10]);
    });
});
