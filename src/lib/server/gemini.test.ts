import { describe, expect, it } from "vitest";
import { createRequestDeadline, generateContentWithFallback } from "./gemini";

describe("generateContentWithFallback", () => {
    it("never uses a lite model for coordinate fallback", async () => {
        const requested: string[] = [];
        const ai = { models: { generateContent: async ({ model }: { model: string }) => {
            requested.push(model);
            if (requested.length === 1) throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
            return { text: "{}" };
        } } };
        await generateContentWithFallback(ai, { contents: [], config: {} }, { deadline: createRequestDeadline(5_000), label: "test", allowLite: false });
        expect(requested.some(model => model.includes("lite"))).toBe(false);
    });
});
