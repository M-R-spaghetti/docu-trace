import { describe, expect, it } from "vitest";
import { createRequestDeadline, generateContentWithFallback } from "./gemini";

describe("generateContentWithFallback", () => {
    it("uses one proven fallback when the primary model is unavailable", async () => {
        const requested: string[] = [];
        const ai = { models: { generateContent: async ({ model }: { model: string }) => {
            requested.push(model);
            if (requested.length === 1) throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
            return { text: "{}" };
        } } };
        await generateContentWithFallback(ai, { contents: [], config: {} }, { deadline: createRequestDeadline(5_000), label: "test" });
        expect(requested[0]).toBe("gemini-3.5-flash");
        expect(requested[1]).toBe("gemini-2.5-flash");
    });

    it("does not fan out to more models after a timeout", async () => {
        const requested: string[] = [];
        const ai = { models: { generateContent: async ({ model }: { model: string }) => {
            requested.push(model);
            throw Object.assign(new Error("request timed out"), { status: 504 });
        } } };

        await expect(generateContentWithFallback(ai, { contents: [], config: {} }, {
            deadline: createRequestDeadline(5_000),
            label: "timeout",
        })).rejects.toThrow("timed out");
        expect(requested).toEqual(["gemini-3.5-flash"]);
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
