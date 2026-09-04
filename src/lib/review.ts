import { isLocatedValue, getDisplayValue, walkLeaves } from "./flatten";

export type AutoCheck = "ok" | "warn" | "error";
export type HumanReview = "unreviewed" | "confirmed" | "corrected";

export interface CellReview {
    auto: AutoCheck;
    reasons: string[];
    human: HumanReview;
    reviewedAt?: number;
    originalValue?: string;
}

/**
 * Generates a stable, deterministic file identifier across the entire pipeline.
 */
export function generateFileId(file: File): string {
    const cleanName = file.name.replace(/[^\w.-]/g, "_");
    return `${cleanName}_${file.size}_${file.lastModified}`;
}

export function parseNumber(val: any): number | null {
    if (val === null || val === undefined) return null;
    const raw = isLocatedValue(val) ? val.value : val;
    if (typeof raw === "number" && isFinite(raw)) return raw;

    const str = String(raw ?? "")
        .replace(/[\s\u00A0]/g, "")
        .replace(/[^\d.,\-]/g, "");

    if (!str) return null;

    // Handle Russian/European comma vs dot decimals
    // e.g. "1.250,50" -> "1250.50" or "12,50" -> "12.50"
    let clean = str;
    if (str.includes(",") && str.includes(".")) {
        if (str.indexOf(".") < str.indexOf(",")) {
            clean = str.replace(/\./g, "").replace(",", ".");
        } else {
            clean = str.replace(/,/g, "");
        }
    } else if (str.includes(",")) {
        clean = str.replace(",", ".");
    }

    const n = parseFloat(clean);
    return isFinite(n) ? n : null;
}

export interface DateAnalysis {
    parsedDate: Date | null;
    isoString: string | null;
    isAmbiguous: boolean;
    ambiguousAlternative?: string;
}

/**
 * Normalizes date strings and identifies ambiguous dates (e.g. 12-01-19).
 */
export function normalizeDate(str: string): DateAnalysis {
    const trimmed = str.trim();
    if (!trimmed || trimmed === "—") {
        return { parsedDate: null, isoString: null, isAmbiguous: false };
    }

    // Match patterns: DD.MM.YYYY, YYYY-MM-DD, DD/MM/YY, etc.
    const dmyPattern = /^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/;
    const ymdPattern = /^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})$/;

    const dmyMatch = trimmed.match(dmyPattern);
    if (dmyMatch) {
        let p1 = parseInt(dmyMatch[1], 10);
        let p2 = parseInt(dmyMatch[2], 10);
        let year = parseInt(dmyMatch[3], 10);
        if (year < 100) year += 2000;

        // Check if both p1 and p2 could be month (<= 12)
        const isAmbiguous = p1 <= 12 && p2 <= 12 && p1 !== p2;
        const ambiguousAlternative = isAmbiguous
            ? `${String(p2).padStart(2, "0")}/${String(p1).padStart(2, "0")}/${year}`
            : undefined;

        // Assume Day/Month/Year standard for receipts
        const day = p1 <= 31 ? p1 : p2;
        const month = p1 <= 31 ? p2 : p1;

        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const dateObj = new Date(year, month - 1, day);
            const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            return { parsedDate: dateObj, isoString: iso, isAmbiguous, ambiguousAlternative };
        }
    }

    const ymdMatch = trimmed.match(ymdPattern);
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const month = parseInt(ymdMatch[2], 10);
        const day = parseInt(ymdMatch[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const dateObj = new Date(year, month - 1, day);
            const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            return { parsedDate: dateObj, isoString: iso, isAmbiguous: false };
        }
    }

    const ts = Date.parse(trimmed);
    if (!isNaN(ts)) {
        const d = new Date(ts);
        return {
            parsedDate: d,
            isoString: d.toISOString().split("T")[0],
            isAmbiguous: false,
        };
    }

    return { parsedDate: null, isoString: null, isAmbiguous: false };
}

/**
 * Checks a single leaf cell against strict financial, geometric, and format rules.
 */
