"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight } from "@/lib/types";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
    file: File;
    activeHighlight: ActiveHighlight | null;
}

export function DocumentViewer({ file, activeHighlight }: DocumentViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isPdf, setIsPdf] = useState(false);
    const [numPages, setNumPages] = useState<number | null>(null);

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

    useEffect(() => {
        window.addEventListener("resize", updateImageDimensions);
        return () => window.removeEventListener("resize", updateImageDimensions);
    }, [updateImageDimensions]);

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

    // Auto-scroll to the highlighted page when activeHighlight changes
    useEffect(() => {
        if (!activeHighlight) return;

        const targetPage = activeHighlight.page || 1;

        if (isPdf) {
            const pageEl = pageRefs.current.get(targetPage);
            if (pageEl && containerRef.current) {
                pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        // For images, scroll the container to show the highlighted area
        if (!isPdf && imageRef.current && containerRef.current) {
            const dims = pageDimensions.get(1);
            if (dims) {
                const [ymin] = activeHighlight.box_2d;
                const pixelTop = (ymin / 1000) * dims.height;
                // Scroll so the highlight is centered
                containerRef.current.scrollTo({
                    top: pixelTop - containerRef.current.clientHeight / 2 + imageRef.current.offsetTop,
                    behavior: 'smooth'
                });
            }
        }
    }, [activeHighlight, isPdf, pageDimensions]);

    // Render a bounding box overlay for a specific page
    const renderHighlightOverlay = (pageNumber: number) => {
        if (!activeHighlight || (activeHighlight.page || 1) !== pageNumber) return null;

        const dims = pageDimensions.get(pageNumber);
        if (!dims || dims.width === 0 || dims.height === 0) return null;

        const [ymin, xmin, ymax, xmax] = activeHighlight.box_2d;

        const pixelLeft = (xmin / 1000) * dims.width;
        const pixelTop = (ymin / 1000) * dims.height;
        const pixelWidth = ((xmax - xmin) / 1000) * dims.width;
        const pixelHeight = ((ymax - ymin) / 1000) * dims.height;

        return (
            <AnimatePresence>
                <motion.div
                    key={`highlight-${xmin}-${ymin}-${xmax}-${ymax}`}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: `${pixelLeft}px`,
                        top: `${pixelTop}px`,
                        width: `${pixelWidth}px`,
                        height: `${pixelHeight}px`,
                    }}
                >
                    {/* Glowing highlight box */}
                    <div className="absolute inset-0 rounded-sm border-2 border-yellow-400 bg-yellow-400/20 shadow-[0_0_20px_rgba(250,204,21,0.5),0_0_6px_rgba(250,204,21,0.6)_inset]" />

                    {/* Pulsing corner indicators */}
                    <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-yellow-400 rounded-tl-sm" />
                    <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-yellow-400 rounded-tr-sm" />
                    <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-yellow-400 rounded-bl-sm" />
                    <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-yellow-400 rounded-br-sm" />

                    {/* Optional label */}
                    {activeHighlight.label && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 }}
                            className="absolute -top-7 left-0 bg-yellow-400 text-yellow-950 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-t-md shadow-lg whitespace-nowrap"
                        >
                            {activeHighlight.label}
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
                            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                        >
                            {numPages ? (
                                Array.from(new Array(numPages), (el, index) => {
                                    const pageNum = index + 1;
                                    return (
                                        <div
                                            key={`page_container_${pageNum}`}
                                            id={`page-${pageNum}`}
                                            ref={(el) => { if (el) pageRefs.current.set(pageNum, el); }}
                                            className="mb-6 last:mb-0 shadow-sm border-b pb-4 w-full flex justify-center bg-white relative"
                                        >
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
                        <div className="bg-background/95 backdrop-blur-xl border-2 border-yellow-400/40 shadow-2xl rounded-xl p-4 flex items-center gap-3 ring-4 ring-yellow-400/10">
                            <div className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse shadow-lg shadow-yellow-400/50" />
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-yellow-600 tracking-widest">
                                    Spatial Traceability Active
                                </span>
                                {activeHighlight.label && (
                                    <span className="text-sm font-medium text-foreground mt-0.5">
                                        {activeHighlight.label}
                                    </span>
                                )}
                                <span className="text-[10px] text-muted-foreground font-mono mt-1">
                                    Page {activeHighlight.page || 1} · Box [{activeHighlight.box_2d.join(', ')}]
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
