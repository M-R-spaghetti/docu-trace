"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DocRow, CellReview, AutoCheck, HumanReview, FlatRow } from "@/lib/batchTypes";
import { ActiveHighlight } from "@/lib/types";
import { explodeDoc, getDisplayValue, isLocatedValue } from "@/lib/flatten";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportBatchToCSV, exportBatchToExcel, exportBatchToJSON } from "@/lib/export";
import { motion, AnimatePresence } from "framer-motion";
import {
    CheckCircle2,
    AlertCircle,
    Loader2,
    Download,
    Search,
    MapPin,
    Check,
    Pencil,
    FileText,
    RefreshCw,
    ShieldCheck,
    ShieldAlert,
    ShieldX,
    Clock,
    Zap,
    X,
    ChevronRight,
    ChevronLeft,
    Keyboard
} from "lucide-react";

interface BatchDataTableProps {
    rows: DocRow[];
    selectedRowId?: string;
    onSelectRow: (row: DocRow) => void;
    onSelectCellHighlight: (row: DocRow, colKey: string, highlight: ActiveHighlight) => void;
    onUpdateCell?: (rowId: string, path: string, newValue: string) => void;
    onConfirmCell?: (rowId: string, path: string) => void;
    onConfirmRow?: (rowId: string, rowIndex: number) => void;
    onConfirmDoc?: (rowId: string) => void;
    onToggleVerifyCell?: (rowId: string, path: string) => void;
    onRetryFailed?: () => void;
    schema?: any;
    isProcessing?: boolean;
}

function formatHeader(key: string) {
    return key
        .replace(/_/g, " ")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, str => str.toUpperCase());
}

