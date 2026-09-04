export type RowVerificationStatus = "pending" | "verified" | "edited" | "auto_verified";

export interface DocRow {
    fileId: string;                  // sha-256 hash of content or unique identifier
    fileName: string;
    file: File;
    data: Record<string, any>;       // { price: { value, box_2d, page: 1 }, items: [...] }
    status: "queued" | "extracting" | "done" | "failed" | "timeout";
    error?: string;
    verified: Record<string, RowVerificationStatus>;
    editedValues?: Record<string, string>;
}

export interface BatchProgressInfo {
    total: number;
    completed: number;
    failed: number;
    active: number;
    percent: number;
}

export type { FlatRow, FlatRowCell } from "./flatten";
