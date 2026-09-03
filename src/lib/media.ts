import { formatBytes } from "@/lib/utils";

export const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp"
]);

export const VERCEL_PAYLOAD_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4.5 MB

/**
 * Validates document type and size constraints prior to processing.
 */
export function validateDocumentFile(file: File): { valid: boolean; error?: string } {
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

    // PDF files cannot be compressed on the client without heavy libraries;
    // warn immediately if it exceeds the serverless payload limit.
    if (isPdf && file.size > VERCEL_PAYLOAD_LIMIT_BYTES) {
        return {
            valid: false,
            error: `PDF file size (${formatBytes(file.size)}) exceeds the 4.5MB serverless limit. Please compress the PDF before uploading.`
        };
    }

    // General sanity limit for huge files (e.g. 25MB)
    if (file.size > 25 * 1024 * 1024) {
        return {
            valid: false,
            error: `File is too large (${formatBytes(file.size)}). Maximum supported upload is 25MB.`
        };
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
    maxDimension = 2048,
    quality = 0.85
): Promise<File> {
    if (!file.type.startsWith("image/")) {
        return file;
    }

    // Don't recompress SVGs or GIFs
    if (file.type === "image/svg+xml" || file.type === "image/gif") {
        return file;
    }

    // If file is already small (e.g. < 1.2MB), keep original bytes
    if (file.size < 1.2 * 1024 * 1024) {
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
                    if (!blob || blob.size >= file.size) {
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
