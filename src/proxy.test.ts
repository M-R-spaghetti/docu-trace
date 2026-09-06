import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("production authentication", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("allows anonymous access when production credentials are not configured", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("APP_BASIC_AUTH_USER", "");
        vi.stubEnv("APP_BASIC_AUTH_PASSWORD", "");
        expect(proxy(new NextRequest("https://example.test"))?.status).toBe(200);
    });

    it("challenges anonymous users and accepts valid Basic Auth", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("APP_BASIC_AUTH_USER", "preview");
        vi.stubEnv("APP_BASIC_AUTH_PASSWORD", "secret");
        expect(proxy(new NextRequest("https://example.test"))?.status).toBe(401);

        const authorization = `Basic ${Buffer.from("preview:secret").toString("base64")}`;
        const response = proxy(new NextRequest("https://example.test", { headers: { authorization } }));
        expect(response?.status).toBe(200);
    });
});
