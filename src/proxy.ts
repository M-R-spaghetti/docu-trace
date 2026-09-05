import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function safeEqual(actual: string, expected: string): boolean {
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

export function proxy(req: NextRequest) {
    const expectedUser = process.env.APP_BASIC_AUTH_USER;
    const expectedPassword = process.env.APP_BASIC_AUTH_PASSWORD;
    if (!expectedUser || !expectedPassword) return NextResponse.next();

    const authorization = req.headers.get("authorization") || "";
    if (authorization.startsWith("Basic ")) {
        try {
            const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
            const separator = decoded.indexOf(":");
            const user = separator >= 0 ? decoded.slice(0, separator) : "";
            const password = separator >= 0 ? decoded.slice(separator + 1) : "";
            if (safeEqual(user, expectedUser) && safeEqual(password, expectedPassword)) {
                return NextResponse.next();
            }
        } catch {
            // Invalid authorization is handled by the challenge below.
        }
    }

    return new NextResponse("Authentication required", {
        status: 401,
        headers: {
            "WWW-Authenticate": 'Basic realm="DocuTrace", charset="UTF-8"',
            "Cache-Control": "no-store",
        },
    });
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
