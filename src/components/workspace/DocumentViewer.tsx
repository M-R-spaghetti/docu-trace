"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, BoundingBox } from "@/lib/types";
import { Document, Page, pdfjs } from 'react-pdf';
import { getPageTextItems, snapToPdfText } from "@/lib/pdfTextSnapper";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Receipt, FileText } from "lucide-react";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
    file: File;
    activeHighlight: ActiveHighlight | null;
    batchFiles?: File[];
}

export function DocumentViewer({ file, activeHighlight, batchFiles }: DocumentViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const isBatchMode = Boolean(batchFiles && batchFiles.length > 1);
    const [currentBatchPage, setCurrentBatchPage] = useState(1);
    const [currentPdfPage, setCurrentPdfPage] = useState(1);

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isPdf, setIsPdf] = useState(false);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
    const [snappedBox, setSnappedBox] = useState<BoundingBox | null>(null);
    const [isSnapped, setIsSnapped] = useState(false);

    // Store rendered dimensions per page (for PDFs) or for the active image
    const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());

    const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const imageRef = useRef<HTMLImageElement | null>(null);

    // Sync activeHighlight page to currentBatchPage or currentPdfPage
    useEffect(() => {
        if (!activeHighlight?.page) return;
        if (isBatchMode && batchFiles) {
            const page = Math.max(1, Math.min(activeHighlight.page, batchFiles.length));
            setCurrentBatchPage(page);
        } else if (isPdf && numPages) {
            const page = Math.max(1, Math.min(activeHighlight.page, numPages));
            setCurrentPdfPage(page);
        }
    }, [activeHighlight, isBatchMode, batchFiles, isPdf, numPages]);

    // Active file to display
    const activeFile = isBatchMode && batchFiles
        ? batchFiles[Math.max(0, Math.min(currentBatchPage - 1, batchFiles.length - 1))]
        : file;

    // Generate Object URL for the active file
    useEffect(() => {
        if (!activeFile) return;
        const pdf = activeFile.type === "application/pdf";
        setIsPdf(pdf);
        const url = URL.createObjectURL(activeFile);
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [activeFile]);

    // Track image dimensions
    const updateImageDimensions = useCallback(() => {
        if (imageRef.current) {
            const pageNum = isBatchMode ? currentBatchPage : 1;
            setPageDimensions(new Map([[pageNum, {
                width: imageRef.current.clientWidth,
                height: imageRef.current.clientHeight,
            }]]));
        }
    }, [isBatchMode, currentBatchPage]);

    // Keyboard navigation between receipts / pages
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === "ArrowLeft") {
                if (isBatchMode && batchFiles) {
                    setCurrentBatchPage(p => Math.max(1, p - 1));
                } else if (isPdf && numPages) {
                    setCurrentPdfPage(p => Math.max(1, p - 1));
                }
            } else if (e.key === "ArrowRight") {
                if (isBatchMode && batchFiles) {
                    setCurrentBatchPage(p => Math.min(batchFiles.length, p + 1));
                } else if (isPdf && numPages) {
                    setCurrentPdfPage(p => Math.min(numPages, p + 1));
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isBatchMode, batchFiles, isPdf, numPages]);

    // ResizeObserver tracks container resize events
    useEffect(() => {
        if (!containerRef.current) return;

        const updateAllDimensions = () => {
            if (isPdf) {
                const canvas = containerRef.current?.querySelector('canvas');
                if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
                    setPageDimensions(prev => {
                        const next = new Map(prev);
                        next.set(currentPdfPage, { width: canvas.clientWidth, height: canvas.clientHeight });
                        return next;
                    });
                }
            } else if (imageRef.current && imageRef.current.clientWidth > 0) {
                updateImageDimensions();
            }
        };

        const observer = new ResizeObserver(() => {
            updateAllDimensions();
        });

        observer.observe(containerRef.current);
        window.addEventListener('resize', updateAllDimensions);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateAllDimensions);
        };
    }, [isPdf, currentPdfPage, updateImageDimensions]);

    const onPdfPageRenderSuccess = useCallback((pageNum: number) => {
        const pageEl = pageRefs.current.get(pageNum) || containerRef.current;
        if (pageEl) {
            const canvas = pageEl.querySelector('canvas');
            if (canvas && canvas.clientWidth > 0) {
                setPageDimensions(prev => {
                    const next = new Map(prev);
                    next.set(pageNum, { width: canvas.clientWidth, height: canvas.clientHeight });
                    return next;
                });
            }
        }
    }, []);

    // Vector Text Snapping
    useEffect(() => {
        if (!activeHighlight || !isPdf || !pdfDocProxy) {
            setSnappedBox(null);
            setIsSnapped(false);
            return;
        }

        let isCancelled = false;
        const pageNumber = activeHighlight.page || 1;

        getPageTextItems(pdfDocProxy, pageNumber).then(pageData => {
            if (isCancelled || !pageData || pageData.items.length === 0) return;

            const targetVal = activeHighlight.rawValue || activeHighlight.label || '';
            const snapped = snapToPdfText(
                targetVal,
                activeHighlight.box_2d,
                pageData.items,
                pageData.width,
                pageData.height
            );

            if (snapped) {
                setSnappedBox(snapped.box_2d);
                setIsSnapped(true);
            } else {
                setSnappedBox(null);
                setIsSnapped(false);
            }
        }).catch(err => {
            console.warn("Vector text snapping error:", err);
            setSnappedBox(null);
            setIsSnapped(false);
        });

        return () => {
            isCancelled = true;
        };
    }, [activeHighlight, isPdf, pdfDocProxy, pageDimensions]);

    // Auto-scroll when highlight changes
    useEffect(() => {
        if (!activeHighlight) return;
        const targetPage = activeHighlight.page || 1;
        const dims = pageDimensions.get(targetPage);
        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;

        if (imageRef.current && containerRef.current && dims) {
            const [ymin] = effectiveBox;
            const pixelTop = (ymin / 1000) * dims.height;
            containerRef.current.scrollTo({
                top: Math.max(0, pixelTop - containerRef.current.clientHeight / 2 + imageRef.current.offsetTop),
                behavior: 'smooth'
            });
        }
    }, [activeHighlight, pageDimensions, isSnapped, snappedBox]);

    // Render bounding box overlay
    const renderHighlightOverlay = (pageNumber: number) => {
        if (!activeHighlight || (activeHighlight.page || 1) !== pageNumber) return null;

        const dims = pageDimensions.get(pageNumber);
        if (!dims || dims.width === 0 || dims.height === 0) return null;

        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;
        const [ymin, xmin, ymax, xmax] = effectiveBox;

        const padX = Math.max(4, dims.width * 0.005);
        const padY = Math.max(3, dims.height * 0.004);

        const rawLeft = (xmin / 1000) * dims.width;
        const rawTop = (ymin / 1000) * dims.height;
        const rawWidth = ((xmax - xmin) / 1000) * dims.width;
        const rawHeight = ((ymax - ymin) / 1000) * dims.height;

        const pixelLeft = Math.max(0, rawLeft - padX);
        const pixelTop = Math.max(0, rawTop - padY);
        const pixelWidth = Math.min(dims.width - pixelLeft, rawWidth + padX * 2);
        const pixelHeight = Math.min(dims.height - pixelTop, rawHeight + padY * 2);

        return (
            <AnimatePresence>
                <motion.div
                    key={`highlight-${pageNumber}-${xmin}-${ymin}-${xmax}-${ymax}-${isSnapped}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: `${pixelLeft}px`,
                        top: `${pixelTop}px`,
                        width: `${pixelWidth}px`,
                        height: `${pixelHeight}px`,
                    }}
                >
                    <div className="absolute inset-0 rounded-md border-2 border-amber-400/80 bg-amber-300/35 dark:bg-yellow-400/25 shadow-[0_0_15px_rgba(251,191,36,0.35),0_0_4px_rgba(251,191,36,0.5)_inset] backdrop-blur-[0.5px]" />
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-amber-500 rounded-tl-sm" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-amber-500 rounded-tr-sm" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-amber-500 rounded-bl-sm" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-amber-500 rounded-br-sm" />

                    {activeHighlight.label && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="absolute -top-7 left-0 bg-amber-400 text-amber-950 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-lg whitespace-nowrap flex items-center gap-1.5 border border-amber-500/30"
                        >
                            <span>{activeHighlight.label}</span>
                            {isSnapped && (
                                <span className="bg-emerald-600 text-white text-[8px] font-extrabold px-1 py-0.2 rounded tracking-normal">
                                    VECTOR SNAPPED
                                </span>
                            )}
                        </motion.div>
                    )}
                </motion.div>
            </AnimatePresence>
        );
    };

    if (!objectUrl) return null;

    return (
        <div className="relative w-full h-full flex flex-col items-center justify-start overflow-hidden bg-muted/20 border rounded-xl shadow-sm">
            {/* Top Navigation Bar for Multi-Document Batch */}
            {isBatchMode && batchFiles && (
                <div className="w-full flex items-center justify-between px-3 py-2 bg-background/95 backdrop-blur-md border-b text-xs shrink-0 z-20 shadow-xs">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-bold text-foreground">
                            Документ {currentBatchPage} из {batchFiles.length}
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px] truncate max-w-[200px]" title={activeFile.name}>
                            ({activeFile.name})
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            disabled={currentBatchPage <= 1}
                            onClick={() => setCurrentBatchPage(p => Math.max(1, p - 1))}
                            title="Предыдущий документ (←)"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="font-mono text-[11px] px-1 font-semibold text-muted-foreground">
                            {currentBatchPage} / {batchFiles.length}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            disabled={currentBatchPage >= batchFiles.length}
                            onClick={() => setCurrentBatchPage(p => Math.min(batchFiles.length, p + 1))}
                            title="Следующий документ (→)"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Top Navigation Bar for Multi-Page PDF */}
            {!isBatchMode && isPdf && numPages && numPages > 1 && (
                <div className="w-full flex items-center justify-between px-3 py-2 bg-background/95 backdrop-blur-md border-b text-xs shrink-0 z-20 shadow-xs">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-bold text-foreground">
                            Страница {currentPdfPage} из {numPages}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            disabled={currentPdfPage <= 1}
                            onClick={() => setCurrentPdfPage(p => Math.max(1, p - 1))}
                            title="Предыдущая страница (←)"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="font-mono text-[11px] px-1 font-semibold text-muted-foreground">
                            {currentPdfPage} / {numPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            disabled={currentPdfPage >= numPages}
                            onClick={() => setCurrentPdfPage(p => Math.min(numPages, p + 1))}
                            title="Следующая страница (→)"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Document / Receipt Canvas Container */}
            <div
                ref={containerRef}
                className="w-full flex-1 overflow-y-auto p-4 flex flex-col items-center justify-start"
            >
                {isPdf ? (
                    <div className="shadow-xl bg-white rounded-lg border overflow-hidden flex flex-col items-center justify-center">
                        <Document
                            file={objectUrl}
                            className="flex flex-col items-center justify-center"
                            onLoadSuccess={(pdf) => {
                                setNumPages(pdf.numPages);
                                setPdfDocProxy(pdf);
                            }}
                        >
                            <div className="relative inline-block">
                                <Page
                                    pageNumber={currentPdfPage}
                                    renderTextLayer={true}
                                    renderAnnotationLayer={false}
                                    onRenderSuccess={() => onPdfPageRenderSuccess(currentPdfPage)}
                                    className="max-w-full"
                                    width={containerRef.current ? Math.min(containerRef.current.clientWidth * 0.92, 1000) : 750}
                                />
                                {renderHighlightOverlay(currentPdfPage)}
                            </div>
                        </Document>
                    </div>
                ) : (
                    <div className="flex justify-center w-full relative">
                        <div className="relative inline-block">
                            <img
                                ref={imageRef}
                                src={objectUrl}
                                alt="Document Viewer"
                                className={`max-w-[95%] max-h-[82vh] object-contain shadow-xl rounded-lg border bg-white transition-all duration-300 ${
                                    activeHighlight ? 'brightness-[0.9]' : ''
                                }`}
                                onLoad={updateImageDimensions}
                            />
                            {renderHighlightOverlay(isBatchMode ? currentBatchPage : 1)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
