import { optimizeImageFile } from "./media";
import { createLimiter } from "./batch/limiter";
import { withRetry, HttpError } from "./batch/retry";
import { saveHistory } from "./db";
import { DocRow } from "./batchTypes";
import { generateFileId, auditReceiptDoc } from "./review";

export interface RunReceiptBatchOptions {
    prompt?: string;
    format?: string;
    sessionId?: string;
    concurrency?: number;
    rpm?: number;
    timeoutMs?: number;
    maxAutoRetryPasses?: number; // default 2
    onStatusMessage?: (message: string) => void;
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
 * - Client-side strict two-axis audit checks (auto: ok/warn/error, human: unreviewed)
 * - Autonomous multi-pass retry for rate limits / timeouts
 */
export async function runReceiptBatch(
    files: File[],
    schema: any,
    opts: RunReceiptBatchOptions
): Promise<DocRow[]> {
    const maxPasses = opts.maxAutoRetryPasses ?? 6;
    const limiter = createLimiter({
        maxConcurrent: opts.concurrency ?? 3,
        maxPerMinute: opts.rpm ?? 10,
    });

    let finished = 0;
    const sessionId = opts.sessionId || `batch_${Date.now()}`;
    const rowsMap = new Map<string, DocRow>();

    // Initial placeholder rows with consistent fileId so table renders immediately
    for (const f of files) {
        const fileId = generateFileId(f);
        const row: DocRow = {
            fileId,
            fileName: f.name,
            file: f,
            data: {},
            status: "queued",
            reviews: {},
        };
        rowsMap.set(fileId, row);
    }

    const processFile = async (raw: File) => {
        const fileId = generateFileId(raw);

        if (opts.signal?.aborted) {
            const abortedRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: {},
                status: "failed",
                error: "Batch cancelled by user",
                reviews: {},
            };
            rowsMap.set(fileId, abortedRow);
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
            reviews: {},
        };
        rowsMap.set(fileId, extractingRow);
        opts.onRow(extractingRow);

        try {
            const resData = await extractOne(raw, schema, opts, limiter);

            // Run strict deterministic audit check (two-axis: auto + human)
            const reviews = auditReceiptDoc(resData);

            const doneRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: resData,
                status: "done",
                reviews,
            };
            rowsMap.set(fileId, doneRow);

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
                reviews: {},
            };
            rowsMap.set(fileId, errRow);
            opts.onRow(errRow);
        } finally {
            finished++;
            const currentDone = Array.from(rowsMap.values()).filter(r => r.status === "done").length;
            opts.onProgress(currentDone, files.length);
            if (finished < files.length) {
                opts.onStatusMessage?.(`Обработка документов (${currentDone}/${files.length})...`);
            }
        }
    };

    await Promise.all(files.map(f => processFile(f)));

    // Autonomous Multi-Pass Auto-Retry for failed / timed-out files (up to 5 automatic retry rounds under the hood)
    let pass = 1;
    let currentRows = Array.from(rowsMap.values());
    let failedRows = currentRows.filter(r => r.status === "failed" || r.status === "timeout");

    while (failedRows.length > 0 && pass < maxPasses && !opts.signal?.aborted) {
        pass++;
        const currentDone = currentRows.filter(r => r.status === "done").length;
        const cooldownSeconds = Math.min(30, 8 + (pass - 2) * 6);

        // Progressive cooldown countdown to let Gemini 1-minute RPM bucket drain
        for (let remainingSec = cooldownSeconds; remainingSec > 0; remainingSec--) {
            if (opts.signal?.aborted) break;
            opts.onStatusMessage?.(`Обработка документов в очереди (${currentDone}/${files.length})...`);
            await new Promise(r => setTimeout(r, 1000));
        }
        if (opts.signal?.aborted) break;

        opts.onStatusMessage?.(`Обработка документов в очереди (${currentDone}/${files.length})...`);

        const filesToRetry = failedRows.map(r => r.file).filter(Boolean) as File[];
        if (filesToRetry.length === 0) break;

        // Gentle concurrency on retry (1 or 2 files at a time) to guarantee zero 429 burst errors
        const retryConcurrency = Math.min(2, Math.max(1, Math.floor((opts.concurrency ?? 2) / 2)));
        const retryLimiter = createLimiter({
            maxConcurrent: retryConcurrency,
            maxPerMinute: Math.min(10, opts.rpm ?? 10),
        });

        await Promise.all(filesToRetry.map(async (raw) => {
            if (opts.signal?.aborted) return;
            const fileId = generateFileId(raw);
            const extractingRow: DocRow = {
                fileId,
                fileName: raw.name,
                file: raw,
                data: {},
                status: "extracting",
                reviews: {},
            };
            rowsMap.set(fileId, extractingRow);
            opts.onRow(extractingRow);

            try {
                const resData = await extractOne(raw, schema, opts, retryLimiter);
                const reviews = auditReceiptDoc(resData);
                const doneRow: DocRow = {
                    fileId,
                    fileName: raw.name,
                    file: raw,
                    data: resData,
                    status: "done",
                    reviews,
                };
                rowsMap.set(fileId, doneRow);
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
                } catch {}
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
                    reviews: {},
                };
                rowsMap.set(fileId, errRow);
                opts.onRow(errRow);
            } finally {
                // Live progress count update: done / total
                const currentDone = Array.from(rowsMap.values()).filter(r => r.status === "done").length;
                opts.onProgress(currentDone, files.length);
            }
        }));

        currentRows = Array.from(rowsMap.values());
        failedRows = currentRows.filter(r => r.status === "failed" || r.status === "timeout");
    }

    opts.onStatusMessage?.(failedRows.length === 0 ? "Все чеки успешно обработаны!" : "Обработка завершена.");
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
