import { describe, expect, it } from "vitest";
import { getUploadLimits } from "./uploadLimits";

describe("upload limits", () => {
    it("uses one coherent default profile", () => {
        const limits = getUploadLimits();
        expect(limits.maxSourceFileBytes).toBe(25 * 1024 * 1024);
        expect(limits.maxPreparedRequestBytes).toBe(4 * 1024 * 1024);
        expect(limits.maxImageDimension).toBe(2_000);
        expect(limits.maxBatchFiles).toBe(100);
        expect(limits.maxBatchSourceBytes).toBe(500 * 1024 * 1024);
    });
});
