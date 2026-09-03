"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, BoundingBox } from "@/lib/types";
import { Document, Page, pdfjs } from 'react-pdf';
import { getPageTextItems, snapToPdfText } from "@/lib/pdfTextSnapper";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
    file: File;
    activeHighlight: ActiveHighlight | null;
}

export function DocumentViewer({ file, activeHighlight }: DocumentViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isPdf, setIsPdf] = useState(false);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
    const [snappedBox, setSnappedBox] = useState<BoundingBox | null>(null);
    const [isSnapped, setIsSnapped] = useState(false);

    // Store rendered dimensions per page (for PDFs) or for the single image
    const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());

    // Page container refs for scrolling to specific pages
    const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    // Image ref
    const imageRef = useRef<HTMLImageElement | null>(null);

    // Generate Object URL for the uploaded file
    useEffect(() => {
        setIsPdf(file.type === "application/pdf");
        const url = URL.createObjectURL(file);
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    // Track image dimensions
    const updateImageDimensions = useCallback(() => {
        if (imageRef.current) {
            setPageDimensions(new Map([[1, {
                width: imageRef.current.clientWidth,
                height: imageRef.current.clientHeight,
            }]]));
        }
    }, []);

    // ResizeObserver tracks container, sidebar, and window resize events automatically
    useEffect(() => {
        if (!containerRef.current) return;

        const updateAllDimensions = () => {
            // Update PDF page dimensions if available
            pageRefs.current.forEach((el, pageNum) => {
                const canvas = el.querySelector('canvas');
                if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
                    setPageDimensions(prev => {
                        const next = new Map(prev);
                        next.set(pageNum, { width: canvas.clientWidth, height: canvas.clientHeight });
                        return next;
                    });
                }
            });
            // Update image dimensions if available
            if (imageRef.current && imageRef.current.clientWidth > 0) {
                setPageDimensions(new Map([[1, {
                    width: imageRef.current.clientWidth,
                    height: imageRef.current.clientHeight,
                }]]));
            }
        };

        const observer = new ResizeObserver(updateAllDimensions);
        observer.observe(containerRef.current);
        window.addEventListener("resize", updateAllDimensions);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateAllDimensions);
        };
    }, []);

    // Track PDF page dimensions when a page renders
    const onPdfPageRenderSuccess = useCallback((pageNumber: number) => {
        const pageEl = pageRefs.current.get(pageNumber);
        if (pageEl) {
            // Find the canvas or rendered page element inside
            const canvas = pageEl.querySelector('canvas');
            if (canvas) {
                setPageDimensions(prev => {
                    const next = new Map(prev);
                    next.set(pageNumber, { width: canvas.clientWidth, height: canvas.clientHeight });
                    return next;
                });
            }
        }
    }, []);

    // Snap highlight box to exact vector text via pdf.js when available
    useEffect(() => {
        if (!activeHighlight) {
            setSnappedBox(null);
            setIsSnapped(false);
            return;
        }

        let isCancelled = false;

        if (isPdf && pdfDocProxy && activeHighlight.rawValue) {
            const pageNum = activeHighlight.page || 1;
            getPageTextItems(pdfDocProxy, pageNum).then(({ items, width, height }) => {
                if (isCancelled) return;
                const result = snapToPdfText(activeHighlight.rawValue!, activeHighlight.box_2d, items, width, height);
                if (result) {
                    setSnappedBox(result.box_2d);
                    setIsSnapped(true);
                } else {
                    setSnappedBox(null);
                    setIsSnapped(false);
                }
            }).catch(() => {
                if (!isCancelled) {
                    setSnappedBox(null);
                    setIsSnapped(false);
                }
            });
        } else {
            setSnappedBox(null);
            setIsSnapped(false);
        }

        return () => {
            isCancelled = true;
        };
    }, [activeHighlight, isPdf, pdfDocProxy]);

    // Auto-scroll to the highlighted page and exact box location when activeHighlight changes
    useEffect(() => {
        if (!activeHighlight) return;

        const targetPage = activeHighlight.page || 1;
        const dims = pageDimensions.get(targetPage);
        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;

        if (isPdf) {
            const pageEl = pageRefs.current.get(targetPage);
            if (pageEl && containerRef.current && dims) {
                const [ymin] = effectiveBox;
                const pixelTopInsidePage = (ymin / 1000) * dims.height;
                const targetScrollTop = pageEl.offsetTop + pixelTopInsidePage - containerRef.current.clientHeight / 2;
                containerRef.current.scrollTo({
                    top: Math.max(0, targetScrollTop),
                    behavior: 'smooth'
                });
            } else if (pageEl) {
                pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        // For images, scroll the container to show the highlighted area
        if (!isPdf && imageRef.current && containerRef.current && dims) {
            const [ymin] = effectiveBox;
            const pixelTop = (ymin / 1000) * dims.height;
            containerRef.current.scrollTo({
                top: Math.max(0, pixelTop - containerRef.current.clientHeight / 2 + imageRef.current.offsetTop),
                behavior: 'smooth'
            });
        }
    }, [activeHighlight, isPdf, pageDimensions, isSnapped, snappedBox]);

    // Render a bounding box overlay for a specific page
    const renderHighlightOverlay = (pageNumber: number) => {
        if (!activeHighlight || (activeHighlight.page || 1) !== pageNumber) return null;

        const dims = pageDimensions.get(pageNumber);
        if (!dims || dims.width === 0 || dims.height === 0) return null;

        // Use exact vector snapped box if available, otherwise fallback to model hint
        const effectiveBox = (isSnapped && snappedBox) ? snappedBox : activeHighlight.box_2d;
        const [ymin, xmin, ymax, xmax] = effectiveBox;

        // Add soft, natural breathing room (+4px horizontal, +3px vertical)
        // so text sits comfortably inside like a real highlighter pen
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
                    {/* Highlighter Marker effect with soft fluorescent glow & rounded corners */}
                    <div className="absolute inset-0 rounded-md border-2 border-amber-400/80 bg-amber-300/35 dark:bg-yellow-400/25 shadow-[0_0_15px_rgba(251,191,36,0.35),0_0_4px_rgba(251,191,36,0.5)_inset] backdrop-blur-[0.5px]" />

                    {/* Subtle corner brackets for high-tech precision */}
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-amber-500 rounded-tl-sm" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-amber-500 rounded-tr-sm" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-amber-500 rounded-bl-sm" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-amber-500 rounded-br-sm" />

                    {/* Optional label with vector snapped indicator badge */}
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
        <div
            ref={containerRef}
            className={`relative w-full h-full flex flex-col items-center justify-start overflow-y-auto bg-muted/30 border rounded-xl shadow-sm transition-all duration-300 ${activeHighlight ? 'ring-2 ring-yellow-400/20' : ''}`}
        >
            <div className="relative inline-block max-w-full w-full mx-auto my-4 transition-all duration-500">
                {/* Render PDF or Image based on file type */}
                {isPdf ? (
                    <div className="max-w-full shadow-2xl bg-white overflow-hidden flex flex-col items-center justify-start rounded-md border">
                        <Document
                            file={objectUrl}
                            className="flex flex-col items-center justify-center w-full"
                            onLoadSuccess={(pdf) => {
                                setNumPages(pdf.numPages);
                                setPdfDocProxy(pdf);
                            }}
                        >
                            {numPages ? (
                                Array.from(new Array(numPages), (el, index) => {
                                    const pageNum = index + 1;
                                    return (
                                        <div
                                            key={`page_container_${pageNum}`}
                                            id={`page-${pageNum}`}
                                            ref={(el) => { if (el) pageRefs.current.set(pageNum, el); }}
                                            className="mb-6 last:mb-0 shadow-sm border-b pb-4 w-full flex justify-center bg-white"
                                        >
                                            {/* Tightly wrap Page so bounding box overlay is positioned relative to the rendered canvas, not the full container */}
                                            <div className="relative inline-block shadow-md">
                                                <Page
                                                    pageNumber={pageNum}
                                                    renderTextLayer={true}
                                                    renderAnnotationLayer={false}
                                                    onRenderSuccess={() => onPdfPageRenderSuccess(pageNum)}
                                                    className="max-w-full"
                                                    width={containerRef.current ? Math.min(containerRef.current.clientWidth * 0.95, 1200) : 800}
                                                />
                                                {/* Bounding box overlay for this page */}
                                                {renderHighlightOverlay(pageNum)}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="h-40 w-full flex items-center justify-center text-muted-foreground animate-pulse">
                                    Loading Document...
                                </div>
                            )}
                        </Document>
                    </div>
                ) : (
                    <div className="flex justify-center w-full relative">
                        <div className="relative inline-block">
                            <img
                                ref={imageRef}
                                src={objectUrl}
                                alt="Document Viewer"
                                className={`max-w-[95%] object-contain shadow-2xl rounded-md transition-all duration-500 ${activeHighlight ? 'brightness-[0.85]' : ''}`}
                                onLoad={updateImageDimensions}
                            />
                            {/* Bounding box overlay for image */}
                            {renderHighlightOverlay(1)}
                        </div>
                    </div>
                )}
            </div>

            {/* Active Highlight Info Panel */}
            <AnimatePresence>
                {activeHighlight && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-[90%] w-max pointer-events-none"
                    >
                        <div className="bg-background/95 backdrop-blur-xl border-2 border-amber-400/40 shadow-2xl rounded-xl p-4 flex items-center gap-3 ring-4 ring-amber-400/10">
                            <div className={`w-3 h-3 rounded-full shadow-lg ${isSnapped ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-amber-400 shadow-amber-400/50'} animate-pulse`} />
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 tracking-widest">
                                        Spatial Traceability
                                    </span>
                                    {isSnapped ? (
                                        <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.2 rounded border border-emerald-500/20">
                                            ✓ Vector Exact (pdf.js)
                                        </span>
                                    ) : (
                                        <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-bold px-1.5 py-0.2 rounded border border-amber-500/20">
                                            Spatial Vision (Gemini)
                                        </span>
                                    )}
                                </div>
                                {activeHighlight.label && (
                                    <span className="text-sm font-medium text-foreground mt-0.5">
                                        {activeHighlight.label}
                                    </span>
                                )}
                                <span className="text-[10px] text-muted-foreground font-mono mt-1">
                                    Page {activeHighlight.page || 1} · Box [{(isSnapped && snappedBox ? snappedBox : activeHighlight.box_2d).map(n => Math.round(n)).join(', ')}]
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
