"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, BoundingBox } from "@/lib/types";
import { Document, Page, pdfjs } from 'react-pdf';
import { getPageTextItems, snapToPdfText } from "@/lib/pdfTextSnapper";
import { computeBoxView } from "@/lib/zoomToBox";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText, ZoomIn, ZoomOut, RotateCcw, AlertTriangle, Upload } from "lucide-react";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
    file: File;
    activeHighlight: ActiveHighlight | null;
    batchFiles?: File[];
    onFileReplaced?: (newFile: File) => void;
}

export function DocumentViewer({ file, activeHighlight, batchFiles, onFileReplaced }: DocumentViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const isBatchMode = Boolean(batchFiles && batchFiles.length > 1);
    const [currentBatchPage, setCurrentBatchPage] = useState(1);
    const [currentPdfPage, setCurrentPdfPage] = useState(1);
    const [zoomScale, setZoomScale] = useState(1.0);

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isPdf, setIsPdf] = useState(false);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
    const [snappedBox, setSnappedBox] = useState<BoundingBox | null>(null);
    const [isSnapped, setIsSnapped] = useState(false);
    const [imageError, setImageError] = useState(false);

    // Natural & base dimensions
    const [naturalDims, setNaturalDims] = useState<{ width: number; height: number }>({ width: 800, height: 1100 });
    const [baseDims, setBaseDims] = useState<{ width: number; height: number }>({ width: 700, height: 950 });

    const imageRef = useRef<HTMLImageElement | null>(null);

    // Active file to display
    const activeFile = isBatchMode && batchFiles && batchFiles.length > 0
        ? batchFiles[Math.max(0, Math.min(currentBatchPage - 1, batchFiles.length - 1))]
        : file;

    // Sync activeHighlight page/file to currentBatchPage or currentPdfPage
    useEffect(() => {
        if (!activeHighlight) return;
        if (isBatchMode && batchFiles && batchFiles.length > 0) {
            if (activeHighlight.fileName || activeHighlight.fileId) {
                const targetName = (activeHighlight.fileName || activeHighlight.fileId || "").toLowerCase();
                const idx = batchFiles.findIndex(f => {
                    const fn = f.name.toLowerCase();
                    return fn === targetName || fn.includes(targetName) || targetName.includes(fn);
                });
                if (idx !== -1 && idx + 1 !== currentBatchPage) {
                    setCurrentBatchPage(idx + 1);
                    return;
                }
            }
            if (activeHighlight.page && activeHighlight.page !== currentBatchPage) {
                const page = Math.max(1, Math.min(activeHighlight.page, batchFiles.length));
                setCurrentBatchPage(page);
            }
        } else if (isPdf && numPages && activeHighlight.page && activeHighlight.page !== currentPdfPage) {
            const page = Math.max(1, Math.min(activeHighlight.page, numPages));
            setCurrentPdfPage(page);
        }
    }, [activeHighlight, isBatchMode, batchFiles, isPdf, numPages, currentBatchPage, currentPdfPage]);

    // Sync file prop changes to currentBatchPage
    useEffect(() => {
        if (isBatchMode && batchFiles && file) {
            const idx = batchFiles.findIndex(f => f.name === file.name);
            if (idx !== -1 && idx + 1 !== currentBatchPage) {
                setCurrentBatchPage(idx + 1);
            }
        }
    }, [file, isBatchMode, batchFiles, currentBatchPage]);

    // Generate Object URL for the active file
    useEffect(() => {
        if (!activeFile) return;
        setImageError(false);
        const pdf = activeFile.type === "application/pdf" || activeFile.name.toLowerCase().endsWith(".pdf");
        setIsPdf(pdf);

        // Check if file is placeholder
        if (activeFile.size < 120 && activeFile.size > 0) {
            activeFile.text().then(txt => {
                if (txt.includes("[STITCHED_DOC_PLACEHOLDER]")) {
                    setImageError(true);
                }
            }).catch(() => {});
        }

        const url = URL.createObjectURL(activeFile);
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [activeFile]);

    // Calculate base dimensions fitting within viewport container
    const updateBaseDimensions = useCallback((natW: number, natH: number) => {
        setNaturalDims({ width: natW, height: natH });
        const container = containerRef.current;
        const contW = container ? Math.max(320, container.clientWidth - 48) : 750;
        const contH = container ? Math.max(400, container.clientHeight - 64) : 950;

        const scaleX = contW / natW;
        const scaleY = contH / natH;
        const fitScale = Math.min(scaleX, scaleY, 1.25);

        const bw = Math.round(natW * fitScale);
        const bh = Math.round(natH * fitScale);
        setBaseDims({ width: bw, height: bh });
    }, []);

    // Handle Image Load
    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        setImageError(false);
        const img = e.currentTarget;
        const nw = img.naturalWidth || 800;
        const nh = img.naturalHeight || 1100;
        updateBaseDimensions(nw, nh);
    };

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

    // Vector Text Snapping for PDFs
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
    }, [activeHighlight, isPdf, pdfDocProxy]);

    // Auto-scroll and smart-zoom when highlight changes
    useEffect(() => {
        if (!activeHighlight) {
            setZoomScale(1.0);
            return;
        }

        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;

        if (containerRef.current && baseDims.width > 0 && baseDims.height > 0 && effectiveBox && effectiveBox.length === 4) {
            const [ymin, xmin, ymax, xmax] = effectiveBox;
            const isZeroBox = ymin === 0 && xmin === 0 && ymax === 0 && xmax === 0;

            if (!isZeroBox) {
                const view = computeBoxView({
                    containerWidth: containerRef.current.clientWidth,
                    containerHeight: containerRef.current.clientHeight,
                    pageWidth: baseDims.width,
                    pageHeight: baseDims.height,
                    box: effectiveBox,
                    targetFill: 0.34,
                    minScale: 1.25,
                    maxScale: 3.5,
                });

                setZoomScale(view.scale);

                const timer = setTimeout(() => {
                    if (containerRef.current) {
                        const padOffset = view.scale > 1 ? 24 : 0;
                        containerRef.current.scrollTo({
                            left: view.scrollLeft + padOffset,
                            top: view.scrollTop + padOffset,
                            behavior: 'smooth'
                        });
                    }
                }, 60);
                return () => clearTimeout(timer);
            }
        }
    }, [activeHighlight, isSnapped, snappedBox, baseDims]);

    // Current rendered dimensions for DOM layout
    const renderedWidth = Math.round(baseDims.width * zoomScale);
    const renderedHeight = Math.round(baseDims.height * zoomScale);

    // Render bounding box overlay
    const renderHighlightOverlay = () => {
        if (!activeHighlight) return null;

        // Verify active file matches highlighted item in batch mode
        if (isBatchMode && activeHighlight.fileName && activeFile) {
            const targetName = activeHighlight.fileName.toLowerCase();
            const currName = activeFile.name.toLowerCase();
            if (!currName.includes(targetName) && !targetName.includes(currName)) {
                return null;
            }
        }

        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;
        if (!effectiveBox || effectiveBox.length !== 4) return null;

        const [ymin, xmin, ymax, xmax] = effectiveBox;
        if (ymin === 0 && xmin === 0 && ymax === 0 && xmax === 0) return null;

        const padX = Math.max(4, renderedWidth * 0.006);
        const padY = Math.max(3, renderedHeight * 0.005);

        const rawLeft = (xmin / 1000) * renderedWidth;
        const rawTop = (ymin / 1000) * renderedHeight;
        const rawWidth = ((xmax - xmin) / 1000) * renderedWidth;
        const rawHeight = ((ymax - ymin) / 1000) * renderedHeight;

        const pixelLeft = Math.max(0, rawLeft - padX);
        const pixelTop = Math.max(0, rawTop - padY);
        const pixelWidth = Math.min(renderedWidth - pixelLeft, rawWidth + padX * 2);
        const pixelHeight = Math.min(renderedHeight - pixelTop, rawHeight + padY * 2);

        const isNearTop = pixelTop < 36;

        return (
            <AnimatePresence>
                <motion.div
                    key={`highlight-${xmin}-${ymin}-${xmax}-${ymax}-${isSnapped}-${zoomScale}`}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 450, damping: 30 }}
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: `${pixelLeft}px`,
                        top: `${pixelTop}px`,
                        width: `${pixelWidth}px`,
                        height: `${pixelHeight}px`,
                    }}
                >
                    {/* Glowing highlight box */}
                    <div className="absolute inset-0 rounded-md border-2 border-amber-400/90 bg-amber-300/30 dark:bg-yellow-400/25 shadow-[0_0_18px_rgba(251,191,36,0.45),0_0_4px_rgba(251,191,36,0.6)_inset] backdrop-blur-[0.5px]" />
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-amber-500 rounded-tl-sm" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-amber-500 rounded-tr-sm" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-amber-500 rounded-bl-sm" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-amber-500 rounded-br-sm" />

                    {/* Detailed Label & Value Badge */}
                    {activeHighlight.label && (
                        <motion.div
                            initial={{ opacity: 0, y: isNearTop ? -6 : 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.08 }}
                            className={`absolute left-0 bg-amber-400 text-amber-950 text-[11px] font-bold tracking-tight px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap flex items-center gap-1.5 border border-amber-500/40 pointer-events-auto z-40 ${
                                isNearTop ? 'top-full mt-1.5' : '-top-8'
                            }`}
                        >
                            <span className="uppercase text-[10px] tracking-wider opacity-90">{activeHighlight.label}</span>
                            {activeHighlight.rawValue && (
                                <span className="font-mono font-extrabold bg-amber-950/15 text-amber-950 px-1.5 py-0.5 rounded text-[11px] border border-amber-950/10">
                                    : {activeHighlight.rawValue}
                                </span>
                            )}
                            {isSnapped && (
                                <span className="bg-emerald-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-normal">
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
            {isBatchMode && batchFiles && batchFiles.length > 0 && (
                <div className="w-full flex items-center justify-between px-3 py-2 bg-background/95 backdrop-blur-md border-b text-xs shrink-0 z-20 shadow-xs">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-bold text-foreground">
                            Документ {currentBatchPage} из {batchFiles.length}
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px] truncate max-w-[200px]" title={activeFile?.name}>
                            ({activeFile?.name || "документ"})
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

            {/* Document / Receipt Canvas Scroll Container */}
            <div
                ref={containerRef}
                className="w-full flex-1 overflow-auto relative bg-zinc-900/10 dark:bg-zinc-950/50"
            >
                {/* Floating Zoom Control Pill */}
                <div className="sticky top-2 ml-auto z-40 flex items-center gap-1 bg-background/85 backdrop-blur-md border px-2 py-1 rounded-full shadow-md text-xs mb-2 mr-3 w-fit">
                    <button
                        type="button"
                        onClick={() => setZoomScale(s => Math.max(0.6, Number((s - 0.25).toFixed(2))))}
                        className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                        title="Уменьшить (-)"
                    >
                        <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono text-[11px] font-semibold px-1 min-w-[42px] text-center">
                        {Math.round(zoomScale * 100)}%
                    </span>
                    <button
                        type="button"
                        onClick={() => setZoomScale(s => Math.min(4.0, Number((s + 0.25).toFixed(2))))}
                        className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                        title="Увеличить (+)"
                    >
                        <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    {zoomScale !== 1.0 && (
                        <button
                            type="button"
                            onClick={() => setZoomScale(1.0)}
                            className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors ml-0.5 border-l pl-1.5"
                            title="Сбросить масштаб (100%)"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Main Render Area */}
                {imageError ? (
                    <div className="min-w-full min-h-[60vh] flex items-center justify-center p-6">
                        <div className="p-6 bg-card border rounded-2xl shadow-lg text-center max-w-sm space-y-4">
                            <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center mx-auto">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div className="space-y-1.5">
                                <h4 className="font-semibold text-sm text-foreground">Скан документа недоступен</h4>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Файл <strong className="text-foreground">{activeFile?.name || "документа"}</strong> не сохранён в памяти браузера. Выберите файл для привязки и проверки.
                                </p>
                            </div>
                            <label className="cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg shadow-sm hover:bg-primary/90 transition-all w-full">
                                <Upload className="w-4 h-4" />
                                <span>Выбрать файл документа</span>
                                <input
                                    type="file"
                                    accept="image/*,application/pdf"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) {
                                            setImageError(false);
                                            onFileReplaced?.(f);
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    </div>
                ) : (
                    <div
                        className={`min-w-full min-h-full flex ${
                            zoomScale > 1.0 ? 'items-start justify-start p-6' : 'items-center justify-center p-4'
                        } relative`}
                    >
                        {isPdf ? (
                            <div
                                className="relative inline-block shadow-2xl rounded-lg border bg-white overflow-hidden transition-all duration-200"
                                style={{
                                    width: `${renderedWidth}px`,
                                    height: `${renderedHeight}px`,
                                    minWidth: `${renderedWidth}px`,
                                    minHeight: `${renderedHeight}px`,
                                }}
                            >
                                <Document
                                    file={objectUrl}
                                    className="flex flex-col items-center justify-center"
                                    onLoadSuccess={(pdf) => {
                                        setNumPages(pdf.numPages);
                                        setPdfDocProxy(pdf);
                                        pdf.getPage(1).then(p => {
                                            const vp = p.getViewport({ scale: 1 });
                                            updateBaseDimensions(vp.width, vp.height);
                                        }).catch(() => {});
                                    }}
                                    onLoadError={(err) => {
                                        console.warn("PDF load error:", err);
                                        setImageError(true);
                                    }}
                                >
                                    <Page
                                        pageNumber={currentPdfPage}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={false}
                                        width={renderedWidth}
                                        className="max-w-full"
                                    />
                                </Document>
                                {renderHighlightOverlay()}
                            </div>
                        ) : (
                            <div
                                className="relative inline-block shadow-2xl rounded-lg border bg-white overflow-hidden transition-all duration-200"
                                style={{
                                    width: `${renderedWidth}px`,
                                    height: `${renderedHeight}px`,
                                    minWidth: `${renderedWidth}px`,
                                    minHeight: `${renderedHeight}px`,
                                }}
                            >
                                <img
                                    ref={imageRef}
                                    src={objectUrl}
                                    alt="Document Scan"
                                    className={`w-full h-full object-contain transition-all duration-200 ${
                                        activeHighlight ? 'brightness-[0.93]' : ''
                                    }`}
                                    onLoad={handleImageLoad}
                                    onError={() => setImageError(true)}
                                />
                                {renderHighlightOverlay()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
