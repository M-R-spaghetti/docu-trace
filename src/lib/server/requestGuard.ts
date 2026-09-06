import { NextRequest, NextResponse } from "next/server";

type Bucket = { tokens: number; updatedAt: number; active: number; lastSeen: number };
const buckets = new Map<string, Bucket>();
const MAX_TRACKED_CLIENTS = 10_000;
export const PROMPT_LIMIT = 4_000;

const POLICIES = {
    extract: { capacity: 6, refillPerMinute: 12, maxConcurrent: 4 },
    schema: { capacity: 3, refillPerMinute: 6, maxConcurrent: 2 },
} as const;

export function trustedClientIp(req: NextRequest): string {
    return req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
        || "unknown";
}

function prune(now: number) {
    if (buckets.size < MAX_TRACKED_CLIENTS) return;
    for (const [key, bucket] of buckets) {
        if (now - bucket.lastSeen > 30 * 60_000 && bucket.active === 0) buckets.delete(key);
    }
}

export function validatePrompt(prompt: unknown): string {
    if (typeof prompt !== "string") return "";
    const value = prompt.trim();
    if (value.length > PROMPT_LIMIT) {
        throw Object.assign(new Error(`Prompt is too long. Maximum length is ${PROMPT_LIMIT} characters.`), { status: 413 });
    }
    return value;
}

export function acquireApiRequest(req: NextRequest, policyName: keyof typeof POLICIES) {
    const now = Date.now();
    prune(now);
    const policy = POLICIES[policyName];
    const key = `${policyName}:${trustedClientIp(req)}`;
    const bucket = buckets.get(key) || { tokens: policy.capacity, updatedAt: now, active: 0, lastSeen: now };
    const elapsedMinutes = Math.max(0, now - bucket.updatedAt) / 60_000;
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsedMinutes * policy.refillPerMinute);
    bucket.updatedAt = now;
    bucket.lastSeen = now;

    if (bucket.tokens < 1 || bucket.active >= policy.maxConcurrent) {
        buckets.set(key, bucket);
        const retrySeconds = bucket.active >= policy.maxConcurrent
            ? 2
            : Math.max(1, Math.ceil((1 - bucket.tokens) / (policy.refillPerMinute / 60)));
        return {
            response: NextResponse.json(
                { error: "Too many document-processing requests. Please retry shortly." },
                { status: 429, headers: { "Retry-After": String(retrySeconds) } },
            ),
            release: () => {},
        };
    }

    bucket.tokens -= 1;
    bucket.active += 1;
    buckets.set(key, bucket);
    let released = false;
    return {
        response: undefined,
        release: () => {
            if (released) return;
            released = true;
            bucket.active = Math.max(0, bucket.active - 1);
            bucket.lastSeen = Date.now();
        },
    };
}

export function safeHttpStatus(error: any): number {
    const candidate = Number(error?.status ?? error?.error?.status ?? error?.error?.code);
    if (Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) return candidate;
    if (/429|resource_exhausted|quota|too many requests/i.test(String(error?.message || ""))) return 429;
    return 500;
}
