import { optimizeImageFile } from "@/lib/media";
import { createLimiter } from "./limiter";
import { withRetry, HttpError } from "./retry";
import { saveHistory } from "@/lib/db";

export type JobStatus = "queued" | "preparing" | "extracting" | "done" | "failed" | "skipped";

export interface BatchJob {
    id: string; // unique hash or filename
    filename: string;
    file: File;
    status: JobStatus;
    data?: any;
    error?: string;
    durationMs?: number;
    size: number;
}

export interface BatchProgress {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    active: number;
    percent: number;
}

/**
 * Calculates SHA-256 hash of file content for content-addressable deduplication.
 */
export async function hashFile(file: File): Promise<string> {
    try {
        const buffer = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const hashArray = Array.from(new Uint8Array(digest));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    } catch {
        return `${file.name}_${file.size}_${file.lastModified}`;
    }
}

/**
 * Prepares and downscales an image file if needed, keeping text sharp for Vision OCR.
 */
export async function prepareBatchDocument(file: File): Promise<File> {
    if (file.type === "application/pdf") {
        return file;
    }
    if (file.type.startsWith("image/")) {
        try {
            return await optimizeImageFile(file, 1800, 0.82);
        } catch {
            return file;
        }
    }
    return file;
}

/**
 * Requests extraction of one document, providing pre-compiled schema to skip Step 1.
 */
async function extractOne(
    file: File,
    schema: any,
    prompt: string,
    format: string,
    signal?: AbortSignal
): Promise<any> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prompt", prompt);
    formData.append("format", format);

    if (schema) {
        formData.append("schema", JSON.stringify(schema));
    }

    const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
        signal,
    });

    if (!res.ok) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
        let errorMessage = `HTTP ${res.status}`;
        try {
            const json = await res.json();
            errorMessage = json.error || errorMessage;
        } catch {
            // ignore
        }
        throw new HttpError(res.status, errorMessage, retryAfter);
    }

    const result = await res.json();
    return result.data;
}

export interface RunBatchOptions {
    files: File[];
    schema?: any;
    prompt?: string;
    format?: string;
    concurrency?: number;
    rpm?: number;
    alreadyCompletedIds?: Set<string>;
    onJobUpdate: (job: BatchJob, progress: BatchProgress) => void;
    signal?: AbortSignal;
}

/**
 * Executes a client-side orchestrated batch of documents with rate limiting,
 * exponential retries, and real-time streaming updates.
 */
