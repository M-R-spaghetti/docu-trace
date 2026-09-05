import { describe, expect, it } from "vitest";
import { PROMPT_LIMIT, safeHttpStatus, validatePrompt } from "./requestGuard";

describe("request guard", () => {
    it("rejects oversized prompts", () => {
        expect(() => validatePrompt("x".repeat(PROMPT_LIMIT + 1))).toThrow(/too long/i);
    });

    it("does not expose gRPC codes as invalid HTTP statuses", () => {
        expect(safeHttpStatus({ error: { code: 3 } })).toBe(500);
        expect(safeHttpStatus({ error: { code: 8 } })).toBe(500);
    });

    it("preserves valid HTTP errors and recognizes quota errors", () => {
        expect(safeHttpStatus({ status: 413 })).toBe(413);
        expect(safeHttpStatus({ message: "RESOURCE_EXHAUSTED quota" })).toBe(429);
    });
});
