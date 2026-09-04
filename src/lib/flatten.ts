export interface FlatRowCell {
    path: string;
    node: any;
}

export interface FlatRow {
    fileId: string;
    fileName: string;
    file?: File;
    status: "queued" | "extracting" | "done" | "failed" | "timeout";
    error?: string;
    rowIndex: number;
    totalItemsInDoc: number;
    cells: Record<string, FlatRowCell>;
}

export function isLocatedValue(v: any): boolean {
    return v && typeof v === "object" && "value" in v && Array.isArray(v.box_2d);
}

/**
 * Bulletproof display value formatter.
 * Prevents [object Object] from ever reaching the UI.
 */
export function getDisplayValue(v: any): string {
    if (v === null || v === undefined) return "—";
    if (isLocatedValue(v)) {
        const val = v.value;
        if (val === null || val === undefined || String(val).trim() === "") return "—";
        return String(val);
    }
    if (Array.isArray(v)) return `${v.length} поз.`;
    if (typeof v === "object") {
        if ("value" in v) return String(v.value ?? "—");
        return "—";
    }
    const str = String(v).trim();
    return str === "" ? "—" : str;
}

/**
 * Recursively walks all leaf nodes that hold data or LocatedValues.
 * Collects paths like "store", "items[0].name", "items[0].price".
 */
export function walkLeaves(
    obj: any,
    prefix = "",
    out: { path: string; node: any }[] = []
): { path: string; node: any }[] {
    if (!obj) return out;

    if (isLocatedValue(obj)) {
        out.push({ path: prefix, node: obj });
        return out;
    }

    if (Array.isArray(obj)) {
        obj.forEach((v, i) => walkLeaves(v, `${prefix}[${i}]`, out));
        return out;
    }

    if (typeof obj === "object") {
        for (const k of Object.keys(obj)) {
            if (k === "markdown_text") continue;
            walkLeaves(obj[k], prefix ? `${prefix}.${k}` : k, out);
        }
        return out;
    }

    // Primitive leaf
    out.push({ path: prefix, node: obj });
    return out;
}

/**
 * Generates leaf-level verification key.
 */
export const vKey = (fileId: string, path: string): string => `${fileId}::${path}`;

/**
 * Explodes a single document into flat item-level rows.
 * If document has scalar fields (e.g. store, date, total) and an items array,
 * each item becomes its own row with base scalar fields repeated.
 */
export function explodeDoc(
    fileId: string,
    fileName: string,
    data: any,
    file?: File,
    status: "queued" | "extracting" | "done" | "failed" | "timeout" = "done",
    error?: string
): FlatRow[] {
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
        return [{
            fileId,
            fileName,
            file,
            status,
            error,
            rowIndex: 0,
            totalItemsInDoc: 0,
            cells: {},
        }];
    }

    const keys = Object.keys(data).filter(k => k !== "markdown_text");
    const scalarKeys = keys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k]));
    const arrayKeys = keys.filter(k => Array.isArray(data[k]) && !isLocatedValue(data[k]));

    const base: FlatRow["cells"] = {};
    for (const k of scalarKeys) {
        base[k] = { path: k, node: data[k] };
    }

    if (arrayKeys.length === 0) {
        return [{
            fileId,
            fileName,
            file,
            status,
            error,
            rowIndex: 0,
            totalItemsInDoc: 1,
            cells: base,
        }];
    }

    const rows: FlatRow[] = [];
    const primaryArrayKey = arrayKeys.includes("items") ? "items" : arrayKeys[0];
    const items = data[primaryArrayKey] as any[];

    if (!Array.isArray(items) || items.length === 0) {
        return [{
            fileId,
            fileName,
            file,
            status,
            error,
            rowIndex: 0,
            totalItemsInDoc: 0,
            cells: base,
        }];
    }

    items.forEach((el, i) => {
        const cells: FlatRow["cells"] = { ...base };
        if (el && typeof el === "object" && !isLocatedValue(el)) {
            for (const k of Object.keys(el)) {
                cells[k] = { path: `${primaryArrayKey}[${i}].${k}`, node: el[k] };
            }
        } else {
            cells[primaryArrayKey] = { path: `${primaryArrayKey}[${i}]`, node: el };
        }

        for (const ak of arrayKeys) {
            if (ak !== primaryArrayKey) {
                cells[ak] = { path: ak, node: data[ak] };
            }
        }

        rows.push({
            fileId,
            fileName,
            file,
            status,
            error,
            rowIndex: i,
            totalItemsInDoc: items.length,
            cells,
        });
    });

    return rows;
}

/**
 * Updates a value inside a document structure by dot/bracket path.
 * Preserves bounding box coordinates (box_2d) and tracks originalValue.
 */
export function setByPath(obj: any, path: string, newValue: any): any {
    if (!obj || typeof obj !== "object") return obj;

    const tokens = path
        .replace(/\[(\w+)\]/g, '.$1')
        .replace(/^\./, '')
        .split('.');

    let current = obj;
    for (let i = 0; i < tokens.length - 1; i++) {
        const token = tokens[i];
        if (current[token] === undefined) {
            current[token] = /^\d+$/.test(tokens[i + 1]) ? [] : {};
        }
        current = current[token];
    }

    const lastToken = tokens[tokens.length - 1];
    const existing = current[lastToken];

    if (isLocatedValue(existing)) {
        current[lastToken] = {
            ...existing,
            value: newValue,
            originalValue: existing.originalValue ?? existing.value,
        };
    } else {
        current[lastToken] = newValue;
    }

    return obj;
}