export async function runBatchOrchestration(opts: RunBatchOptions): Promise<BatchJob[]> {
    const limiter = createLimiter({
        maxConcurrent: opts.concurrency ?? 3,
        maxPerMinute: opts.rpm ?? 12,
    });

    const jobs: BatchJob[] = opts.files.map(f => ({
        id: f.name,
        filename: f.name,
        file: f,
        status: "queued",
        size: f.size,
    }));

    const jobsMap = new Map<string, BatchJob>(jobs.map(j => [j.filename, j]));
    const alreadyDone = opts.alreadyCompletedIds || new Set<string>();

    const getProgress = (): BatchProgress => {
        const all = Array.from(jobsMap.values());
        const completed = all.filter(j => j.status === "done").length;
        const failed = all.filter(j => j.status === "failed").length;
        const skipped = all.filter(j => j.status === "skipped").length;
        const active = all.filter(j => j.status === "extracting" || j.status === "preparing").length;
        const finished = completed + failed + skipped;
        const percent = all.length > 0 ? Math.round((finished / all.length) * 100) : 0;

        return {
            total: all.length,
            completed,
            failed,
            skipped,
            active,
            percent,
        };
    };

    // If master schema is not yet generated, generate it once upfront!
    let masterSchema = opts.schema;
    if (!masterSchema) {
        try {
            console.log("[runBatch] Generating master schema once for batch...");
            const schemaRes = await fetch("/api/schema", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: opts.prompt || "Extract all key entities, structured tables, and important data points from this document.",
                    format: opts.format || "table",
                }),
                signal: opts.signal,
            });
            if (schemaRes.ok) {
                const json = await schemaRes.json();
                masterSchema = json.schema;
            }
        } catch (e) {
            console.warn("[runBatch] Upfront schema generation failed, will generate per file:", e);
        }
    }

    const processFile = async (rawFile: File) => {
        const job = jobsMap.get(rawFile.name)!;
        const startTime = Date.now();

        if (opts.signal?.aborted) {
            job.status = "failed";
            job.error = "Batch cancelled by user";
            opts.onJobUpdate(job, getProgress());
            return;
        }

        try {
            // 1. Preparation
            job.status = "preparing";
            opts.onJobUpdate(job, getProgress());

            const preparedFile = await prepareBatchDocument(rawFile);
            const contentHash = await hashFile(preparedFile);
            job.id = contentHash;

            if (alreadyDone.has(contentHash)) {
                job.status = "skipped";
                opts.onJobUpdate(job, getProgress());
                return;
            }

            // 2. Rate-limited Extraction with Retries
            job.status = "extracting";
            opts.onJobUpdate(job, getProgress());

            const extractedData = await limiter(() =>
                withRetry(
                    () => extractOne(
                        preparedFile,
                        masterSchema,
                        opts.prompt || "Extract all details",
                        opts.format || "table",
                        opts.signal
                    ),
                    { maxAttempts: 5, initialDelayMs: 2000 }
                )
            );

            job.status = "done";
            job.data = extractedData;
            job.durationMs = Date.now() - startTime;

            // Save immediately to IndexedDB
            try {
                await saveHistory({
                    id: contentHash,
                    sessionId: `batch_${startTime}`,
                    file: rawFile,
                    prompt: opts.prompt || "Extract all details",
                    format: opts.format || "table",
                    extractedData,
                    timestamp: Date.now(),
                });
            } catch (err) {
                console.warn("Failed to auto-save batch record to IndexedDB:", err);
            }

            opts.onJobUpdate(job, getProgress());
        } catch (err: any) {
            job.status = "failed";
            job.error = err.message || String(err);
            job.durationMs = Date.now() - startTime;
            opts.onJobUpdate(job, getProgress());
        }
    };

    // Run all tasks through limiter
    await Promise.all(opts.files.map(file => processFile(file)));

    return Array.from(jobsMap.values());
}

/**
 * Combines all tabular data from completed jobs into a consolidated master array of rows,
 * tagging each row with its source filename and job ID.
 */
export function compileMasterRows(jobs: BatchJob[]): {
    rows: any[];
    columns: string[];
    totalAmount: number;
} {
    const rows: any[] = [];
    const columnSet = new Set<string>(["_source_file"]);
    let totalAmount = 0;

    for (const job of jobs) {
        if (job.status !== "done" || !job.data) continue;

        const data = job.data;
        const keys = Object.keys(data);

        // Check for array fields (e.g. items, products, lines)
        const arrayKey = keys.find(k => Array.isArray(data[k]));

        // Check for top-level scalar fields (e.g. total, date, vendor)
        const topLevelProps: Record<string, any> = {};
        for (const k of keys) {
            if (k === arrayKey) continue;
            const val = data[k];
            const display = val && typeof val === 'object' && 'value' in val ? val.value : val;
            topLevelProps[k] = display;
            columnSet.add(k);

            // Attempt to sum total
            if (/total|amount|сума/i.test(k) && typeof display === 'number') {
                totalAmount += display;
            } else if (/total|amount|сума/i.test(k) && typeof display === 'string') {
                const parsed = parseFloat(display.replace(/[^\d.-]/g, ''));
                if (!isNaN(parsed)) totalAmount += parsed;
            }
        }

        if (arrayKey && Array.isArray(data[arrayKey]) && data[arrayKey].length > 0) {
            for (const item of data[arrayKey]) {
                if (!item || typeof item !== 'object') continue;
                const rowObj: Record<string, any> = {
                    _source_file: job.filename,
                    _source_id: job.id,
                    ...topLevelProps,
                };
                for (const col of Object.keys(item)) {
                    const cell = item[col];
                    const display = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
                    rowObj[col] = display;
                    columnSet.add(col);
                }
                rows.push(rowObj);
            }
        } else {
            // Single row document
            rows.push({
                _source_file: job.filename,
                _source_id: job.id,
                ...topLevelProps,
            });
        }
    }

    return {
        rows,
        columns: Array.from(columnSet),
        totalAmount: Math.round(totalAmount * 100) / 100,
    };
}
