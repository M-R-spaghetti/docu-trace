"use client";

import * as React from "react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, File, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateDocumentFile, optimizeImageFile } from "@/lib/media";

interface DragDropZoneProps {
    onFileAccepted: (file: File) => void;
}

export function DragDropZone({ onFileAccepted }: DragDropZoneProps) {
    const [error, setError] = useState<string | null>(null);
    const [isOptimizing, setIsOptimizing] = useState(false);

    const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: any[]) => {
        if (rejectedFiles && rejectedFiles.length > 0) {
            const firstErr = rejectedFiles[0]?.errors?.[0]?.message || "Please upload a valid PDF or Image file under 10MB.";
            setError(firstErr);
            return;
        }

        if (acceptedFiles && acceptedFiles.length > 0) {
            const rawFile = acceptedFiles[0];
            const validation = validateDocumentFile(rawFile);
            if (!validation.valid) {
                setError(validation.error || "Invalid file.");
                return;
            }

            setError(null);
            if (rawFile.type.startsWith("image/")) {
                setIsOptimizing(true);
                try {
                    const optimized = await optimizeImageFile(rawFile);
                    onFileAccepted(optimized);
                } catch {
                    onFileAccepted(rawFile);
                } finally {
                    setIsOptimizing(false);
                }
            } else {
                onFileAccepted(rawFile);
            }
        }
    }, [onFileAccepted]);

    const { getRootProps, getInputProps, isDragActive, isFocused } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'image/*': ['.png', '.jpg', '.jpeg', '.webp']
        },
        maxFiles: 1,
        maxSize: 15 * 1024 * 1024, // 15MB drop limit before client optimization
    });

    return (
        <div className="w-full max-w-2xl mx-auto mt-8">
            <motion.div
                {...(getRootProps() as any)}
                className={cn(
                    "relative flex flex-col items-center justify-center w-full h-80 rounded-2xl border-2 border-dashed transition-colors cursor-pointer overflow-hidden",
                    isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 bg-muted/20 hover:bg-muted/40",
                    isFocused && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                initial={false}
                animate={{
                    scale: isDragActive ? 1.02 : 1,
                    borderColor: isDragActive ? "var(--primary)" : "var(--border)",
                }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
                <input {...getInputProps()} />

                <AnimatePresence mode="wait">
                    {isOptimizing ? (
                        <motion.div
                            key="optimizing"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col items-center justify-center space-y-4 text-center p-8"
                        >
                            <div className="p-4 rounded-full bg-primary/10 text-primary animate-pulse">
                                <Loader2 className="w-10 h-10 animate-spin" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-xl font-semibold tracking-tight">
                                    Optimizing Document Scan...
                                </h3>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    Scaling image resolution for fast, high-accuracy AI spatial extraction.
                                </p>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key={isDragActive ? "active" : "inactive"}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="flex flex-col items-center justify-center space-y-4 text-center p-8"
                        >
                            <div className={cn(
                                "p-4 rounded-full transition-colors",
                                isDragActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                            )}>
                                <UploadCloud className="w-10 h-10" />
                            </div>

                            <div className="space-y-1">
                                <h3 className="text-xl font-semibold tracking-tight">
                                    {isDragActive ? "Drop document here" : "Upload your document"}
                                </h3>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    Drag and drop your invoices or receipts here, or click to browse. Supports PDF (up to 4.5MB) and high-res images.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Animated background pulse when active */}
                {isDragActive && (
                    <motion.div
                        className="absolute inset-0 bg-primary/5 rounded-2xl -z-10"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", duration: 0.5 }}
                    />
                )}
            </motion.div>

            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -10, height: 0 }}
                        className="mt-4 flex items-center gap-2 text-sm text-destructive"
                    >
                        <AlertCircle className="w-4 h-4" />
                        <span>{error}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
