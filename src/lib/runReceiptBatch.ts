import { optimizeImageFile } from "./media";
import { createLimiter } from "./batch/limiter";
import { withRetry, HttpError } from "./batch/retry";
import { hashFile } from "./batch/orchestrator";
import { saveHistory } from "./db";
import { DocRow, RowVerificationStatus } from "./batchTypes";

export interface RunReceiptBatchOptions {
    prompt?: string;
    format?: string;
    sessionId?: string;
    concurrency?: number;
    rpm?: number;
    onRow: (row: DocRow) => void;
    onProgress: (done: number, total: number) => void;
    signal?: AbortSignal;
}

export function initVerified(data: any): Record<string, RowVerificationStatus> {
    const verified: Record<string, RowVerificationStatus> = {};
    if (!data || typeof data !== "object") return verified;
    for (const k of Object.keys(data)) {
        if (k === "markdown_text") continue;
        verified[k] = "pending";
    }
    return verified;
}

/**
 * Executes high-performance per-file batch processing:
 * - 1 document = 1 extraction call with a shared pre-compiled schema
 * - Controlled concurrency (default 4) and rate limiting (default 12 RPM)
 * - Immediate image optimization to ~60KB to prevent payload bottlenecks
 * - Real-time onRow streaming to master table and IndexedDB persistence
 */
export async function runReceiptBatch(
    files: File[],
    schema: any,
    opts: RunReceiptBatchOptions
): Promise<DocRow[]> {
    const limiter = createLimiter({
        maxConcurrent: opts.concurrency ?? 4,
        maxPerMinute: opts.rpm ?? 12,
    });

    let finished = 0;
    const sessionId = opts.sessionId || `batch_${Date.now()}`;
    const rowsMap = new Map<string, DocRow>();

    // Initial placeholder rows so table renders immediately
    for (const f of files) {
        const row: DocRow = {
            fileId: f.name,
            fileName: f.name,
            file: f,
            data: {},
            status: "queued",
            verified: {},
        };
        rowsMap.set(f.name, row);
    }

    const processFile = async (raw: File) => {
        let fileId = raw.name;
        if (opts.signal?.aborted) {
            const abortedRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: {},
                status: "failed",
                error: "Batch cancelled by user",
                verified: {},
            };
            rowsMap.set(raw.name, abortedRow);
            opts.onRow(abortedRow);
            opts.onProgress(++finished, files.length);
            return;
        }

        const extractingRow: DocRow = {
            fileId,
            fileName: raw.name,
            file: raw,
            data: {},
            status: "extracting",
            verified: {},
        };
        rowsMap.set(raw.name, extractingRow);
        opts.onRow(extractingRow);

        try {
            // 1. Prepare & compress image to ~1500px, 0.78 quality
            const prepared = await optimizeImageFile(raw, 1500, 0.78, true);
            fileId = await hashFile(prepared);

            // 2. Extract with limiter + withRetry
            const resData = await limiter(() =>
                withRetry(async () => {
                    if (opts.signal?.aborted) throw new Error("Cancelled by user.");

                    const fd = new FormData();
                    fd.append("file", prepared);
                    if (opts.prompt) fd.append("prompt", opts.prompt);
                    if (opts.format) fd.append("format", opts.format);
                    if (schema) fd.append("schema", JSON.stringify(schema));

                    const res = await fetch("/api/extract", {
                        method: "POST",
                        body: fd,
                        signal: opts.signal,
                    });

                    if (!res.ok) {
                        const retryHeader = res.headers.get("retry-after");
                        const retryAfter = retryHeader ? Number(retryHeader) : undefined;
                        let errMsg = `HTTP ${res.status}`;
                        try {
                            const j = await res.json();
                            errMsg = j.error || errMsg;
                        } catch {}
                        throw new HttpError(res.status, errMsg, retryAfter);
                    }

                    const j = await res.json();
                    return j.data ?? {};
                }, { maxAttempts: 5, initialDelayMs: 2000 })
            );

            const doneRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: resData,
                status: "done",
                verified: initVerified(resData),
            };
            rowsMap.set(raw.name, doneRow);

            // Save row to IndexedDB immediately!
            try {
                await saveHistory({
                    id: fileId,
                    sessionId,
                    file: raw,
                    prompt: opts.prompt || "Receipt batch extraction",
                    format: opts.format || "table",
                    extractedData: resData,
                    verificationState: {},
                    timestamp: Date.now(),
                });
            } catch (dbErr) {
                console.warn("Failed to persist batch row to IndexedDB:", dbErr);
            }

            opts.onRow(doneRow);
        } catch (e: any) {
            const failedRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: {},
                status: "failed",
                error: e?.message ?? String(e),
                verified: {},
            };
            rowsMap.set(raw.name, failedRow);
            opts.onRow(failedRow);
        } finally {
            opts.onProgress(++finished, files.length);
        }
    };

    await Promise.all(files.map(f => processFile(f)));

    return Array.from(rowsMap.values());
}
