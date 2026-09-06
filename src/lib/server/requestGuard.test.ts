import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PROMPT_LIMIT, safeHttpStatus, trustedClientIp, validatePrompt } from "./requestGuard";

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

    it("uses Vercel's trusted client chain before generic forwarded headers", () => {
        const req = new NextRequest("https://example.test/api/extract", {
            headers: {
                "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
                "x-forwarded-for": "198.51.100.20",
                "x-real-ip": "192.0.2.30",
            },
        });
        expect(trustedClientIp(req)).toBe("203.0.113.10");
    });

    it("ignores spoofable non-Vercel IP headers", () => {
        const req = new NextRequest("https://example.test/api/extract", {
            headers: {
                "x-forwarded-for": "198.51.100.20",
                "x-real-ip": "192.0.2.30",
                "cf-connecting-ip": "203.0.113.40",
            },
        });
        expect(trustedClientIp(req)).toBe("unknown");
    });
});
