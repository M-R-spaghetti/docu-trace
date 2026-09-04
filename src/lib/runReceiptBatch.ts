import { optimizeImageFile } from "./media";
import { createLimiter } from "./batch/limiter";
import { withRetry, HttpError } from "./batch/retry";
import { hashFile } from "./batch/orchestrator";
import { saveHistory } from "./db";
import { DocRow, RowVerificationStatus } from "./batchTypes";
import { runAutoVerification } from "./autoVerification";

export interface RunReceiptBatchOptions {
    prompt?: string;
    format?: string;
    sessionId?: string;
    concurrency?: number;
    rpm?: number;
    timeoutMs?: number;
    onRow: (row: DocRow) => void;
    onProgress: (done: number, total: number) => void;
    signal?: AbortSignal;
}

/**
 * Extracts a single document with isolated timeout and retries.
 */
async function extractOne(
    file: File,
    schema: any,
    opts: RunReceiptBatchOptions,
    limiter: <T>(fn: () => Promise<T>) => Promise<T>
): Promise<any> {
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort("TIMEOUT"), timeoutMs);

    // If parent signal aborts, abort inner controller too
    const parentAbortHandler = () => ac.abort("USER_ABORT");
    opts.signal?.addEventListener("abort", parentAbortHandler);

    try {
        // 1. Pre-compress to ~1500px, 0.78 quality (~60KB)
        const prepared = await optimizeImageFile(file, 1500, 0.78, true);

        // 2. Execute rate-limited with exponential backoff & 429 Retry-After
        return await limiter(() =>
            withRetry(async () => {
                if (ac.signal.aborted) {
                    if (ac.signal.reason === "TIMEOUT") throw new Error("Request timed out after 90s");
                    throw new Error("Cancelled by user");
                }

                const fd = new FormData();
                fd.append("file", prepared);
                if (opts.prompt) fd.append("prompt", opts.prompt);
                if (opts.format) fd.append("format", opts.format);
                if (schema) fd.append("schema", JSON.stringify(schema));

                const res = await fetch("/api/extract", {
                    method: "POST",
                    body: fd,
                    signal: ac.signal,
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
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", parentAbortHandler);
    }
}

/**
 * Executes high-performance per-file batch processing:
 * - 1 document = 1 extraction call with a shared pre-compiled schema
 * - Controlled concurrency (default 4) and rate limiting (default 12 RPM)
 * - 90s isolated timeout per file preventing stuck slots
 * - Real-time onRow streaming and IndexedDB persistence
 * - Client-side rule-based auto-verification
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
            const resData = await extractOne(raw, schema, opts, limiter);
            try {
                fileId = await hashFile(raw);
            } catch {
                fileId = raw.name;
            }

            // Run deterministic auto-verification
            const verifiedMap = runAutoVerification(fileId, resData);

            const doneRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: resData,
                status: "done",
                verified: verifiedMap,
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
            const errMsg = e?.message ?? String(e);
            const isTimeout = errMsg.toLowerCase().includes("timed out") || errMsg.toLowerCase().includes("timeout");

            const errRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: {},
                status: isTimeout ? "timeout" : "failed",
                error: errMsg,
                verified: {},
            };
            rowsMap.set(raw.name, errRow);
            opts.onRow(errRow);
        } finally {
            opts.onProgress(++finished, files.length);
        }
    };

    await Promise.all(files.map(f => processFile(f)));
    return Array.from(rowsMap.values());
}

/**
 * Retries only the failed or timed-out files from an existing batch.
 */
export async function retryFailedBatchFiles(
    existingRows: DocRow[],
    schema: any,
    opts: RunReceiptBatchOptions
): Promise<DocRow[]> {
    const failedRows = existingRows.filter(r => r.status === "failed" || r.status === "timeout");
    if (failedRows.length === 0) return existingRows;

    const filesToRetry = failedRows.map(r => r.file).filter(Boolean) as File[];
    if (filesToRetry.length === 0) return existingRows;

    return await runReceiptBatch(filesToRetry, schema, opts);
}
