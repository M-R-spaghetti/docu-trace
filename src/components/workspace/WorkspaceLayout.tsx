"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ActiveHighlight, VerificationStateMap } from "@/lib/types";
import { DocRow, HumanReview } from "@/lib/batchTypes";
import { setByPath, explodeDoc } from "@/lib/flatten";
import dynamic from "next/dynamic";
import { DataTable } from "./DataTable";
import { BatchDataTable } from "./BatchDataTable";
import { PanelRightClose, PanelRightOpen, GripVertical, Maximize2, Minimize2, Files, FileText, Search, X, Sparkles, ChevronUp, Crosshair, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionContext } from "@/lib/sessionContext";

import { StreamingProgress } from "@/lib/streamingPipeline";

// Dynamically import the DocumentViewer, disabling SSR. 
// This prevents 'DOMMatrix is not defined' errors from react-pdf which relies on browser APIs.
const DocumentViewer = dynamic(
    () => import('./DocumentViewer').then((mod) => mod.DocumentViewer),
    { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center bg-muted/30 border rounded-xl animate-pulse" /> }
);

interface WorkspaceLayoutProps {
    file: File;
    data: any;
    isRefining?: boolean;
    onRefine?: (newPrompt: string) => Promise<void>;
    onDataChange?: (updatedExtracted: any, updatedVerificationState: VerificationStateMap) => void;
    onFileChange?: (file: File) => void;
    onBatchFilesChange?: (files: File[]) => void;
    verificationState?: VerificationStateMap;
    streamingProgress?: StreamingProgress | null;
    batchFiles?: { name: string; size: number }[];
    batchFileObjects?: File[];
    batchRows?: DocRow[];
    onBatchRowsChange?: (rows: DocRow[]) => void;
    onRetryFailed?: () => void;
    schema?: any;
    isProcessingBatch?: boolean;
}

export function WorkspaceLayout({
    file,
    data,
    isRefining,
    onRefine,
    onDataChange,
    onFileChange,
    onBatchFilesChange,
    verificationState,
    streamingProgress,
    batchFiles,
    batchFileObjects,
    batchRows,
    onBatchRowsChange,
    onRetryFailed,
    schema,
    isProcessingBatch,
}: WorkspaceLayoutProps) {
    const { switchToSession, activeSession } = useSessionContext();
    const isBatchMode = Boolean(batchRows && batchRows.length > 0);
    const [selectedBatchFile, setSelectedBatchFile] = useState<File>(file);
    const [selectedBatchRowId, setSelectedBatchRowId] = useState<string | undefined>(undefined);
    const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isFloating, setIsFloating] = useState(false);
    const [isFilesDrawerOpen, setIsFilesDrawerOpen] = useState(false);
    const [isAiOpen, setIsAiOpen] = useState(false);
    const [filesFilter, setFilesFilter] = useState("");
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        if (typeof window !== "undefined") {
            return isBatchMode ? Math.min(620, Math.max(500, Math.round(window.innerWidth * 0.34))) : 450;
        }
        return isBatchMode ? 520 : 450;
    });

    useEffect(() => {
        if (file) {
            setSelectedBatchFile(file);
        }
    }, [file]);

    const handleFileReplaced = (newFile: File) => {
        setSelectedBatchFile(newFile);
        onFileChange?.(newFile);
    };

    const handleBatchFilesReplaced = (newFiles: File[]) => {
        const clean = (value: string) => value.split('/').pop()?.split('\\').pop()?.toLowerCase().trim() || "";
        const replacements = new Map(newFiles.map(candidate => [clean(candidate.name), candidate]));
        const merged = (batchFileObjects || []).map(existing => replacements.get(clean(existing.name)) || existing);
        for (const candidate of newFiles) {
            if (!merged.some(existing => clean(existing.name) === clean(candidate.name))) merged.push(candidate);
        }
        const currentReplacement = replacements.get(clean(selectedBatchFile?.name || ""));
        if (currentReplacement) setSelectedBatchFile(currentReplacement);
        onBatchFilesChange?.(merged);
    };

    const handleSetActiveHighlight = (hl: ActiveHighlight | null) => {
        setActiveHighlight(hl);
        if (hl?.fileName && batchFileObjects && batchFileObjects.length > 0) {
            const clean = (s: string) => s.split('/').pop()?.split('\\').pop()?.toLowerCase().trim() || "";
            const targetName = clean(hl.fileName);
            const found = batchFileObjects.find(f => {
                const fn = clean(f.name);
                return fn === targetName || fn.includes(targetName) || targetName.includes(fn);
            });
            if (found && found !== selectedBatchFile) {
                setSelectedBatchFile(found);
            }
        }
    };

    const handleSelectBatchRow = useCallback((row: DocRow) => {
        setSelectedBatchRowId(row.fileId);
        if (row.file) setSelectedBatchFile(prev => prev === row.file ? prev : row.file);
        setActiveHighlight(prev => {
            if (!prev) return null;
            if (prev.fileId && prev.fileId !== row.fileId) return null;
            if (prev.fileName && prev.fileName !== row.fileName) return null;
            return prev;
        });
    }, []);

    const handleSelectBatchCell = useCallback((row: DocRow, _colKey: string, hl: ActiveHighlight) => {
        setSelectedBatchRowId(row.fileId);
        if (row.file) setSelectedBatchFile(prev => prev === row.file ? prev : row.file);
        setActiveHighlight(prev => {
            const unchanged = prev
                && prev.fileId === hl.fileId
                && prev.fileName === hl.fileName
                && prev.columnKey === hl.columnKey
                && prev.page === hl.page
                && prev.box_2d.every((value, index) => value === hl.box_2d[index]);
            return unchanged ? prev : hl;
        });
    }, []);

    // Auto-expand sidebar when batch mode activates
    useEffect(() => {
        if (isBatchMode && typeof window !== "undefined") {
            setSidebarWidth(prev => prev === 450
                ? Math.min(620, Math.max(500, Math.round(window.innerWidth * 0.34)))
                : prev
            );
        }
    }, [isBatchMode]);

    useEffect(() => {
        if (isBatchMode && batchRows && batchRows.length > 0 && !selectedBatchRowId) {
            setSelectedBatchRowId(batchRows[0].fileId);
            if (batchRows[0].file) setSelectedBatchFile(batchRows[0].file);
        }
    }, [isBatchMode, batchRows, selectedBatchRowId]);

    // Drag resizing logic
    const isDragging = useRef(false);

    const onPointerDown = (e: React.PointerEvent) => {
        isDragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onPointerMove = (e: PointerEvent) => {
            if (!isDragging.current) return;
            const newWidth = document.body.clientWidth - e.clientX - 32;
            const maxW = Math.max(620, window.innerWidth * 0.55);
            if (newWidth > 420 && newWidth < maxW) {
                setSidebarWidth(newWidth);
            }
        };

        const onPointerUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    return (
        <div className="w-full h-[calc(100vh-6rem)] max-w-none flex flex-col relative gap-2 bg-background p-2 rounded-xl">
            {/* Top Workspace Navigation Bar */}
            <div className="w-full h-9 px-3 bg-muted/30 border border-border/60 rounded-lg flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => switchToSession(null)}
                        className="h-6 px-2 text-xs gap-1.5 font-medium hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                        title="Вернуться к окну загрузки (обработка продолжится в фоне)"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>На главную</span>
                    </Button>
                    <div className="h-3.5 w-px bg-border shrink-0" />
                    <span className="font-semibold text-foreground truncate max-w-sm" title={selectedBatchFile?.name || file.name}>
                        {selectedBatchFile?.name || file.name}
                    </span>
                    {isBatchMode && batchRows && (
                        <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium shrink-0">
                            {batchRows.filter(r => r.status === 'done').length}/{batchRows.length} готово
                        </span>
                    )}
                    {activeSession?.statusMessage && (
                        <span className="inline-flex items-center gap-1.5 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono text-[10.5px] font-medium shadow-xs animate-pulse truncate max-w-xs md:max-w-md">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="truncate">{activeSession.statusMessage}</span>
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {batchFiles && batchFiles.length > 1 && (
                        <Button
                            variant={isFilesDrawerOpen ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setIsFilesDrawerOpen(p => !p)}
                            className="h-6 text-xs gap-1 px-2 font-medium"
                            title="Показать файлы пакета"
                        >
                            <Files className="w-3.5 h-3.5" />
                            <span>{batchFiles.length} файлов</span>
                        </Button>
                    )}
                </div>
            </div>

            {streamingProgress && streamingProgress.totalPages > 1 && (
                <div className="w-full bg-primary/10 border border-primary/20 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium shrink-0 mb-1">
                    <div className="flex items-center gap-3">
                        <span className="flex h-2.5 w-2.5 relative">
                            {streamingProgress.processedPages < streamingProgress.totalPages && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${streamingProgress.processedPages >= streamingProgress.totalPages ? 'bg-emerald-500' : 'bg-primary'}`}></span>
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                                {streamingProgress.processedPages >= streamingProgress.totalPages
                                    ? `✓ All ${streamingProgress.totalPages} Pages Extracted`
                                    : streamingProgress.processedPages === 0
                                        ? `Extracting Initial Chunk: Pages 1–${Math.min(5, streamingProgress.totalPages)} of ${streamingProgress.totalPages}...`
                                        : `Progressive Streaming: Pages 1–${streamingProgress.processedPages} of ${streamingProgress.totalPages} ready`}
                            </span>
                            {streamingProgress.isQuotaWaiting && (
                                <span className="inline-flex items-center gap-1.5 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-medium shadow-xs animate-pulse">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                    Google Rate Limit: Resuming in {streamingProgress.quotaWaitSeconds}s (you can review ready pages)
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                        {batchFiles && batchFiles.length > 1 && (
                            <Button
                                variant={isFilesDrawerOpen ? "default" : "outline"}
                                size="sm"
                                onClick={() => setIsFilesDrawerOpen(p => !p)}
                                className="h-7 text-xs gap-1.5 shadow-xs font-semibold px-2.5"
                                title="Список всех файлов пакета"
                            >
                                <Files className="w-3.5 h-3.5" />
                                <span>{batchFiles.length} файлов</span>
                            </Button>
                        )}
                        <span className="text-muted-foreground font-mono">
                            {streamingProgress.percent}%
                        </span>
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden border">
                            <div
                                className="h-full bg-primary transition-all duration-300 rounded-full"
                                style={{ width: `${streamingProgress.percent}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full flex-1 flex relative gap-2 overflow-hidden">
                {/* Collapsible Batch Files Sidebar */}
                {isFilesDrawerOpen && batchFiles && batchFiles.length > 1 && (
                    <div className="w-72 h-full border rounded-xl bg-card flex flex-col shrink-0 overflow-hidden shadow-sm animate-in slide-in-from-left duration-200">
                        <div className="p-3 border-b flex items-center justify-between bg-muted/20">
                            <div className="flex items-center gap-2">
                                <Files className="w-4 h-4 text-primary" />
                                <span className="font-bold text-xs">Файлы пакета ({batchFiles.length})</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-md"
                                onClick={() => setIsFilesDrawerOpen(false)}
                            >
                                <X className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                        <div className="p-2 border-b">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Поиск по файлам..."
                                    value={filesFilter}
                                    onChange={e => setFilesFilter(e.target.value)}
                                    className="w-full pl-7 pr-2 py-1 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {batchFiles
                                .map((f, idx) => ({ ...f, pageNum: idx + 1 }))
                                .filter(f => f.name.toLowerCase().includes(filesFilter.toLowerCase()))
                                .map((f) => {
                                    const isDone = streamingProgress ? f.pageNum <= streamingProgress.processedPages : false;
                                    const isCurrent = activeHighlight?.page === f.pageNum;
                                    return (
                                        <button
                                            key={f.pageNum}
                                            onClick={() => {
                                                setActiveHighlight({
                                                    label: f.name,
                                                    rawValue: f.name,
                                                    page: f.pageNum,
                                                    box_2d: [50, 50, 200, 400]
                                                });
                                            }}
                                            className={`w-full p-2 text-left rounded-lg text-xs transition-all flex items-center justify-between group ${
                                                isCurrent
                                                    ? 'bg-primary/15 border-primary/40 text-primary font-semibold border'
                                                    : 'hover:bg-muted/60 border border-transparent'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="font-mono text-[10px] text-muted-foreground w-5 text-right shrink-0">
                                                    #{f.pageNum}
                                                </span>
                                                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                <span className="truncate text-foreground text-xs" title={f.name}>
                                                    {f.name}
                                                </span>
                                            </div>
                                            <span className="shrink-0 ml-1">
                                                {isDone ? (
                                                    <span className="text-[10px] font-mono text-emerald-600 font-bold">✓ Стр.{f.pageNum}</span>
                                                ) : (
                                                    <span className="text-[10px] font-mono text-muted-foreground">⏳ Стр.{f.pageNum}</span>
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                )}

                {/* Main Canvas: Document Viewer */}
                <div
                    className={`h-full flex flex-col transition-all duration-300 relative rounded-xl overflow-hidden shadow-sm border min-w-0 ${!isFloating && isSidebarOpen ? 'flex-1' : 'w-full'
                        }`}
                >
                <div className="absolute bottom-4 right-4 z-50 flex gap-2">
                    {isSidebarOpen && !isFloating && (
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => setIsFloating(true)}
                            className="shadow-md border"
                            title="Float Data Panel"
                        >
                            <Minimize2 className="w-4 h-4" />
                        </Button>
                    )}
                    {(!isSidebarOpen || isFloating) && (
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => { setIsSidebarOpen(true); setIsFloating(false); }}
                            className="shadow-md border bg-primary/10 text-primary hover:bg-primary/20"
                            title="Show Sidebar"
                        >
                            <PanelRightOpen className="w-5 h-5" />
                        </Button>
                    )}
                </div>

                <DocumentViewer
                    file={selectedBatchFile || file}
                    activeHighlight={activeHighlight}
                    batchFiles={batchFileObjects}
                    onFileReplaced={handleFileReplaced}
                    onBatchFilesReplaced={handleBatchFilesReplaced}
                />
            </div>

            {/* Resizer Handle */}
            {isSidebarOpen && !isFloating && (
                <div
                    className="w-3 flex items-center justify-center cursor-col-resize hover:bg-muted transition-colors group z-10 rounded-md"
                    onPointerDown={onPointerDown}
                >
                    <GripVertical className="h-6 w-6 text-muted-foreground opacity-30 group-hover:opacity-100" />
                </div>
            )}

            {/* Right Pane: Extracted Data Sidebar */}
            {isSidebarOpen && (
                <div
                    className={`h-full flex flex-col transition-shadow overflow-hidden ${isFloating
                        ? 'fixed top-24 right-8 bottom-8 shadow-2xl border bg-background/95 backdrop-blur-xl rounded-xl z-50'
                        : 'flex-none'
                        }`}
                    style={{ width: `${sidebarWidth}px` }}
                >
                    <div className="absolute top-3 right-3 z-50 flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1">
                        {isFloating && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsFloating(false)}
                                className="h-8 w-8 hover:bg-muted"
                                title="Dock to Sidebar"
                            >
                                <Maximize2 className="w-4 h-4" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsSidebarOpen(false)}
                            className="h-8 w-8 hover:bg-muted"
                            title="Close Sidebar"
                        >
                            <PanelRightClose className="w-4 h-4 text-foreground/70" />
                        </Button>
                    </div>

                    {/* DataTable or BatchDataTable takes the full space */}
                    <div className="w-full flex-1 overflow-hidden">
                        {isBatchMode && batchRows ? (
                            <BatchDataTable
                                rows={batchRows}
                                selectedRowId={selectedBatchRowId}
                                onSelectRow={handleSelectBatchRow}
                                onSelectCellHighlight={handleSelectBatchCell}
                                onConfirmCell={(rowId, path) => {
                                    if (!onBatchRowsChange) return;
                                    const updated = batchRows.map(r => {
                                        if (r.fileId === rowId) {
                                            const currRev = r.reviews?.[path] || { auto: "ok", reasons: [], human: "unreviewed" };
                                            const nextHuman: HumanReview = currRev.human === "confirmed" ? "unreviewed" : "confirmed";
                                            return {
                                                ...r,
                                                reviews: {
                                                    ...r.reviews,
                                                    [path]: {
                                                        ...currRev,
                                                        human: nextHuman,
                                                        reviewedAt: Date.now(),
                                                    },
                                                },
                                            };
                                        }
                                        return r;
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onConfirmRow={(rowId, rowIndex) => {
                                    if (!onBatchRowsChange) return;
                                    const updated = batchRows.map(r => {
                                        if (r.fileId === rowId) {
                                            const flatList = explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error);
                                            const targetRow = flatList[rowIndex];
                                            if (!targetRow) return r;
                                            const newReviews = { ...r.reviews };
                                            for (const cell of Object.values(targetRow.cells)) {
                                                const curr = newReviews[cell.path] || { auto: "ok", reasons: [], human: "unreviewed" };
                                                newReviews[cell.path] = { ...curr, human: "confirmed", reviewedAt: Date.now() };
                                            }
                                            return { ...r, reviews: newReviews };
                                        }
                                        return r;
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onConfirmDoc={(rowId) => {
                                    if (!onBatchRowsChange) return;
                                    const updated = batchRows.map(r => {
                                        if (r.fileId === rowId) {
                                            const newReviews = { ...r.reviews };
                                            for (const k of Object.keys(newReviews)) {
                                                newReviews[k] = { ...newReviews[k], human: "confirmed", reviewedAt: Date.now() };
                                            }
                                            return { ...r, reviews: newReviews };
                                        }
                                        return r;
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onUpdateCell={(rowId, path, newVal) => {
                                    if (!onBatchRowsChange) return;
                                    const updated = batchRows.map(r => {
                                        if (r.fileId === rowId) {
                                            const updatedData = JSON.parse(JSON.stringify(r.data || {}));
                                            setByPath(updatedData, path, newVal);
                                            const currRev = r.reviews?.[path] || { auto: "ok", reasons: [], human: "unreviewed" };
                                            return {
                                                ...r,
                                                data: updatedData,
                                                reviews: {
                                                    ...r.reviews,
                                                    [path]: {
                                                        ...currRev,
                                                        human: "corrected" as const,
                                                        reviewedAt: Date.now(),
                                                    },
                                                },
                                            };
                                        }
                                        return r;
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onToggleVerifyCell={(rowId, path) => {
                                    if (!onBatchRowsChange) return;
                                    const updated = batchRows.map(r => {
                                        if (r.fileId === rowId) {
                                            const currRev = r.reviews?.[path] || { auto: "ok", reasons: [], human: "unreviewed" };
                                            const nextHuman: HumanReview = currRev.human === "confirmed" ? "unreviewed" : "confirmed";
                                            return {
                                                ...r,
                                                reviews: {
                                                    ...r.reviews,
                                                    [path]: {
                                                        ...currRev,
                                                        human: nextHuman,
                                                        reviewedAt: Date.now(),
                                                    },
                                                },
                                            };
                                        }
                                        return r;
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onBulkConfirmRows={(targetFlatRows) => {
                                    if (!onBatchRowsChange || !batchRows) return;
                                    const targetSet = new Set(targetFlatRows.map(fr => `${fr.fileId}-${fr.rowIndex}`));
                                    const updated = batchRows.map(r => {
                                        const flatList = explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error);
                                        const matching = flatList.filter((fr, idx) => targetSet.has(`${fr.fileId}-${idx}`));
                                        if (matching.length === 0) return r;

                                        const newReviews = { ...r.reviews };
                                        for (const fr of matching) {
                                            for (const cell of Object.values(fr.cells)) {
                                                const curr = newReviews[cell.path] || { auto: "ok", reasons: [], human: "unreviewed" };
                                                if (curr.human === "unreviewed") {
                                                    newReviews[cell.path] = {
                                                        ...curr,
                                                        human: "bulk_confirmed",
                                                        reviewedAt: Date.now(),
                                                    };
                                                }
                                            }
                                        }
                                        return { ...r, reviews: newReviews };
                                    });
                                    onBatchRowsChange(updated);
                                }}
                                onRetryFailed={onRetryFailed}
                                schema={schema}
                                isProcessing={isProcessingBatch}
                            />
                        ) : (
                            <DataTable
                                extracted={data}
                                setActiveHighlight={handleSetActiveHighlight}
                                onDataChange={onDataChange}
                                initialVerificationState={verificationState}
                                filename={selectedBatchFile?.name || file.name}
                            />
                        )}
                    </div>

                    {/* Collapsible AI refinement assistant */}
                    {onRefine && (
                        <div className="w-full flex-none border-t bg-background relative z-20">
                            <button
                                type="button"
                                onClick={() => setIsAiOpen(v => !v)}
                                className="w-full h-10 px-3 flex items-center justify-between text-xs font-semibold hover:bg-muted/50 transition-colors"
                                aria-expanded={isAiOpen}
                            >
                                <span className="flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                    Спросить AI о данных
                                </span>
                                <ChevronUp className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isAiOpen ? "" : "rotate-180"}`} />
                            </button>
                            {isAiOpen && <div className="p-3 pt-0 space-y-2">
                            {!isRefining && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 gap-2 text-xs border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                    onClick={() => onRefine("Повторно найди все уже извлечённые значения на исходном документе и исправь их точные координаты box_2d. Сохрани структуру и значения данных без изменений.")}
                                >
                                    <Crosshair className="w-3.5 h-3.5" />
                                    Обновить привязку к документу
                                </Button>
                            )}
                            {isRefining ? (
                                <div className="flex items-center justify-center h-10 rounded-md bg-primary/10 text-primary border border-primary/20 animate-pulse text-sm font-medium">
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    AI повторно анализирует документ…
                                </div>
                            ) : (
                                <form
                                    className="flex gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const form = e.target as HTMLFormElement;
                                        const input = form.elements.namedItem('prompt') as HTMLInputElement;
                                        if (input.value.trim()) {
                                            onRefine(input.value.trim());
                                            input.value = '';
                                        }
                                    }}
                                >
                                    <input
                                        name="prompt"
                                        placeholder="Например: исправь название поставщика…"
                                        className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex-1 backdrop-blur-sm shadow-sm"
                                        autoComplete="off"
                                    />
                                    <Button type="submit" size="sm" className="h-10 px-4 shadow-sm">
                                        Отправить
                                    </Button>
                                </form>
                            )}
                            </div>}
                        </div>
                    )}
                </div>
            )}
            </div>
        </div>
    );
}
