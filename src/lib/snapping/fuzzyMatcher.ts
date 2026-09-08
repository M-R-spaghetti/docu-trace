import type { GroundingFieldType } from "@/lib/types";

const CONFUSABLES: Record<string, string> = { o: "0", i: "1", l: "1", s: "5", b: "8" };

export function normalizeForField(value: string, fieldType: GroundingFieldType = "text"): string {
    let normalized = String(value ?? "").normalize("NFKC").toLowerCase()
        .replace(/[‐‑‒–—−]/g, "-")
        .replace(/[\u00a0\s]+/g, " ")
        .trim();
    if (fieldType !== "text") {
        normalized = normalized.replace(/[oilsb]/g, char => CONFUSABLES[char] ?? char);
        if (fieldType === "amount" || fieldType === "quantity") normalized = normalized.replace(/,/g, ".");
    }
    return normalized.replace(/[^\p{L}\p{N}.:-]+/gu, "");
}

export function levenshteinDistance(a: string, b: string): number {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        previous = current;
    }
    return previous[b.length];
}

export function fuzzyScore(a: string, b: string, fieldType: GroundingFieldType = "text"): number {
    const left = normalizeForField(a, fieldType);
    const right = normalizeForField(b, fieldType);
    if (!left || !right) return 0;
    if (left === right) return 1;
    return 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
}
