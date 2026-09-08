import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getUserGemini, isQuotaError } from "./userGemini";

describe("getUserGemini", () => {
    it("accepts a valid user key and model", () => {
        const request = new NextRequest("http://localhost/api/extract", {
            headers: {
                "x-docutrace-gemini-key": "A_valid_test_key_1234567890",
                "x-docutrace-gemini-model": "gemini-2.5-flash",
            },
        });

        expect(getUserGemini(request)?.model).toBe("gemini-2.5-flash");
    });

    it("rejects invalid custom model names", () => {
        const request = new NextRequest("http://localhost/api/extract", {
            headers: {
                "x-docutrace-gemini-key": "A_valid_test_key_1234567890",
                "x-docutrace-gemini-model": "../../../other-provider",
            },
        });

        expect(() => getUserGemini(request)).toThrow("корректное имя модели");
    });
});

describe("isQuotaError", () => {
    it("recognizes both HTTP and Gemini quota failures", () => {
        expect(isQuotaError({ status: 429 })).toBe(true);
        expect(isQuotaError(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(true);
        expect(isQuotaError({ status: 503 })).toBe(false);
    });
});