export function BatchDataTable({
    rows,
    selectedRowId,
    onSelectRow,
    onSelectCellHighlight,
    onUpdateCell,
    onConfirmCell,
    onConfirmRow,
    onConfirmDoc,
    onToggleVerifyCell,
    onRetryFailed,
    schema,
    isProcessing,
}: BatchDataTableProps) {
    // 3 user-aligned filters:
    // 1. "warnings": auto !== "ok" (only suspicious/error fields)
    // 2. "unreviewed": human === "unreviewed"
    // 3. "confirmed": human === "confirmed" | "corrected"
    // 4. "all": all rows
    const [filter, setFilter] = useState<"all" | "warnings" | "unreviewed" | "confirmed">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [exportFormat, setExportFormat] = useState<"csv" | "excel" | "json">("excel");
    const [editingCell, setEditingCell] = useState<{ rowId: string; path: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);

    // Audit Review Queue Mode
    const [isReviewMode, setIsReviewMode] = useState(false);
    const [queueIndex, setQueueIndex] = useState(0);
    const [isEditingInQueue, setIsEditingInQueue] = useState(false);
    const [queueEditValue, setQueueEditValue] = useState("");
    const queueInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingCell && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingCell]);

    useEffect(() => {
        if (isEditingInQueue && queueInputRef.current) {
            queueInputRef.current.focus();
            queueInputRef.current.select();
        }
    }, [isEditingInQueue]);

    // O(1) Document Lookup Map
    const docMap = useMemo(() => {
        const m = new Map<string, DocRow>();
        for (const r of rows) {
            m.set(r.fileId, r);
            m.set(r.fileName, r);
        }
        return m;
    }, [rows]);

    // Explode each document into item-level flat rows
    const flatRows: FlatRow[] = useMemo(() => {
        return rows.flatMap(r => explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error));
    }, [rows]);

    // Derive columns: scalar document properties first, then item properties
    const columns = useMemo(() => {
        const docCols = new Set<string>();
        const itemCols = new Set<string>();

        if (schema?.properties) {
            for (const [k, v] of Object.entries(schema.properties)) {
                if (k === "markdown_text") continue;
                if (k === "items" && (v as any)?.items?.properties) {
                    for (const ik of Object.keys((v as any).items.properties)) {
                        itemCols.add(ik);
                    }
                } else {
                    docCols.add(k);
                }
            }
        }

        for (const fr of flatRows) {
            for (const k of Object.keys(fr.cells)) {
                if (k === "items") continue;
                if (!docCols.has(k) && !itemCols.has(k)) {
                    itemCols.add(k);
                }
            }
        }

        return [...Array.from(docCols), ...Array.from(itemCols)];
    }, [schema, flatRows]);

    // Accurate metrics: count only real visible columns across flat rows
    const stats = useMemo(() => {
        let totalVisibleCells = 0;
        let autoOkCells = 0;
        let autoWarnCells = 0;
        let autoErrorCells = 0;
        let humanConfirmedCells = 0;
        let humanCorrectedCells = 0;
        let failedDocs = 0;

        for (const r of rows) {
            if (r.status === "failed" || r.status === "timeout") failedDocs++;
        }

        for (const fr of flatRows) {
            const parentDoc = docMap.get(fr.fileId);
            for (const col of columns) {
                const cell = fr.cells[col];
                if (!cell) continue;
                totalVisibleCells++;

                const rev: CellReview | undefined = parentDoc?.reviews?.[cell.path];
                const auto = rev?.auto ?? "ok";
                const human = rev?.human ?? "unreviewed";

                if (auto === "ok") autoOkCells++;
                else if (auto === "warn") autoWarnCells++;
                else if (auto === "error") autoErrorCells++;

                if (human === "confirmed") humanConfirmedCells++;
                else if (human === "corrected") humanCorrectedCells++;
            }
        }

        const totalHumanReviewed = humanConfirmedCells + humanCorrectedCells;
        const humanPercent = totalVisibleCells > 0 ? Math.round((totalHumanReviewed / totalVisibleCells) * 100) : 0;
        const autoIssuesCount = autoWarnCells + autoErrorCells;

        return {
            totalVisibleCells,
            autoOkCells,
            autoIssuesCount,
            totalHumanReviewed,
            humanConfirmedCells,
            humanCorrectedCells,
            humanPercent,
            totalItems: flatRows.length,
            totalDocs: rows.length,
            doneDocs: rows.filter(r => r.status === "done").length,
            failedDocs,
        };
    }, [rows, flatRows, columns, docMap]);

    // Build items for Audit Queue (all cells with warnings/errors or unreviewed)
    const queueItems = useMemo(() => {
        const items: {
            fileId: string;
            fileName: string;
            colKey: string;
            path: string;
            node: any;
            reasons: string[];
            auto: AutoCheck;
            human: HumanReview;
            cellVal: string;
            rowIndex: number;
        }[] = [];

        for (const fr of flatRows) {
            const parentDoc = docMap.get(fr.fileId);
            for (const col of columns) {
                const cell = fr.cells[col];
                if (!cell) continue;
                const rev = parentDoc?.reviews?.[cell.path];
                const auto = rev?.auto ?? "ok";
                const human = rev?.human ?? "unreviewed";

                // Priority to warnings/errors first, then unreviewed
                if (auto !== "ok" || human === "unreviewed") {
                    items.push({
                        fileId: fr.fileId,
                        fileName: fr.fileName,
                        colKey: col,
                        path: cell.path,
                        node: cell.node,
                        reasons: rev?.reasons || [],
                        auto,
                        human,
                        cellVal: getDisplayValue(cell.node),
                        rowIndex: fr.rowIndex,
                    });
                }
            }
        }

        // Sort so that errors & warnings are at the very front of the queue
        return items.sort((a, b) => {
            const priority = (x: typeof a) => (x.auto === "error" ? 0 : x.auto === "warn" ? 1 : 2);
            return priority(a) - priority(b);
        });
    }, [flatRows, columns, docMap]);

    // Current queue item
    const currentQueueItem = queueItems[queueIndex] || null;

    // Focus document viewer to current queue item
    const focusQueueItem = useCallback((item: typeof currentQueueItem) => {
        if (!item) return;
        const parentDoc = docMap.get(item.fileId);
        if (parentDoc) {
            onSelectRow(parentDoc);
            if (isLocatedValue(item.node)) {
                onSelectCellHighlight(parentDoc, item.colKey, {
                    box_2d: item.node.box_2d,
                    page: item.node.page || 1,
                    label: `${item.fileName} → ${formatHeader(item.colKey)}`,
                    rawValue: item.cellVal,
                    fileId: item.fileId,
                    fileName: item.fileName,
                    columnKey: item.colKey,
                });
            }
        }
    }, [docMap, onSelectRow, onSelectCellHighlight]);

    // When queueIndex changes or review mode opens, focus document viewer
    useEffect(() => {
        if (isReviewMode && currentQueueItem) {
            focusQueueItem(currentQueueItem);
        }
    }, [isReviewMode, queueIndex, currentQueueItem, focusQueueItem]);

    // Global keyboard listener for Review Mode
    useEffect(() => {
        if (!isReviewMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in a text field other than queue editor
            if (e.target instanceof HTMLInputElement && e.target !== queueInputRef.current) return;
            if (e.target instanceof HTMLTextAreaElement) return;

            if (isEditingInQueue) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    if (currentQueueItem && onUpdateCell) {
                        onUpdateCell(currentQueueItem.fileId, currentQueueItem.path, queueEditValue);
                    }
                    setIsEditingInQueue(false);
                    // Advance to next
                    if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditingInQueue(false);
                }
                return;
            }

            if (e.key === "Escape") {
                e.preventDefault();
                setIsReviewMode(false);
            } else if (e.key === "Enter") {
                e.preventDefault();
                // Confirm current cell
                if (currentQueueItem) {
                    if (onConfirmCell) {
                        onConfirmCell(currentQueueItem.fileId, currentQueueItem.path);
                    } else if (onToggleVerifyCell) {
                        onToggleVerifyCell(currentQueueItem.fileId, currentQueueItem.path);
                    }
                }
                // Advance
                if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "e" || e.key === "E" || e.key === "у" || e.key === "У") {
                e.preventDefault();
                if (currentQueueItem) {
                    setIsEditingInQueue(true);
                    setQueueEditValue(currentQueueItem.cellVal === "—" ? "" : currentQueueItem.cellVal);
                }
            } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
                e.preventDefault();
                if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
                e.preventDefault();
                if (queueIndex > 0) setQueueIndex(i => i - 1);
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault();
                // Confirm entire row
                if (currentQueueItem && onConfirmRow) {
                    onConfirmRow(currentQueueItem.fileId, currentQueueItem.rowIndex);
                }
                // Skip to next different row
                const nextIdx = queueItems.findIndex((it, idx) => idx > queueIndex && (it.fileId !== currentQueueItem.fileId || it.rowIndex !== currentQueueItem.rowIndex));
                if (nextIdx !== -1) setQueueIndex(nextIdx);
                else if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "a" || e.key === "A" || e.key === "ф" || e.key === "Ф") {
                e.preventDefault();
                // Confirm entire doc
                if (currentQueueItem && onConfirmDoc) {
                    onConfirmDoc(currentQueueItem.fileId);
                }
                // Skip to next file
                const nextIdx = queueItems.findIndex((it, idx) => idx > queueIndex && it.fileId !== currentQueueItem.fileId);
                if (nextIdx !== -1) setQueueIndex(nextIdx);
                else if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isReviewMode, isEditingInQueue, currentQueueItem, queueIndex, queueItems, queueEditValue, onUpdateCell, onConfirmCell, onConfirmRow, onConfirmDoc, onToggleVerifyCell]);

    // Filter flat rows
    const filteredFlatRows = useMemo(() => {
        return flatRows.filter(fr => {
            const parentDoc = docMap.get(fr.fileId);

            if (filter === "warnings") {
                if (fr.status === "failed" || fr.status === "timeout") return true;
                // Return true if any cell in row has auto !== "ok"
                let hasIssue = false;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const rev = parentDoc?.reviews?.[cell.path];
                    if (rev && rev.auto !== "ok") { hasIssue = true; break; }
                }
                if (!hasIssue) return false;
            } else if (filter === "unreviewed") {
                // Return true if any cell in row is unreviewed
                let hasUnreviewed = false;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const rev = parentDoc?.reviews?.[cell.path];
                    if (!rev || rev.human === "unreviewed") { hasUnreviewed = true; break; }
                }
                if (!hasUnreviewed) return false;
            } else if (filter === "confirmed") {
                // Return true if all cells in row are confirmed or corrected
                let allConfirmed = true;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const rev = parentDoc?.reviews?.[cell.path];
                    if (!rev || rev.human === "unreviewed") { allConfirmed = false; break; }
                }
                if (!allConfirmed) return false;
            }

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchesName = fr.fileName.toLowerCase().includes(q);
                const matchesCells = Object.values(fr.cells).some(c => getDisplayValue(c.node).toLowerCase().includes(q));
                if (!matchesName && !matchesCells) return false;
            }

            return true;
        });
    }, [flatRows, filter, searchQuery, docMap, columns]);

    const handleSaveEdit = (rowId: string, path: string) => {
        if (onUpdateCell) {
            onUpdateCell(rowId, path, editValue);
        }
        setEditingCell(null);
    };

    const handleExport = () => {
        if (exportFormat === "csv") {
            exportBatchToCSV(flatRows);
        } else if (exportFormat === "excel") {
            exportBatchToExcel(flatRows);
        } else {
            exportBatchToJSON(flatRows);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-card border rounded-xl overflow-hidden shadow-sm">
            {/* Review Mode Sticky Audit Bar */}
            <AnimatePresence>
                {isReviewMode && currentQueueItem && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-primary/10 border-b border-primary/20 px-4 py-3 shrink-0 relative z-30"
                    >
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <span className="bg-primary text-primary-foreground font-bold text-xs px-2 py-0.5 rounded-full">
                                    Очередь аудита {queueIndex + 1} из {queueItems.length}
                                </span>
                                <span className="font-semibold text-xs text-foreground">
                                    {currentQueueItem.fileName} → {formatHeader(currentQueueItem.colKey)}:
                                </span>

                                {isEditingInQueue ? (
                                    <input
                                        ref={queueInputRef}
                                        type="text"
                                        value={queueEditValue}
                                        onChange={e => setQueueEditValue(e.target.value)}
                                        className="h-7 text-xs px-2 rounded border border-primary bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary w-48"
                                    />
                                ) : (
                                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-background border">
                                        {currentQueueItem.cellVal}
                                    </span>
                                )}

                                {currentQueueItem.reasons.map((r, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/30">
                                        <AlertCircle className="w-3 h-3 text-amber-500" />
                                        {r}
                                    </Badge>
                                ))}
                            </div>

                            {/* Review Action Buttons */}
                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    disabled={queueIndex <= 0}
                                    onClick={() => setQueueIndex(i => Math.max(0, i - 1))}
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    disabled={queueIndex >= queueItems.length - 1}
                                    onClick={() => setQueueIndex(i => Math.min(queueItems.length - 1, i + 1))}
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </Button>

                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        setIsEditingInQueue(true);
                                        setQueueEditValue(currentQueueItem.cellVal === "—" ? "" : currentQueueItem.cellVal);
                                    }}
                                    className="h-7 text-xs gap-1 font-medium"
                                >
                                    <Pencil className="w-3 h-3" /> [E] Изменить
                                </Button>

                                <Button
                                    size="sm"
                                    onClick={() => {
                                        if (onConfirmCell) onConfirmCell(currentQueueItem.fileId, currentQueueItem.path);
                                        else if (onToggleVerifyCell) onToggleVerifyCell(currentQueueItem.fileId, currentQueueItem.path);
                                        if (queueIndex < queueItems.length - 1) setQueueIndex(i => i + 1);
                                    }}
                                    className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                >
                                    <Check className="w-3.5 h-3.5" /> [Enter] Подтвердить
                                </Button>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-md ml-1"
                                    onClick={() => setIsReviewMode(false)}
                                    title="Закрыть режим ревью (Esc)"
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Keyboard shortcut hint bar */}
                        <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-2 pt-1.5 border-t border-primary/10">
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">Enter</kbd> подтвердить
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">E</kbd> редактировать
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">Space</kbd> вся строка
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">A</kbd> весь чек
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">↑/↓</kbd> навигация
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                                <kbd className="px-1 py-0.2 rounded bg-muted border font-bold text-[10px]">Esc</kbd> выход
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header & Dual Metrics Bar */}
            <div className="p-4 border-b bg-muted/20 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base tracking-tight text-foreground">
                                Пакетная ведомость чеков
                            </h3>
                            <Badge variant="secondary" className="font-mono text-xs">
                                {flatRows.length} позиций ({rows.length} чеков)
                            </Badge>
                            {isProcessing && (
                                <Badge variant="outline" className="gap-1 text-primary animate-pulse text-xs">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Обработка
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Честная двухосевая проверка: машина ловит расхождения, человек утверждает итоги.
                        </p>
                    </div>

                    {/* Actions, Review Mode Toggle & Export */}
                    <div className="flex items-center gap-2">
                        {stats.failedDocs > 0 && onRetryFailed && (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={onRetryFailed}
                                className="h-8 gap-1.5 text-xs font-semibold shadow-xs animate-in fade-in"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Повторить неудачные ({stats.failedDocs})
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant={isReviewMode ? "default" : "outline"}
                            onClick={() => {
                                setIsReviewMode(!isReviewMode);
                                setQueueIndex(0);
                            }}
                            className={`h-8 gap-1.5 text-xs font-semibold shadow-xs ${
                                isReviewMode ? "bg-primary text-primary-foreground" : "border-primary/40 text-primary hover:bg-primary/10"
                            }`}
                        >
                            <Keyboard className="w-3.5 h-3.5" />
                            {isReviewMode ? "Закрыть ревью" : `Режим ревью (${queueItems.length})`}
                        </Button>

                        <div className="flex bg-muted/70 p-0.5 rounded-lg text-xs border">
                            <button
                                onClick={() => setExportFormat("excel")}
                                className={`px-2 py-1 rounded-md font-medium transition-all ${exportFormat === "excel" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
                            >
                                📗 Excel
                            </button>
                            <button
                                onClick={() => setExportFormat("csv")}
                                className={`px-2 py-1 rounded-md font-medium transition-all ${exportFormat === "csv" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
                            >
                                📊 CSV
                            </button>
                            <button
                                onClick={() => setExportFormat("json")}
                                className={`px-2 py-1 rounded-md font-medium transition-all ${exportFormat === "json" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
                            >
                                📄 JSON
                            </button>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleExport}
                            className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Экспорт ({flatRows.length})
                        </Button>
                    </div>
                </div>

                {/* Dual-Axis Metrics Bar: Machine Checks vs Human Reviews */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {/* Machine AutoCheck Metric */}
                    <div className="p-2.5 rounded-lg border bg-background/50 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Автопроверка (машина)
                            </span>
                            <span className="font-mono text-xs">
                                <span className="text-emerald-600 font-bold">{stats.autoOkCells} ок</span>
                                {stats.autoIssuesCount > 0 ? (
                                    <span className="text-amber-600 font-bold ml-1.5">/ {stats.autoIssuesCount} замечаний</span>
                                ) : (
                                    <span className="text-muted-foreground ml-1">/ 0 замечаний</span>
                                )}
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                            <div
                                className="bg-emerald-500 h-full transition-all duration-300"
                                style={{ width: `${stats.totalVisibleCells > 0 ? (stats.autoOkCells / stats.totalVisibleCells) * 100 : 0}%` }}
                            />
                            <div
                                className="bg-amber-500 h-full transition-all duration-300"
                                style={{ width: `${stats.totalVisibleCells > 0 ? (stats.autoIssuesCount / stats.totalVisibleCells) * 100 : 0}%` }}
                            />
                        </div>
                    </div>

                    {/* Human Review Metric */}
                    <div className="p-2.5 rounded-lg border bg-background/50 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Ручная проверка (человек)
                            </span>
                            <span className="font-mono text-xs font-bold text-foreground">
                                {stats.totalHumanReviewed} / {stats.totalVisibleCells} подтверждено ({stats.humanPercent}%)
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-primary"
                                initial={{ width: 0 }}
                                animate={{ width: `${stats.humanPercent}%` }}
                                transition={{ duration: 0.3 }}
                            />
                        </div>
                    </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant={filter === "all" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2.5"
                            onClick={() => setFilter("all")}
                        >
                            Все ({flatRows.length})
                        </Button>
                        <Button
                            variant={filter === "warnings" ? "default" : "ghost"}
                            size="sm"
                            className={`h-7 text-xs px-2.5 gap-1.5 ${
                                filter === "warnings"
                                    ? ""
                                    : stats.autoIssuesCount > 0
                                    ? "text-amber-600 hover:text-amber-700 bg-amber-500/10"
                                    : ""
                            }`}
                            onClick={() => setFilter("warnings")}
                        >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                            Замечания ({stats.autoIssuesCount})
                        </Button>
                        <Button
                            variant={filter === "unreviewed" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2.5 gap-1.5 text-muted-foreground"
                            onClick={() => setFilter("unreviewed")}
                        >
                            <Clock className="w-3.5 h-3.5" />
                            Не проверено ({stats.totalVisibleCells - stats.totalHumanReviewed})
                        </Button>
                        <Button
                            variant={filter === "confirmed" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2.5 gap-1.5 text-emerald-600"
                            onClick={() => setFilter("confirmed")}
                        >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            Проверено человеком ({stats.totalHumanReviewed})
                        </Button>
                    </div>

                    <div className="relative w-48">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Поиск по позициям..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-7 pl-8 pr-2.5 text-xs bg-muted/40 border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                </div>
            </div>

            {/* Scrollable Master Table */}
            <div className="flex-1 overflow-auto min-h-0">
                <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-muted/80 sticky top-0 z-10 border-b backdrop-blur-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <tr>
                            <th className="py-2.5 px-3 w-12 text-center">#</th>
                            <th className="py-2.5 px-3 w-28">Статус</th>
                            <th className="py-2.5 px-3 min-w-[150px]">Файл</th>
                            {columns.map(col => (
                                <th key={col} className="py-2.5 px-3 min-w-[120px]">
                                    {formatHeader(col)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 font-mono">
                        {filteredFlatRows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 3} className="py-12 text-center text-muted-foreground font-sans">
                                    {filter === "warnings" ? (
                                        <div className="flex flex-col items-center gap-1">
                                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                                            <p className="font-semibold text-foreground">Замечаний автопроверки не обнаружено!</p>
                                            <p className="text-xs text-muted-foreground">Все координаты, форматы чисел и даты корректны.</p>
                                        </div>
                                    ) : (
                                        "Нет позиций, соответствующих фильтру."
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filteredFlatRows.map((fr, idx) => {
                                const parentDoc = docMap.get(fr.fileId);
                                const isSelected = fr.fileId === selectedRowId || fr.fileName === selectedRowId;

                                return (
                                    <tr
                                        key={`${fr.fileId}-${fr.rowIndex}`}
                                        onClick={() => {
                                            if (parentDoc) onSelectRow(parentDoc);
                                        }}
                                        className={`transition-colors cursor-pointer group hover:bg-muted/50 ${
                                            isSelected ? "bg-primary/10 ring-1 ring-primary/40 font-medium" : ""
                                        }`}
                                    >
                                        {/* # */}
                                        <td className="py-2 px-3 text-center text-muted-foreground text-[11px]">
                                            {idx + 1}
                                        </td>

                                        {/* Status */}
                                        <td className="py-2 px-3 font-sans">
                                            {fr.status === "done" && (
                                                <Badge variant="outline" className="text-[10px] py-0 gap-1 text-emerald-600 bg-emerald-500/10 border-emerald-500/20">
                                                    <Check className="w-3 h-3" /> Готов
                                                </Badge>
                                            )}
                                            {fr.status === "extracting" && (
                                                <Badge variant="outline" className="text-[10px] py-0 gap-1 text-primary bg-primary/10 border-primary/20 animate-pulse">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> Сканирование
                                                </Badge>
                                            )}
                                            {fr.status === "queued" && (
                                                <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground bg-muted">
                                                    В очереди
                                                </Badge>
                                            )}
                                            {fr.status === "timeout" && (
                                                <Badge variant="destructive" className="text-[10px] py-0 gap-1 bg-amber-500/15 text-amber-700 border-amber-500/30" title={fr.error || "Превышен таймаут (90с)"}>
                                                    <Clock className="w-3 h-3 text-amber-600" /> Таймаут
                                                </Badge>
                                            )}
                                            {fr.status === "failed" && (
                                                <Badge variant="destructive" className="text-[10px] py-0 gap-1" title={fr.error}>
                                                    <AlertCircle className="w-3 h-3" /> Ошибка
                                                </Badge>
                                            )}
                                        </td>

                                        {/* File Name + Item Indicator */}
                                        <td className="py-2 px-3 font-sans">
                                            <div className="flex items-center gap-1.5 max-w-[190px] truncate" title={fr.fileName}>
                                                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                <span className="truncate text-xs text-foreground font-medium">
                                                    {fr.fileName}
                                                </span>
                                                {fr.totalItemsInDoc > 1 && (
                                                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1 rounded shrink-0">
                                                        #{fr.rowIndex + 1}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Columns */}
                                        {columns.map(col => {
                                            const cell = fr.cells[col];
                                            const node = cell?.node;
                                            const cellVal = getDisplayValue(node);
                                            const hasBox = isLocatedValue(node);
                                            const path = cell?.path || col;

                                            const rev: CellReview | undefined = parentDoc?.reviews?.[path];
                                            const auto = rev?.auto ?? "ok";
                                            const human = rev?.human ?? "unreviewed";
                                            const reasons = rev?.reasons || [];

                                            const isEditing = editingCell?.rowId === fr.fileId && editingCell?.path === path;
                                            const isEmpty = cellVal === "—" || cellVal.trim() === "";

                                            return (
                                                <td
                                                    key={col}
                                                    className="py-1.5 px-3 relative group/cell"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (parentDoc) onSelectRow(parentDoc);
                                                        if (hasBox) {
                                                            onSelectCellHighlight(parentDoc || { fileId: fr.fileId, fileName: fr.fileName, file: fr.file!, data: {}, status: fr.status, reviews: {} }, col, {
                                                                box_2d: node.box_2d,
                                                                page: node.page || 1,
                                                                label: `${fr.fileName} → ${formatHeader(col)}`,
                                                                rawValue: cellVal,
                                                                fileId: fr.fileId,
                                                                fileName: fr.fileName,
                                                                columnKey: col,
                                                            });
                                                        }
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                            <input
                                                                ref={editInputRef}
                                                                type="text"
                                                                value={editValue}
                                                                onChange={e => setEditValue(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if (e.key === "Enter") handleSaveEdit(fr.fileId, path);
                                                                    if (e.key === "Escape") setEditingCell(null);
                                                                }}
                                                                onBlur={() => handleSaveEdit(fr.fileId, path)}
                                                                className="h-6 w-full text-xs px-1.5 rounded border border-primary bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-between gap-1 group/val">
                                                            <div className="flex items-center gap-1.5 truncate">
                                                                {hasBox && (
                                                                    <MapPin className="w-3 h-3 text-amber-500/70 shrink-0" />
                                                                )}
                                                                <span className={`truncate text-xs ${isEmpty ? "text-amber-500 italic" : "text-foreground"}`}>
                                                                    {cellVal}
                                                                </span>
                                                            </div>

                                                            {/* Two-Axis Status Badges */}
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                {/* Machine AutoCheck Shield */}
                                                                {auto === "warn" && (
                                                                    <span title={reasons.join(", ")} className="text-amber-500">
                                                                        <ShieldAlert className="w-3.5 h-3.5" />
                                                                    </span>
                                                                )}
                                                                {auto === "error" && (
                                                                    <span title={reasons.join(", ")} className="text-destructive">
                                                                        <ShieldX className="w-3.5 h-3.5" />
                                                                    </span>
                                                                )}
                                                                {auto === "ok" && (
                                                                    <span title="Автопроверка: все правила соблюдены" className="text-emerald-500/40 group-hover/cell:text-emerald-500/80 transition-colors">
                                                                        <ShieldCheck className="w-3 h-3" />
                                                                    </span>
                                                                )}

                                                                {/* Human Review Status */}
                                                                {human === "confirmed" && (
                                                                    <span title="Подтверждено человеком" className="text-emerald-600 font-bold bg-emerald-500/15 p-0.5 rounded">
                                                                        <Check className="w-3 h-3" />
                                                                    </span>
                                                                )}
                                                                {human === "corrected" && (
                                                                    <span title="Исправлено человеком" className="text-primary bg-primary/15 p-0.5 rounded">
                                                                        <Pencil className="w-3 h-3" />
                                                                    </span>
                                                                )}

                                                                {/* Quick Action Buttons on hover */}
                                                                <div className="flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity ml-1">
                                                                    <button
                                                                        type="button"
                                                                        title="Редактировать значение (E)"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setEditingCell({ rowId: fr.fileId, path });
                                                                            setEditValue(cellVal === "—" ? "" : cellVal);
                                                                        }}
                                                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                    >
                                                                        <Pencil className="w-3 h-3" />
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        title={human === "confirmed" ? "Снять подтверждение" : "Подтвердить поле (Enter)"}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (onConfirmCell) onConfirmCell(fr.fileId, path);
                                                                            else if (onToggleVerifyCell) onToggleVerifyCell(fr.fileId, path);
                                                                        }}
                                                                        className={`p-1 rounded hover:bg-muted ${
                                                                            human === "confirmed"
                                                                                ? "text-emerald-600 hover:text-emerald-700 bg-emerald-500/10"
                                                                                : "text-muted-foreground hover:text-foreground"
                                                                        }`}
                                                                    >
                                                                        <Check className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
