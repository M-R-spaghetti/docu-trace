export type RowVerificationStatus = "pending" | "verified" | "edited";

export interface DocRow {
    fileId: string;                  // sha-256 hash of content or unique identifier
    fileName: string;
    file: File;
    data: Record<string, any>;       // { price: { value, box_2d, page: 1 }, ... }
    status: "queued" | "extracting" | "done" | "failed";
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
