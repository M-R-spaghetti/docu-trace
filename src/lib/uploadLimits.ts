export type UploadPlan = "default";

export interface UploadLimits {
    maxSourceFileBytes: number;
    maxPreparedRequestBytes: number;
    maxImageDimension: number;
    maxBatchFiles: number;
    maxBatchSourceBytes: number;
}

const MB = 1024 * 1024;

// Add future free/paid profiles here. Validation code consumes this object,
// so plan changes do not require scattered numeric edits.
export const UPLOAD_LIMIT_PROFILES: Record<UploadPlan, UploadLimits> = {
    default: {
        maxSourceFileBytes: 25 * MB,
        maxPreparedRequestBytes: 4 * MB,
        maxImageDimension: 2_000,
        maxBatchFiles: 100,
        maxBatchSourceBytes: 500 * MB,
    },
};

export function getUploadLimits(_plan: UploadPlan = "default"): UploadLimits {
    return UPLOAD_LIMIT_PROFILES.default;
}
