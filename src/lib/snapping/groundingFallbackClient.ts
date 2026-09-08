import type { ActiveHighlight, BoundingBox } from "@/lib/types";

interface Pending { id: string; highlight: ActiveHighlight; signal?: AbortSignal; resolve: (box: BoundingBox | null) => void }
interface FileQueue { pending: Pending[]; timer: ReturnType<typeof setTimeout> | null }
const queues = new WeakMap<File, FileQueue>();

async function flush(file: File, queue: FileQueue) {
    queue.timer = null;
    const pending = queue.pending.splice(0, 20);
    const active = pending.filter(item => !item.signal?.aborted);
    pending.filter(item => item.signal?.aborted).forEach(item => item.resolve(null));
    if (!active.length) return;
    const form = new FormData();
    form.set("file", file);
    form.set("fields", JSON.stringify(active.map(({ id, highlight }) => ({
        id,
        raw_text: highlight.rawText || highlight.rawValue || "",
        line_context: highlight.lineContext || "",
        field_type: highlight.fieldType || "text",
        box_2d: highlight.box_2d,
        page: highlight.page || 1,
    }))));
    try {
        const response = await fetch("/api/grounding", { method: "POST", body: form });
        const payload = response.ok ? await response.json() : null;
        const byId = new Map((payload?.fields || []).map((field: any) => [String(field.id), field.box_2d]));
        active.forEach(item => {
            const box = byId.get(item.id);
            item.resolve(!item.signal?.aborted && Array.isArray(box) && box.length === 4 ? box as BoundingBox : null);
        });
    } catch {
        active.forEach(item => item.resolve(null));
    }
    if (queue.pending.length && !queue.timer) queue.timer = setTimeout(() => flush(file, queue), 120);
}

/** Debounces approximate fields for the same document into one fallback request. */
export function requestGroundingFallback(file: File, highlight: ActiveHighlight, signal?: AbortSignal): Promise<BoundingBox | null> {
    if (signal?.aborted) return Promise.resolve(null);
    const queue = queues.get(file) || { pending: [], timer: null };
    queues.set(file, queue);
    return new Promise(resolve => {
        queue.pending.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, highlight, signal, resolve });
        if (!queue.timer) queue.timer = setTimeout(() => flush(file, queue), 120);
    });
}
