import { formatBytes } from "@/lib/utils";
import { getUploadLimits } from "@/lib/uploadLimits";

export const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp"
]);

/**
 * Validates document type and size constraints prior to processing.
 */
export function validateDocumentFile(file: File): { valid: boolean; error?: string } {
    const limits = getUploadLimits();
    if (!file) {
        return { valid: false, error: "No file selected." };
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
        return {
            valid: false,
            error: `Unsupported file type (${file.type || "unknown"}). Please upload a PDF or image (PNG, JPG, WebP).`
        };
    }

    // Multi-page PDFs are automatically sliced into lightweight streaming chunks
    if (file.size > limits.maxSourceFileBytes) {
        return {
            valid: false,
            error: `Файл слишком большой (${formatBytes(file.size)}). Максимум — ${formatBytes(limits.maxSourceFileBytes)}.`
        };
    }

    return { valid: true };
}

export function validateDocumentBatch(files: File[]): { valid: boolean; error?: string } {
    const limits = getUploadLimits();
    if (files.length > limits.maxBatchFiles) {
        return { valid: false, error: `В одном пакете можно загрузить не более ${limits.maxBatchFiles} документов.` };
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > limits.maxBatchSourceBytes) {
        return { valid: false, error: `Пакет слишком большой (${formatBytes(totalBytes)}). Максимум — ${formatBytes(limits.maxBatchSourceBytes)}.` };
    }
    for (const file of files) {
        const result = validateDocumentFile(file);
        if (!result.valid) return { valid: false, error: `${file.name}: ${result.error}` };
    }
    return { valid: true };
}

/**
 * Downscales and compresses large camera/scanner photos in the browser.
 * Keeps document details crisp (up to 2048px on the longest edge),
 * while reducing file size from 10-15MB down to ~500KB-1MB,
 * preventing Vercel 4.5MB payload limit errors and speeding up AI processing.
 */
export async function optimizeImageFile(
    file: File,
    maxDimension = getUploadLimits().maxImageDimension,
    quality = 0.85,
    force = false
): Promise<File> {
    if (!file.type.startsWith("image/")) {
        return file;
    }

    // Don't recompress SVGs or GIFs
    if (file.type === "image/svg+xml" || file.type === "image/gif") {
        return file;
    }

    // If file is already small (e.g. < 1.2MB) and force is not set, keep original bytes
    if (!force && file.size < 1.2 * 1024 * 1024) {
        return file;
    }

    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;

            // Only downscale if larger than maxDimension
            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                resolve(file);
                return;
            }

            // High-quality image smoothing for text readability
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (!blob || (!force && blob.size >= file.size)) {
                        // Keep original if compression didn't produce a smaller size
                        resolve(file);
                    } else {
                        const cleanName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                        const optimizedFile = new File([blob], cleanName, {
                            type: "image/jpeg",
                            lastModified: Date.now(),
                        });
                        console.log(
                            `[Media Optimizer] Compressed ${file.name} from ${formatBytes(file.size)} to ${formatBytes(optimizedFile.size)}`
                        );
                        resolve(optimizedFile);
                    }
                },
                "image/jpeg",
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}
