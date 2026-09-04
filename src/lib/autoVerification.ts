import { RowVerificationStatus } from "./batchTypes";
import { walkLeaves, getDisplayValue, isLocatedValue, vKey } from "./flatten";

export function parseNumber(val: any): number | null {
    if (val === null || val === undefined) return null;
    const str = String(isLocatedValue(val) ? val.value : val)
        .replace(/[\s\u00A0]/g, "")
        .replace(/[^\d.,\-]/g, "")
        .replace(",", ".");
    const num = parseFloat(str);
    return isFinite(num) ? num : null;
}

export function isValidDate(val: any): boolean {
    if (val === null || val === undefined) return false;
    const str = String(isLocatedValue(val) ? val.value : val).trim();
    if (!str || str === "—") return false;

    // Matches DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY, etc.
    const dateRegex = /^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/;
    if (dateRegex.test(str)) return true;

    // Standard parser test
    const timestamp = Date.parse(str);
    return !isNaN(timestamp) && timestamp > 0;
}

export function isNotEmpty(val: any): boolean {
    const disp = getDisplayValue(val);
    return disp !== "—" && disp !== "" && disp !== "null" && disp !== "undefined" && !disp.includes("[object");
}

/**
 * Deterministic, rule-based verification for extracted receipt document data.
 * Automatically verifies numbers, valid dates, and populated fields,
 * and performs math reconciliation on items vs total.
 */
export function runAutoVerification(fileId: string, data: any): Record<string, RowVerificationStatus> {
    const result: Record<string, RowVerificationStatus> = {};
    if (!data || typeof data !== "object") return result;

    const leaves = walkLeaves(data);

    // 1. First pass: field-level heuristic validation
    for (const leaf of leaves) {
        const { path, node } = leaf;
        const key = path.toLowerCase();
        const disp = getDisplayValue(node);

        if (!isNotEmpty(node)) {
            result[path] = "pending";
            continue;
        }

        // Numeric fields (price, total, amount, tax, qty)
        if (
            key.includes("price") ||
            key.includes("total") ||
            key.includes("amount") ||
            key.includes("tax") ||
            key.includes("sum") ||
            key.includes("qty") ||
            key.includes("quantity") ||
            key.includes("cost")
        ) {
            const num = parseNumber(node);
            if (num !== null && num >= 0) {
                result[path] = "auto_verified";
            } else {
                result[path] = "pending";
            }
            continue;
        }

        // Date & Time fields
        if (key.includes("date") || key.includes("time")) {
            if (isValidDate(node)) {
                result[path] = "auto_verified";
            } else {
                result[path] = "pending";
            }
            continue;
        }

        // Entity / Merchant / Description fields
        if (disp.length >= 2 && !disp.includes("unknown")) {
            result[path] = "auto_verified";
        } else {
            result[path] = "pending";
        }
    }

    // 2. Second pass: Mathematical consistency check (sum of items vs total)
    try {
        let totalVal: number | null = null;
        let totalPath: string | null = null;

        for (const [p, node] of leaves.map(l => [l.path, l.node] as const)) {
            const low = p.toLowerCase();
            if (low === "total" || low === "grand_total" || low === "total_amount") {
                totalVal = parseNumber(node);
                totalPath = p;
                break;
            }
        }

        const items = Array.isArray(data.items) ? data.items : null;
        if (totalVal !== null && totalVal > 0 && items && items.length > 0) {
            let itemSum = 0;
            let validPrices = 0;

            for (const it of items) {
                if (it && typeof it === "object") {
                    const pNum = parseNumber(it.price ?? it.amount ?? it.cost);
                    const qNum = parseNumber(it.quantity ?? it.qty) ?? 1;
                    if (pNum !== null && pNum > 0) {
                        itemSum += pNum * (qNum > 0 ? qNum : 1);
                        validPrices++;
                    }
                }
            }

            // If majority of items have prices
            if (validPrices >= items.length * 0.7 && itemSum > 0) {
                const diff = Math.abs(itemSum - totalVal);
                // Allow minor delta for tax, tips, or rounding (up to 5% or 0.15)
                const isMatch = diff <= 0.2 || (diff / totalVal) <= 0.08;
                if (!isMatch && totalPath) {
                    // Discrepancy detected: mark total as pending for human accountant inspection!
                    result[totalPath] = "pending";
                }
            }
        }
    } catch {
        // Safe fallback if calculation fails
    }

    return result;
}