export function checkCell(
    path: string,
    node: any,
    sumContext?: { isMismatch: boolean; sum: number; total: number; totalPath?: string }
): { auto: AutoCheck; reasons: string[] } {
    const reasons: string[] = [];
    const disp = getDisplayValue(node);
    const key = path.toLowerCase();

    // 1. Empty value check
    if (disp === "—" || disp.trim() === "") {
        return { auto: "error", reasons: ["пустое значение"] };
    }

    // 2. Spatial vision coordinate check
    if (!isLocatedValue(node) || !node.box_2d || node.box_2d.length !== 4) {
        reasons.push("нет координат (нельзя верифицировать в источнике)");
    } else {
        const [ymin, xmin, ymax, xmax] = node.box_2d;
        if (ymin === 0 && xmin === 0 && ymax === 0 && xmax === 0) {
            reasons.push("нулевые координаты");
        }
    }

    // 3. Financial & Numeric checks
    if (/price|total|amount|sum|cost|tax|rate|fee/.test(key)) {
        const n = parseNumber(node);
        if (n === null) {
            reasons.push("не распознано как число");
        } else if (n < 0) {
            reasons.push("отрицательное число");
        } else if (n > 1_000_000) {
            reasons.push("подозрительно большая сумма (> 1 млн)");
        }

        if (/\d{1,3}[.,]\d{3}[.,]\d{2}/.test(disp)) {
            reasons.push("неоднозначный разделитель разрядов");
        }
    }

    // 4. Date checks
    if (/date/.test(key)) {
        const dateRes = normalizeDate(disp);
        if (!dateRes.parsedDate) {
            reasons.push("дата не распознана");
        } else {
            const time = dateRes.parsedDate.getTime();
            // Up to 1 day into future allowed for timezone differences
            if (time > Date.now() + 86400000) {
                reasons.push("дата в будущем");
            } else if (time < Date.parse("2000-01-01")) {
                reasons.push("дата раньше 2000 года");
            }

            if (dateRes.isAmbiguous) {
                reasons.push(`неоднозначный формат даты (возможно ${dateRes.ambiguousAlternative})`);
            }
        }
    }

    // 5. Quantity checks
    if (/quantity|qty|count/.test(key)) {
        const n = parseNumber(node);
        if (n === null || n <= 0) {
            reasons.push("некорректное количество (<= 0)");
        } else if (n > 1000) {
            reasons.push("подозрительно большое количество (> 1000)");
        }
    }

    // 6. Mathematical sum discrepancy
    if (sumContext && sumContext.isMismatch) {
        if (path === sumContext.totalPath || /total|amount_due/i.test(key)) {
            reasons.push(`сумма позиций (${sumContext.sum.toFixed(2)}) ≠ итог чека (${sumContext.total.toFixed(2)})`);
        }
    }

    if (reasons.length === 0) {
        return { auto: "ok", reasons: [] };
    }

    const hasError = reasons.some(r =>
        r.includes("пустое") ||
        r.includes("не распознано как число") ||
        r.includes("отрицательное") ||
        r.includes("дата не распознана")
    );

    return {
        auto: hasError ? "error" : "warn",
        reasons,
    };
}

/**
 * Runs full audit on an extracted receipt document.
 * Checks all leaves and cross-validates line items against document total.
 */
export function auditReceiptDoc(docData: any): Record<string, CellReview> {
    const reviews: Record<string, CellReview> = {};
    if (!docData || typeof docData !== "object") return reviews;

    const leaves = walkLeaves(docData);

    // 1. Find Total and Items
    let totalVal: number | null = null;
    let totalPath: string | undefined = undefined;

    for (const leaf of leaves) {
        const key = leaf.path.toLowerCase();
        if (/total_amount|grand_total|amount_due|total$|balance_due/i.test(key)) {
            const n = parseNumber(leaf.node);
            if (n !== null && n > 0) {
                totalVal = n;
                totalPath = leaf.path;
                break;
            }
        }
    }

    let sumContext: { isMismatch: boolean; sum: number; total: number; totalPath?: string } | undefined = undefined;
    const items = Array.isArray(docData.items) ? docData.items : null;

    if (totalVal !== null && items && items.length > 0) {
        let itemSum = 0;
        let pricedItemsCount = 0;

        for (const it of items) {
            if (it && typeof it === "object") {
                // If item has amount, use amount. Else price * (qty || 1)
                const amountVal = parseNumber(it.amount ?? it.total ?? it.subtotal);
                const priceVal = parseNumber(it.price ?? it.cost);
                const qtyVal = parseNumber(it.quantity ?? it.qty) ?? 1;

                if (amountVal !== null && amountVal > 0) {
                    itemSum += amountVal;
                    pricedItemsCount++;
                } else if (priceVal !== null && priceVal > 0) {
                    itemSum += priceVal * (qtyVal > 0 ? qtyVal : 1);
                    pricedItemsCount++;
                }
            }
        }

        if (pricedItemsCount >= items.length * 0.7 && itemSum > 0) {
            const delta = Math.abs(itemSum - totalVal);
            // Strict tolerance: max(0.02, 0.5% of total)
            const tolerance = Math.max(0.02, totalVal * 0.005);
            if (delta > tolerance) {
                sumContext = {
                    isMismatch: true,
                    sum: itemSum,
                    total: totalVal,
                    totalPath,
                };
            }
        }
    }

    // 2. Audit each leaf
    for (const leaf of leaves) {
        const { auto, reasons } = checkCell(leaf.path, leaf.node, sumContext);
        reviews[leaf.path] = {
            auto,
            reasons,
            human: "unreviewed",
        };
    }

    return reviews;
}
