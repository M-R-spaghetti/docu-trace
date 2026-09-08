import { describe, expect, it } from "vitest";
import { createRequestDeadline, generateContentWithFallback } from "./gemini";

describe("generateContentWithFallback", () => {
    it("prioritizes gemini-3.5-flash and falls back seamlessly when unavailable", async () => {
        const requested: string[] = [];
        const ai = { models: { generateContent: async ({ model }: { model: string }) => {
            requested.push(model);
            if (requested.length === 1) throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
            return { text: "{}" };
        } } };
        await generateContentWithFallback(ai, { contents: [], config: {} }, { deadline: createRequestDeadline(5_000), label: "test" });
        expect(requested[0]).toBe("gemini-3.5-flash");
        expect(requested[1]).toBe("gemini-3.5-flash-lite");
    });

    it("uses only the user-selected model with a provided client", async () => {
        const requested: string[] = [];
        const ai = { models: { generateContent: async ({ model }: { model: string }) => {
            requested.push(model);
            return { text: "{}" };
        } } };

        await generateContentWithFallback(ai, { contents: [], config: {} }, {
            deadline: createRequestDeadline(5_000),
            label: "user model",
            model: "gemini-custom",
            useProvidedClient: true,
        });

        expect(requested).toEqual(["gemini-custom"]);
    });
});
