/**
 * Exponential backoff with jitter and 429 Retry-After support.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
        public retryAfter?: number
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: RetryOptions = {}
): Promise<T> {
    const maxAttempts = opts.maxAttempts ?? 5;
    let delay = opts.initialDelayMs ?? 2000;
    const maxDelay = opts.maxDelayMs ?? 60_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            const err = error as HttpError;
            const isRetryable =
                err.status === 429 ||
                err.status === 503 ||
                err.status === 504 ||
                err.status === 502 ||
                (typeof err.status === "number" && err.status >= 500) ||
                error.name === "TypeError"; // network fetch failure

            if (attempt >= maxAttempts || !isRetryable) {
                throw error;
            }

            // If server specified Retry-After header in seconds, honor it
            const baseDelay = err.status === 429 ? Math.max(delay, 7000) : delay;
            const waitMs = err.retryAfter
                ? err.retryAfter * 1000 + 500
                : baseDelay + Math.random() * 1000; // jitter

            console.warn(`[withRetry] Attempt ${attempt} failed (${err.message || err.status}). Retrying in ${Math.round(waitMs)}ms...`);
            await sleep(waitMs);
            delay = Math.min(baseDelay * 2, maxDelay);
        }
    }

    throw new Error("Retry attempts exhausted.");
}
