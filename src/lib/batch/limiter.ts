/**
 * Concurrency and Rate Limiter
 * Implements a dual-layer queue:
 * 1. Concurrency slots (max concurrent network requests, e.g. 2-3)
 * 2. Sliding window rate limiter (requests per minute, e.g. 10 RPM on Free Tier)
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface LimiterOptions {
    maxConcurrent?: number;
    maxPerMinute?: number;
}

export function createLimiter(opts: LimiterOptions = {}) {
    const maxConcurrent = opts.maxConcurrent ?? 3;
    const maxPerMinute = opts.maxPerMinute ?? 10;

    let active = 0;
    const pendingSlots: (() => void)[] = [];
    const requestTimestamps: number[] = [];

    async function acquireRate(): Promise<void> {
        while (true) {
            const now = Date.now();
            // Prune timestamps older than 60 seconds
            while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60_000) {
                requestTimestamps.shift();
            }

            if (requestTimestamps.length < maxPerMinute) {
                requestTimestamps.push(now);
                return;
            }

            // Wait until the oldest request clears the 60s window
            const waitTime = Math.max(100, 60_000 - (now - requestTimestamps[0]) + 150);
            await sleep(waitTime);
        }
    }

    function acquireSlot(): Promise<void> {
        if (active < maxConcurrent) {
            active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => pendingSlots.push(resolve)).then(() => {
            active++;
        });
    }

    function releaseSlot() {
        active--;
        const next = pendingSlots.shift();
        if (next) {
            next();
        }
    }

    return async function run<T>(task: () => Promise<T>): Promise<T> {
        await acquireSlot();
        try {
            await acquireRate();
            return await task();
        } finally {
            releaseSlot();
        }
    };
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}
