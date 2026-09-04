"use client";

import { Fragment, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DocRow, CellReview, AutoCheck, HumanReview, FlatRow } from "@/lib/batchTypes";
import { ActiveHighlight } from "@/lib/types";
import { explodeDoc, getDisplayValue, isLocatedValue } from "@/lib/flatten";
import { parseDocDate } from "@/lib/parseDocDate";
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
    Check,
    CheckCheck,
    Pencil,
    FileText,
    RefreshCw,
    ShieldCheck,
    ShieldAlert,
    ShieldX,
    Clock,
    X,
    ChevronRight,
    ChevronLeft,
    Keyboard,
    ArrowLeft,
    CornerDownLeft,
    Undo2,
    Flag,
    ChevronDown,
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
    onBulkConfirmRows?: (targetFlatRows: FlatRow[]) => void;
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

function getColType(colKey: string): "date" | "money" | "qty" | "text" {
    const k = colKey.toLowerCase();
    if (/date/i.test(k)) return "date";
    if (/price|total|amount|sum|cost|tax|rate|fee/i.test(k)) return "money";
    if (/quantity|qty|count/i.test(k)) return "qty";
    return "text";
}

function getColWidth(colKey: string): number {
    const type = getColType(colKey);
    switch (type) {
        case "date": return 104;
        case "money": return 96;
        case "qty": return 56;
        default: return 140;
    }
}

interface UndoEntry {
    fileId: string;
    path: string;
    prevReview: CellReview;
    prevVal?: string;
    queueIndex: number;
}

type ReviewScope = "issues" | "quick" | "all";

export function BatchDataTable({
    rows,
    selectedRowId,
    onSelectRow,
    onSelectCellHighlight,
    onUpdateCell,
    onConfirmCell,
    onConfirmRow,
    onConfirmDoc,
    onBulkConfirmRows,
    onToggleVerifyCell,
    onRetryFailed,
    schema,
    isProcessing,
}: BatchDataTableProps) {
    const [filter, setFilter] = useState<"all" | "warnings" | "unreviewed" | "confirmed">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [isReviewMenuOpen, setIsReviewMenuOpen] = useState(false);
    const [editingCell, setEditingCell] = useState<{ rowId: string; path: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);

    // Audit Review Card Mode
    const [isReviewMode, setIsReviewMode] = useState(false);
    const [reviewScope, setReviewScope] = useState<ReviewScope>("issues");
    const [queueIndex, setQueueIndex] = useState(0);
    const [isEditingInQueue, setIsEditingInQueue] = useState(false);
    const [queueEditValue, setQueueEditValue] = useState("");
    const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
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

    // Group flat rows by document for sticky document headers
    const groupedByDoc = useMemo(() => {
        const groups: { doc: DocRow; items: FlatRow[] }[] = [];
        const map = new Map<string, { doc: DocRow; items: FlatRow[] }>();

        for (const fr of flatRows) {
            let entry = map.get(fr.fileId);
            if (!entry) {
                const parentDoc = docMap.get(fr.fileId) || {
                    fileId: fr.fileId,
                    fileName: fr.fileName,
                    file: fr.file!,
                    data: {},
                    status: fr.status,
                    reviews: {},
                };
                entry = { doc: parentDoc, items: [] };
                map.set(fr.fileId, entry);
                groups.push(entry);
            }
            entry.items.push(fr);
        }
        return groups;
    }, [flatRows, docMap]);

    // Derive columns: scalar document properties first, then line item properties
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

    // Keep the overview readable: detailed fields remain available in review
    // mode and exports, while the table shows only the three most useful ones.
    const displayColumns = useMemo(() => {
        const priority = (key: string) => {
            const normalized = key.toLowerCase();
            if (/product|name|description|item/.test(normalized)) return 0;
            if (/price|total|amount|sum|cost/.test(normalized)) return 1;
            if (/date/.test(normalized)) return 2;
            if (/location|store|vendor|merchant/.test(normalized)) return 3;
            return 4;
        };
        return [...columns].sort((a, b) => priority(a) - priority(b)).slice(0, 3);
    }, [columns]);

    // Calculate minimum table width based on visible overview columns
    const tableMinWidth = useMemo(() => {
        let w = 36 + 72; // # (36px) + Status (72px)
        for (const col of displayColumns) {
            w += getColWidth(col);
        }
        return Math.max(520, w);
    }, [displayColumns]);

    // Dual metrics: accurate counts across visible cells
    const stats = useMemo(() => {
        let totalVisibleCells = 0;
        let autoOkCells = 0;
        let autoWarnCells = 0;
        let autoErrorCells = 0;
        let humanConfirmedCells = 0;
        let humanCorrectedCells = 0;
        let bulkConfirmedCells = 0;
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
                else if (human === "bulk_confirmed") bulkConfirmedCells++;
            }
        }

        const totalHumanReviewed = humanConfirmedCells + humanCorrectedCells + bulkConfirmedCells;
        const humanPercent = totalVisibleCells > 0 ? Math.round((totalHumanReviewed / totalVisibleCells) * 100) : 0;
        const autoIssuesCount = autoWarnCells + autoErrorCells;

        return {
            totalVisibleCells,
            autoOkCells,
            autoIssuesCount,
            totalHumanReviewed,
            humanConfirmedCells,
            humanCorrectedCells,
            bulkConfirmedCells,
            humanPercent,
            totalItems: flatRows.length,
            totalDocs: rows.length,
            doneDocs: rows.filter(r => r.status === "done").length,
            failedDocs,
        };
    }, [rows, flatRows, columns, docMap]);

    // Build three explicit human-review pools. Confirmed cells are excluded and
    // repeated document-level fields are de-duplicated by fileId + data path.
    const reviewPools = useMemo(() => {
        const issueItems: {
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
            totalItemsInDoc: number;
            isSample: boolean;
        }[] = [];

        const allItems: typeof issueItems = [];
        const seen = new Set<string>();

        for (const fr of flatRows) {
            const parentDoc = docMap.get(fr.fileId);
            for (const col of columns) {
                const cell = fr.cells[col];
                if (!cell) continue;
                const rev = parentDoc?.reviews?.[cell.path];
                const auto = rev?.auto ?? "ok";
                const human = rev?.human ?? "unreviewed";
                const stableKey = `${fr.fileId}::${cell.path}`;
                if (human !== "unreviewed" || seen.has(stableKey)) continue;
                seen.add(stableKey);

                const itemData = {
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
                    totalItemsInDoc: fr.totalItemsInDoc,
                    isSample: false,
                };

                allItems.push(itemData);
                if (auto !== "ok") issueItems.push(itemData);
            }
        }

        // Round-robin across documents gives the quick queue broad coverage.
        const byDocument = new Map<string, typeof allItems>();
        for (const item of allItems) {
            const list = byDocument.get(item.fileId) || [];
            list.push(item);
            byDocument.set(item.fileId, list);
        }
        const quickItems: typeof allItems = [];
        const documentLists = Array.from(byDocument.values()).map(items => [...items]);
        while (quickItems.length < 10 && documentLists.some(items => items.length > 0)) {
            for (const items of documentLists) {
                const item = items.shift();
                if (item) quickItems.push({ ...item, isSample: true });
                if (quickItems.length >= 10) break;
            }
        }

        // Sort issues: errors first, then warnings, then sample checks
        issueItems.sort((a, b) => {
            const p = (x: typeof a) => (x.auto === "error" ? 0 : 1);
            return p(a) - p(b);
        });

        return { issues: issueItems, quick: quickItems, all: allItems };
    }, [flatRows, columns, docMap]);

    const queueItems = reviewPools[reviewScope];

    type QueueItem = (typeof reviewPools.all)[number];
    const queueItemKey = useCallback((item: QueueItem) => `${item.fileId}::${item.path}`, []);
    const [reviewQueue, setReviewQueue] = useState<QueueItem[]>([]);

    // Keep the active review queue append-only. Existing entries retain their
    // position while freshly processed fields are appended at the end.
    useEffect(() => {
        if (!isReviewMode) return;
        setReviewQueue(previous => {
            const latestByKey = new Map(queueItems.map(item => [queueItemKey(item), item]));
            const known = new Set(previous.map(queueItemKey));
            const refreshed = previous.map(item => latestByKey.get(queueItemKey(item)) || item);
            let sampleSlots = Math.max(0, 10 - refreshed.filter(item => item.isSample).length);
            const additions = queueItems.filter(item => {
                if (known.has(queueItemKey(item))) return false;
                if (!item.isSample) return true;
                if (sampleSlots <= 0) return false;
                sampleSlots--;
                return true;
            });
            if (additions.length === 0 && refreshed.every((item, index) => item === previous[index])) {
                return previous;
            }
            return [...refreshed, ...additions];
        });
    }, [isReviewMode, queueItems, queueItemKey]);

    // Current queue item is stable even while extraction adds more rows.
    const currentQueueItem = reviewQueue[queueIndex] || null;

    // Focus document viewer to current queue item with auto-zoom
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

    // Sync active highlight when entering review mode or navigating queue
    useEffect(() => {
        if (isReviewMode && currentQueueItem) {
            focusQueueItem(currentQueueItem);
        }
    }, [isReviewMode, queueIndex, currentQueueItem, focusQueueItem]);

    // Review Actions: Confirm current cell & advance
    const handleConfirmCurrent = useCallback(() => {
        if (!currentQueueItem) return;
        const parentDoc = docMap.get(currentQueueItem.fileId);
        const prevReview = parentDoc?.reviews?.[currentQueueItem.path] || {
            auto: currentQueueItem.auto,
            reasons: currentQueueItem.reasons,
            human: currentQueueItem.human,
        };

        // Push to undo stack
        setUndoStack(prev => [
            ...prev,
            {
                fileId: currentQueueItem.fileId,
                path: currentQueueItem.path,
                prevReview,
                queueIndex,
            },
        ]);

        if (onConfirmCell) {
            onConfirmCell(currentQueueItem.fileId, currentQueueItem.path);
        } else if (onToggleVerifyCell) {
            onToggleVerifyCell(currentQueueItem.fileId, currentQueueItem.path);
        }

        if (queueIndex < reviewQueue.length - 1) {
            setQueueIndex(i => i + 1);
        }
    }, [currentQueueItem, docMap, queueIndex, reviewQueue.length, onConfirmCell, onToggleVerifyCell]);

    // Review Actions: Undo last approval
    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) return;
        const lastAction = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));

        if (lastAction.prevVal !== undefined && onUpdateCell) {
            onUpdateCell(lastAction.fileId, lastAction.path, lastAction.prevVal);
        }

        if (onToggleVerifyCell && lastAction.prevReview.human === "unreviewed") {
            onToggleVerifyCell(lastAction.fileId, lastAction.path);
        }

        setQueueIndex(lastAction.queueIndex);
    }, [undoStack, onUpdateCell, onToggleVerifyCell]);

    // Review Actions: Skip / Flag
    const handleSkip = useCallback(() => {
        if (queueIndex < reviewQueue.length - 1) {
            setQueueIndex(i => i + 1);
        }
    }, [queueIndex, reviewQueue.length]);

    // Global keyboard shortcuts in Review Mode
    useEffect(() => {
        if (!isReviewMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement && e.target !== queueInputRef.current) return;
            if (e.target instanceof HTMLTextAreaElement) return;

            if (isEditingInQueue) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    if (currentQueueItem && onUpdateCell) {
                        const parentDoc = docMap.get(currentQueueItem.fileId);
                        const prevReview = parentDoc?.reviews?.[currentQueueItem.path] || {
                            auto: currentQueueItem.auto,
                            reasons: currentQueueItem.reasons,
                            human: currentQueueItem.human,
                        };
                        setUndoStack(prev => [
                            ...prev,
                            {
                                fileId: currentQueueItem.fileId,
                                path: currentQueueItem.path,
                                prevReview,
                                prevVal: currentQueueItem.cellVal,
                                queueIndex,
                            },
                        ]);
                        onUpdateCell(currentQueueItem.fileId, currentQueueItem.path, queueEditValue);
                    }
                    setIsEditingInQueue(false);
                    if (queueIndex < reviewQueue.length - 1) setQueueIndex(i => i + 1);
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
                handleConfirmCurrent();
            } else if (e.key === "e" || e.key === "E" || e.key === "у" || e.key === "У") {
                e.preventDefault();
                if (currentQueueItem) {
                    setIsEditingInQueue(true);
                    setQueueEditValue(currentQueueItem.cellVal === "—" ? "" : currentQueueItem.cellVal);
                }
            } else if ((e.key === "u" || e.key === "U" || e.key === "г" || e.key === "Г") || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                handleUndo();
            } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
                e.preventDefault();
                handleSkip();
            } else if (e.key === " " || e.code === "Space") {
                e.preventDefault();
                if (currentQueueItem && onConfirmRow) {
                    onConfirmRow(currentQueueItem.fileId, currentQueueItem.rowIndex);
                }
                const nextIdx = reviewQueue.findIndex((it, idx) => idx > queueIndex && (it.fileId !== currentQueueItem?.fileId || it.rowIndex !== currentQueueItem?.rowIndex));
                if (nextIdx !== -1) setQueueIndex(nextIdx);
                else if (queueIndex < reviewQueue.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "a" || e.key === "A") {
                e.preventDefault();
                if (currentQueueItem && onConfirmDoc) {
                    onConfirmDoc(currentQueueItem.fileId);
                }
                const nextIdx = reviewQueue.findIndex((it, idx) => idx > queueIndex && it.fileId !== currentQueueItem?.fileId);
                if (nextIdx !== -1) setQueueIndex(nextIdx);
                else if (queueIndex < reviewQueue.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
                e.preventDefault();
                if (queueIndex < reviewQueue.length - 1) setQueueIndex(i => i + 1);
            } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
                e.preventDefault();
                if (queueIndex > 0) setQueueIndex(i => i - 1);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        isReviewMode,
        isEditingInQueue,
        currentQueueItem,
        queueIndex,
        reviewQueue,
        queueEditValue,
        handleConfirmCurrent,
        handleUndo,
        handleSkip,
        onUpdateCell,
        onConfirmRow,
        onConfirmDoc,
        docMap,
    ]);

    // Filter flat rows for the table view
    const filteredFlatRows = useMemo(() => {
        return flatRows.filter(fr => {
            const parentDoc = docMap.get(fr.fileId);

            if (filter === "warnings") {
                if (fr.status === "failed" || fr.status === "timeout") return true;
                let hasIssue = false;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const rev = parentDoc?.reviews?.[cell.path];
                    if (rev && rev.auto !== "ok") { hasIssue = true; break; }
                }
                if (!hasIssue) return false;
            } else if (filter === "unreviewed") {
                let hasUnreviewed = false;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const rev = parentDoc?.reviews?.[cell.path];
                    if (!rev || rev.human === "unreviewed") { hasUnreviewed = true; break; }
                }
                if (!hasUnreviewed) return false;
            } else if (filter === "confirmed") {
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

    // Group filtered flat rows by doc for sticky headers
    const filteredGroupedDocs = useMemo(() => {
        const groups: { doc: DocRow; items: FlatRow[] }[] = [];
        const map = new Map<string, { doc: DocRow; items: FlatRow[] }>();

        for (const fr of filteredFlatRows) {
            let entry = map.get(fr.fileId);
            if (!entry) {
                const parentDoc = docMap.get(fr.fileId) || {
                    fileId: fr.fileId,
                    fileName: fr.fileName,
                    file: fr.file!,
                    data: {},
                    status: fr.status,
                    reviews: {},
                };
                entry = { doc: parentDoc, items: [] };
                map.set(fr.fileId, entry);
                groups.push(entry);
            }
            entry.items.push(fr);
        }
        return groups;
    }, [filteredFlatRows, docMap]);

    const handleSaveEdit = (rowId: string, path: string) => {
        if (onUpdateCell) {
            onUpdateCell(rowId, path, editValue);
        }
        setEditingCell(null);
    };

    return (
        <div className="w-full h-full flex flex-col bg-card border rounded-xl overflow-hidden shadow-sm">
            {/* Header & Metrics */}
            <div className="p-3.5 pr-12 border-b bg-muted/20 space-y-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base tracking-tight text-foreground truncate">
                                Проверка данных
                            </h3>
                            <Badge variant="secondary" className="font-mono text-xs shrink-0">
                                {flatRows.length} поз. ({rows.length} чеков)
                            </Badge>
                            {isProcessing && (
                                <Badge variant="outline" className="gap-1 text-primary animate-pulse text-xs shrink-0">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Обработка
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>

                {/* Primary actions have their own row so they never collide with panel controls. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {!isProcessing && stats.failedDocs > 0 && onRetryFailed && (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={onRetryFailed}
                                className="h-8 gap-1 text-xs font-semibold shadow-xs"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Ошибки ({stats.failedDocs})
                            </Button>
                        )}

                        <div className="relative flex flex-1 min-w-0">
                            <Button
                                size="sm"
                                variant={isReviewMode ? "default" : stats.autoIssuesCount > 0 ? "default" : "outline"}
                                onClick={() => {
                                    if (isReviewMode) {
                                        setIsReviewMode(false);
                                        return;
                                    }
                                    setReviewScope("issues");
                                    setReviewQueue(reviewPools.issues);
                                    setQueueIndex(0);
                                    setIsReviewMode(true);
                                }}
                                className={`h-9 min-w-0 flex-1 rounded-r-none gap-1.5 text-sm font-semibold shadow-xs ${
                                    isReviewMode
                                        ? "bg-primary text-primary-foreground"
                                        : stats.autoIssuesCount > 0
                                        ? "bg-amber-600 hover:bg-amber-700 text-white"
                                        : "border-primary/40 text-primary hover:bg-primary/10"
                                }`}
                            >
                                <Keyboard className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">
                                    {isReviewMode ? "Все данные" : `Проверить замечания (${reviewPools.issues.length})`}
                                </span>
                            </Button>
                            {!isReviewMode && (
                                <Button
                                    size="icon"
                                    variant={stats.autoIssuesCount > 0 ? "default" : "outline"}
                                    className={`h-9 w-9 rounded-l-none border-l shrink-0 ${stats.autoIssuesCount > 0 ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-500" : ""}`}
                                    onClick={() => setIsReviewMenuOpen(open => !open)}
                                    title="Выбрать режим проверки"
                                >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </Button>
                            )}

                            {isReviewMenuOpen && !isReviewMode && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsReviewMenuOpen(false)} />
                                    <div className="absolute left-0 top-10 z-50 w-72 rounded-xl border bg-popover p-1.5 shadow-xl">
                                        {([
                                            ["issues", "Проверить замечания", reviewPools.issues.length, "Только поля, отмеченные машиной"],
                                            ["quick", "Быстрая проверка", reviewPools.quick.length, "Выборка из разных документов"],
                                            ["all", "Проверить всё вручную", reviewPools.all.length, "Все ещё не подтверждённые поля"],
                                        ] as const).map(([scope, title, count, description]) => (
                                            <button
                                                key={scope}
                                                type="button"
                                                className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-muted transition-colors"
                                                onClick={() => {
                                                    setReviewScope(scope);
                                                    setReviewQueue(reviewPools[scope]);
                                                    setQueueIndex(0);
                                                    setIsReviewMode(true);
                                                    setIsReviewMenuOpen(false);
                                                }}
                                            >
                                                <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                                                    {title}<Badge variant="secondary">{count}</Badge>
                                                </span>
                                                <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Independent Export Split Dropdown */}
                    <div className="relative justify-self-end">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setIsExportMenuOpen(p => !p)}
                                className="h-9 gap-1 text-sm font-semibold shadow-xs"
                            >
                                <Download className="w-3.5 h-3.5 text-muted-foreground" />
                                Экспорт
                                <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                            </Button>

                            {isExportMenuOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setIsExportMenuOpen(false)}
                                    />
                                    <div className="absolute right-0 top-9 w-44 bg-popover border rounded-lg shadow-xl py-1 z-50 text-xs">
                                        <button
                                            className="w-full px-3 py-2 text-left hover:bg-muted/80 flex items-center gap-2 font-medium"
                                            onClick={() => {
                                                exportBatchToExcel(flatRows);
                                                setIsExportMenuOpen(false);
                                            }}
                                        >
                                            <span>📗</span> Excel (.xls с аудитом)
                                        </button>
                                        <button
                                            className="w-full px-3 py-2 text-left hover:bg-muted/80 flex items-center gap-2 font-medium"
                                            onClick={() => {
                                                exportBatchToCSV(flatRows);
                                                setIsExportMenuOpen(false);
                                            }}
                                        >
                                            <span>📊</span> CSV (BOM UTF-8)
                                        </button>
                                        <button
                                            className="w-full px-3 py-2 text-left hover:bg-muted/80 flex items-center gap-2 font-medium"
                                            onClick={() => {
                                                exportBatchToJSON(flatRows);
                                                setIsExportMenuOpen(false);
                                            }}
                                        >
                                            <span>📄</span> JSON (сырые данные)
                                        </button>
                                    </div>
                                </>
                            )}
                    </div>
                </div>

                {isProcessing ? (
                    <div className="rounded-lg border bg-background/60 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2 font-medium">
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                Готово {stats.doneDocs} из {stats.totalDocs} документов
                            </span>
                            <span className="text-xs text-muted-foreground">Готовые можно проверять</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${stats.totalDocs ? (stats.doneDocs / stats.totalDocs) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                ) : <>
                {/* Dual-Axis Metrics Bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                    {/* AutoCheck (Machine) */}
                    <div className="p-2 rounded-lg border bg-background/60 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground flex items-center gap-1.5 text-[11px]">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Машина (правила)
                            </span>
                            <span className="font-mono text-[11px]">
                                <span className="text-emerald-600 font-bold">{stats.autoOkCells} ок</span>
                                {stats.autoIssuesCount > 0 ? (
                                    <span className="text-amber-600 font-bold ml-1.5">/ {stats.autoIssuesCount} замечаний</span>
                                ) : (
                                    <span className="text-muted-foreground ml-1">/ 0 замечаний</span>
                                )}
                            </span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden flex">
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

                    {/* Human Review */}
                    <div className="p-2 rounded-lg border bg-background/60 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground flex items-center gap-1.5 text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Человек (верификация)
                            </span>
                            <span className="font-mono text-[11px] font-bold text-foreground">
                                {stats.totalHumanReviewed} / {stats.totalVisibleCells} ({stats.humanPercent}%)
                            </span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-primary"
                                initial={{ width: 0 }}
                                animate={{ width: `${stats.humanPercent}%` }}
                                transition={{ duration: 0.3 }}
                            />
                        </div>
                    </div>
                </div>
                </>}

                {/* Filter and Search Bar */}
                {!isReviewMode && !isProcessing && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50">
                        <div className="flex items-center gap-1 flex-wrap">
                            <Button
                                variant={filter === "all" ? "default" : "ghost"}
                                size="sm"
                                className="h-8 text-sm px-3"
                                onClick={() => setFilter("all")}
                            >
                                Все ({flatRows.length})
                            </Button>
                            <Button
                                variant={filter === "warnings" ? "default" : "ghost"}
                                size="sm"
                                className={`h-8 text-sm px-3 gap-1 ${
                                    filter === "warnings"
                                        ? ""
                                        : stats.autoIssuesCount > 0
                                        ? "text-amber-600 hover:text-amber-700 bg-amber-500/10"
                                        : ""
                                }`}
                                onClick={() => setFilter("warnings")}
                            >
                                <AlertCircle className="w-3 h-3 text-amber-500" />
                                Замечания ({stats.autoIssuesCount})
                            </Button>
                            <Button
                                variant={filter === "unreviewed" ? "default" : "ghost"}
                                size="sm"
                                className="h-8 text-sm px-3 gap-1 text-muted-foreground"
                                onClick={() => setFilter("unreviewed")}
                            >
                                <Clock className="w-3 h-3" />
                                Не проверено ({stats.totalVisibleCells - stats.totalHumanReviewed})
                            </Button>
                            <Button
                                variant={filter === "confirmed" ? "default" : "ghost"}
                                size="sm"
                                className="h-8 text-sm px-3 gap-1 text-emerald-600"
                                onClick={() => setFilter("confirmed")}
                            >
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                Проверено ({stats.totalHumanReviewed})
                            </Button>

                            {/* Scoped Bulk Confirm button */}
                            {filter !== "all" && filteredFlatRows.length > 0 && onBulkConfirmRows && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onBulkConfirmRows(filteredFlatRows)}
                                    className="h-6 text-xs px-2 gap-1 ml-1 text-primary border border-primary/20"
                                    title="Подтвердить все видимые не проверенные ячейки со статусом 'Массово подтверждено'"
                                >
                                    <CheckCheck className="w-3 h-3" />
                                    Подтвердить видимые ({filteredFlatRows.length})
                                </Button>
                            )}
                        </div>

                        <div className="relative w-52">
                            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Поиск по чекам..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full h-8 pl-8 pr-2 text-sm bg-muted/40 border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* BODY: Review Card Mode OR Master Table */}
            {isReviewMode ? (
                /* Focused Review Card Mode */
                <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-between min-h-0 bg-background/50">
                    {currentQueueItem ? (
                        <div className="w-full space-y-3">
                            {/* Card Top Navigation & Progress */}
                            <div className="flex items-center justify-between gap-2 pb-2 border-b">
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsReviewMode(false)}
                                        className="h-7 text-xs px-2 gap-1"
                                    >
                                        <ArrowLeft className="w-3.5 h-3.5" /> Все данные
                                    </Button>
                                    <Badge variant="outline" className="font-mono text-xs">
                                        Поле {queueIndex + 1} из {reviewQueue.length}
                                        {isProcessing && <span className="ml-1 text-primary">· новые добавляются</span>}
                                    </Badge>
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-7 w-7 rounded-md"
                                        disabled={queueIndex <= 0}
                                        onClick={() => setQueueIndex(i => Math.max(0, i - 1))}
                                        title="Предыдущее замечание (↑)"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-7 w-7 rounded-md"
                                        disabled={queueIndex >= reviewQueue.length - 1}
                                        onClick={() => setQueueIndex(i => Math.min(reviewQueue.length - 1, i + 1))}
                                        title="Следующее замечание (↓)"
                                    >
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Breadcrumb Context */}
                            <div className="p-3 bg-muted/40 rounded-xl border space-y-1">
                                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5" />
                                    <span className="truncate">{currentQueueItem.fileName}</span>
                                    {currentQueueItem.totalItemsInDoc > 1 && (
                                        <span>· Позиция {currentQueueItem.rowIndex + 1} из {currentQueueItem.totalItemsInDoc}</span>
                                    )}
                                </div>
                                <div className="text-base font-bold text-foreground">
                                    {formatHeader(currentQueueItem.colKey)}
                                    <span className={`ml-2 align-middle text-[10px] uppercase tracking-wide ${currentQueueItem.auto !== "ok" ? "text-amber-600" : "text-muted-foreground"}`}>
                                        {currentQueueItem.auto !== "ok"
                                            ? "требует внимания"
                                            : reviewScope === "quick"
                                            ? "контрольная выборка"
                                            : "ручная проверка"}
                                    </span>
                                </div>
                            </div>

                            {/* Issues & Warnings List */}
                            {currentQueueItem.reasons.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                        <ShieldAlert className="w-4 h-4" /> Замечания алгоритма:
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {currentQueueItem.reasons.map((r, i) => (
                                            <Badge key={i} variant="outline" className="text-xs py-1 gap-1.5 bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30">
                                                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                                {r}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Field Values Comparison */}
                            <div className="grid grid-cols-1 min-[540px]:grid-cols-2 gap-2 pt-1">
                                {/* Raw in document */}
                                <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                                    <div className="text-[11px] font-semibold text-muted-foreground uppercase">
                                        Извлечено из документа
                                    </div>
                                    <div className="font-mono text-sm font-bold text-foreground break-all">
                                        {currentQueueItem.cellVal}
                                    </div>
                                    {getColType(currentQueueItem.colKey) === "date" && (
                                        <div className="text-[10px] text-muted-foreground">
                                            {parseDocDate(currentQueueItem.cellVal).isAmbiguous && (
                                                <span className="text-amber-600 font-medium">
                                                    Возможно: {parseDocDate(currentQueueItem.cellVal).ambiguousAlternative}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Normalized & Editable */}
                                <div className="p-3 rounded-xl border bg-background space-y-1">
                                    <div className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center justify-between">
                                        <span>Итоговое значение</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsEditingInQueue(true);
                                                setQueueEditValue(currentQueueItem.cellVal === "—" ? "" : currentQueueItem.cellVal);
                                            }}
                                            className="text-primary hover:underline text-[10px] flex items-center gap-1"
                                        >
                                            <Pencil className="w-3 h-3" /> Изменить [E]
                                        </button>
                                    </div>

                                    {isEditingInQueue ? (
                                        <div className="flex items-center gap-1 pt-0.5">
                                            <input
                                                ref={queueInputRef}
                                                type="text"
                                                value={queueEditValue}
                                                onChange={e => setQueueEditValue(e.target.value)}
                                                className="w-full h-8 text-sm px-2 rounded border border-primary bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                                            />
                                            <Button
                                                size="sm"
                                                className="h-8 px-2.5 text-xs gap-1"
                                                onClick={() => {
                                                    if (onUpdateCell) {
                                                        onUpdateCell(currentQueueItem.fileId, currentQueueItem.path, queueEditValue);
                                                    }
                                                    setIsEditingInQueue(false);
                                                    if (queueIndex < reviewQueue.length - 1) setQueueIndex(i => i + 1);
                                                }}
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="font-mono text-sm font-bold text-primary break-all pt-1">
                                            {getColType(currentQueueItem.colKey) === "date"
                                                ? parseDocDate(currentQueueItem.cellVal).display
                                                : currentQueueItem.cellVal}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Main Action Buttons */}
                            <div className="flex items-center gap-2 pt-2">
                                <Button
                                    onClick={handleConfirmCurrent}
                                    className="flex-1 h-10 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md"
                                >
                                    <Check className="w-4 h-4" />
                                    Подтвердить и дальше
                                    <kbd className="ml-1 px-1.5 py-0.5 rounded bg-emerald-700/60 text-[10px] font-mono">Enter</kbd>
                                </Button>

                                <Button
                                    variant="outline"
                                    onClick={handleSkip}
                                    className="h-10 px-3 text-xs gap-1 text-muted-foreground"
                                    title="Пропустить (F)"
                                >
                                    <Flag className="w-3.5 h-3.5" />
                                    Пропустить
                                    <kbd className="ml-1 px-1 py-0.2 rounded bg-muted text-[10px] font-mono">F</kbd>
                                </Button>

                                {undoStack.length > 0 && (
                                    <Button
                                        variant="outline"
                                        onClick={handleUndo}
                                        className="h-10 px-3 text-xs gap-1 text-muted-foreground"
                                        title="Отменить последнее действие (U / Cmd+Z)"
                                    >
                                        <Undo2 className="w-3.5 h-3.5" />
                                        Отмена
                                        <kbd className="ml-1 px-1 py-0.2 rounded bg-muted text-[10px] font-mono">U</kbd>
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-64 text-center">
                            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-2" />
                            <h4 className="font-bold text-base text-foreground">
                                {isProcessing
                                    ? "Ожидаем новые результаты…"
                                    : reviewScope === "issues"
                                    ? "Все замечания проверены!"
                                    : reviewScope === "quick"
                                    ? "Быстрая проверка завершена!"
                                    : "Полная проверка завершена!"}
                            </h4>
                            <p className="text-xs text-muted-foreground max-w-sm mt-1">
                                {isProcessing
                                    ? "Можно продолжать проверку — готовые поля появятся здесь автоматически."
                                    : "Все поля выбранного режима пройдены."}
                            </p>
                            {!isProcessing && (
                                <Button
                                    size="sm"
                                    onClick={() => setIsReviewMode(false)}
                                    className="mt-4 gap-1.5"
                                >
                                    Вернуться к таблице
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Hotkeys footer bar */}
                    <div className="pt-3 mt-auto border-t text-[11px] text-muted-foreground flex flex-wrap items-center justify-center gap-3 font-mono">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">Enter</kbd> подтвердить
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">E</kbd> редактировать
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">U</kbd> отменить
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">Space</kbd> вся строка
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">A</kbd> весь чек
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1 rounded bg-muted border font-bold">Esc</kbd> выход
                        </span>
                    </div>
                </div>
            ) : isProcessing ? (
                <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5 bg-background/40">
                    {groupedByDoc.map(({ doc, items }) => {
                        const ready = doc.status === "done";
                        const failed = doc.status === "failed" || doc.status === "timeout";
                        return (
                            <button
                                key={doc.fileId}
                                type="button"
                                onClick={() => onSelectRow(doc)}
                                className="w-full min-h-12 rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                            >
                                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold">{doc.fileName}</span>
                                    <span className="block text-xs text-muted-foreground">
                                        {ready
                                            ? `${Math.max(items[0]?.totalItemsInDoc || 0, items.length)} позиций найдено`
                                            : doc.status === "extracting"
                                            ? "Распознаём документ…"
                                            : "В очереди на обработку…"}
                                    </span>
                                </span>
                                <span className={`shrink-0 text-xs font-medium ${ready ? "text-emerald-600" : "text-muted-foreground"}`}>
                                    {ready ? "Готово" : <Loader2 className="w-4 h-4 animate-spin" />}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                /* Master Table Mode with Sticky Document Group Headers */
                <div className="flex-1 overflow-auto min-h-0 relative">
                    <table className="w-full text-xs text-left border-collapse" style={{ minWidth: `${tableMinWidth}px` }}>
                        <colgroup>
                            <col style={{ width: "36px" }} />
                            <col style={{ width: "72px" }} />
                            {displayColumns.map(c => (
                                <col key={c} style={{ width: `${getColWidth(c)}px`, minWidth: `${getColWidth(c)}px` }} />
                            ))}
                        </colgroup>

                        <thead className="bg-muted/90 sticky top-0 z-20 border-b backdrop-blur-xs font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                            <tr>
                                <th className="py-2 px-2 text-center w-9">#</th>
                                <th className="py-2 px-2 w-[72px] text-center">Статус</th>
                                {displayColumns.map(col => {
                                    const type = getColType(col);
                                    const alignClass = type === "money" || type === "qty" || type === "date" ? "text-right" : "text-left";
                                    return (
                                        <th key={col} className={`py-2 px-2.5 truncate ${alignClass}`}>
                                            {formatHeader(col)}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-border/60">
                            {filteredGroupedDocs.length === 0 ? (
                                <tr>
                                    <td colSpan={displayColumns.length + 2} className="py-12 text-center text-muted-foreground font-sans">
                                        {filter === "warnings" ? (
                                            <div className="flex flex-col items-center gap-1">
                                                <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                                                <p className="font-semibold text-foreground">Замечаний автопроверки не обнаружено!</p>
                                                <p className="text-xs text-muted-foreground">Все координаты, форматы чисел и даты соответствуют правилам.</p>
                                            </div>
                                        ) : (
                                            "Нет позиций, соответствующих фильтру."
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredGroupedDocs.map((group) => {
                                    const doc = group.doc;
                                    const isDocSelected = doc.fileId === selectedRowId || doc.fileName === selectedRowId;

                                    return (
                                        <Fragment key={`doc-${doc.fileId}`}>
                                            {/* Sticky Group Header Row for Document */}
                                            <tr className="sticky top-[29px] z-10 bg-muted/95 backdrop-blur-xs border-y border-border/70 group/grouphead shadow-2xs">
                                                <td colSpan={displayColumns.length + 2} className="py-1.5 px-3 font-sans">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div
                                                            className="flex items-center gap-2 cursor-pointer min-w-0"
                                                            onClick={() => onSelectRow(doc)}
                                                        >
                                                            <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                                                            <span className="font-bold text-xs text-foreground truncate" title={doc.fileName}>
                                                                {doc.fileName}
                                                            </span>
                                                            <Badge variant="secondary" className="font-mono text-[10px] py-0 px-1.5 shrink-0">
                                                                {group.items.length > 1 ? `${group.items.length} поз.` : "1 чек"}
                                                            </Badge>

                                                            {doc.status === "extracting" && (
                                                                <Badge variant="outline" className="text-[10px] py-0 text-primary animate-pulse shrink-0">
                                                                    <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" /> Сканирование
                                                                </Badge>
                                                            )}
                                                            {(doc.status === "queued" || ((doc.status === "failed" || doc.status === "timeout") && isProcessing)) && (
                                                                <Badge variant="secondary" className="text-[10px] py-0 text-muted-foreground shrink-0">
                                                                    <Clock className="w-2.5 h-2.5 mr-1" /> В очереди
                                                                </Badge>
                                                            )}
                                                            {!isProcessing && (doc.status === "failed" || doc.status === "timeout") && (
                                                                <Badge variant="destructive" className="text-[10px] py-0 shrink-0" title={doc.error}>
                                                                    {doc.status === "timeout" ? "Таймаут" : "Ошибка"}
                                                                </Badge>
                                                            )}
                                                        </div>

                                                        {/* Quick Doc-Level Action */}
                                                        <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover/grouphead:opacity-100 transition-opacity">
                                                            {onConfirmDoc && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onConfirmDoc(doc.fileId);
                                                                    }}
                                                                    className="text-[10px] font-semibold text-muted-foreground hover:text-emerald-600 px-1.5 py-0.5 rounded hover:bg-background/80 transition-colors flex items-center gap-1"
                                                                    title="Подтвердить все поля этого чека [A]"
                                                                >
                                                                    <Check className="w-3 h-3" />
                                                                    Подтвердить чек
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Item Rows */}
                                            {group.items.map((fr) => {
                                                const isSelected = isDocSelected;

                                                return (
                                                    <tr
                                                        key={`${fr.fileId}-${fr.rowIndex}`}
                                                        onClick={() => onSelectRow(doc)}
                                                        className={`transition-colors cursor-pointer group hover:bg-muted/40 ${
                                                            isSelected ? "bg-primary/5 ring-1 ring-primary/30" : ""
                                                        }`}
                                                    >
                                                        {/* Row Index */}
                                                        <td className="py-2.5 px-2 text-center text-muted-foreground text-xs tabular-nums">
                                                            {fr.totalItemsInDoc > 1 ? `${fr.rowIndex + 1}` : "•"}
                                                        </td>

                                                        {/* Combined 2-Axis Status (72px) */}
                                                        <td className="py-2.5 px-2 text-center">
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                {/* Machine auto icon */}
                                                                {(() => {
                                                                    let hasError = false;
                                                                    let hasWarn = false;
                                                                    for (const col of columns) {
                                                                        const cell = fr.cells[col];
                                                                        if (!cell) continue;
                                                                        const rev = doc.reviews?.[cell.path];
                                                                        if (rev?.auto === "error") hasError = true;
                                                                        else if (rev?.auto === "warn") hasWarn = true;
                                                                    }

                                                                    if (hasError) {
                                                                        return <span title="Автопроверка: найдены ошибки"><ShieldX className="w-3.5 h-3.5 text-destructive" /></span>;
                                                                    }
                                                                    if (hasWarn) {
                                                                        return <span title="Автопроверка: есть замечания"><ShieldAlert className="w-3.5 h-3.5 text-amber-500" /></span>;
                                                                    }
                                                                    return <span title="Автопроверка: OK"><ShieldCheck className="w-3 h-3 text-emerald-500/50" /></span>;
                                                                })()}

                                                                {/* Human review icon */}
                                                                {(() => {
                                                                    let allConfirmed = true;
                                                                    let hasBulk = false;
                                                                    let hasCorrected = false;
                                                                    for (const col of columns) {
                                                                        const cell = fr.cells[col];
                                                                        if (!cell) continue;
                                                                        const rev = doc.reviews?.[cell.path];
                                                                        if (!rev || rev.human === "unreviewed") {
                                                                            allConfirmed = false;
                                                                        } else if (rev.human === "corrected") {
                                                                            hasCorrected = true;
                                                                        } else if (rev.human === "bulk_confirmed") {
                                                                            hasBulk = true;
                                                                        }
                                                                    }

                                                                    if (hasCorrected) {
                                                                        return <span title="Исправлено человеком"><Pencil className="w-3 h-3 text-primary" /></span>;
                                                                    }
                                                                    if (allConfirmed) {
                                                                        return hasBulk
                                                                            ? <span title="Массово подтверждено"><CheckCheck className="w-3.5 h-3.5 text-primary/70" /></span>
                                                                            : <span title="Подтверждено человеком"><Check className="w-3.5 h-3.5 text-emerald-600 font-bold" /></span>;
                                                                    }
                                                                    return <span className="w-2 h-2 rounded-full border border-muted-foreground/40" title="Не проверено" />;
                                                                })()}
                                                            </div>
                                                        </td>

                                                        {/* Columns */}
                                                        {displayColumns.map((col) => {
                                                            const cell = fr.cells[col];
                                                            const node = cell?.node;
                                                            const cellVal = getDisplayValue(node);
                                                            const hasBox = isLocatedValue(node);
                                                            const path = cell?.path || col;
                                                            const colType = getColType(col);

                                                            const rev: CellReview | undefined = doc.reviews?.[path];
                                                            const auto = rev?.auto ?? "ok";
                                                            const human = rev?.human ?? "unreviewed";
                                                            const reasons = rev?.reasons || [];

                                                            const isEditing = editingCell?.rowId === fr.fileId && editingCell?.path === path;
                                                            const isEmpty = cellVal === "—" || cellVal.trim() === "";

                                                            const parsedDate = colType === "date" ? parseDocDate(cellVal) : null;
                                                            const alignClass = colType === "money" || colType === "qty" || colType === "date" ? "text-right" : "text-left";

                                                            return (
                                                                <td
                                                                    key={col}
                                                                    className={`py-2.5 px-3 relative group/cell ${alignClass}`}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onSelectRow(doc);
                                                                        if (hasBox) {
                                                                            onSelectCellHighlight(doc, col, {
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
                                                                                className="h-6 w-full text-xs px-1 rounded border border-primary bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <div className={`flex items-center gap-1 group/val ${alignClass === "text-right" ? "justify-end" : "justify-between"}`}>
                                                                            {/* Micro-dot Coordinate Indicator */}
                                                                            {hasBox && (
                                                                                <span
                                                                                    className="w-1.5 h-1.5 rounded-full bg-amber-400/80 shrink-0"
                                                                                    title="Координаты найдены на чеке"
                                                                                />
                                                                            )}

                                                                            {/* Formatted Value */}
                                                                            <span className={`truncate text-sm leading-5 ${colType === "money" || colType === "qty" ? "tabular-nums" : ""} ${isEmpty ? "text-amber-500 italic" : "text-foreground"}`}>
                                                                                {colType === "date" && parsedDate ? (
                                                                                    parsedDate.isAmbiguous ? (
                                                                                        <span className="text-amber-600 font-semibold" title={parsedDate.reason}>
                                                                                            {parsedDate.display} ~
                                                                                        </span>
                                                                                    ) : parsedDate.isValid ? (
                                                                                        parsedDate.display
                                                                                    ) : (
                                                                                        cellVal
                                                                                    )
                                                                                ) : (
                                                                                    cellVal
                                                                                )}
                                                                            </span>

                                                                            {/* Inline Review Badges on Hover or Warning */}
                                                                            <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                                                                {auto === "warn" && (
                                                                                    <span title={reasons.join(", ")}><ShieldAlert className="w-3 h-3 text-amber-500" /></span>
                                                                                )}
                                                                                {auto === "error" && (
                                                                                    <span title={reasons.join(", ")}><ShieldX className="w-3 h-3 text-destructive" /></span>
                                                                                )}

                                                                                {/* Edit Pencil Icon on hover */}
                                                                                <button
                                                                                    type="button"
                                                                                    title="Редактировать [E]"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setEditingCell({ rowId: fr.fileId, path });
                                                                                        setEditValue(cellVal === "—" ? "" : cellVal);
                                                                                    }}
                                                                                    className="p-0.5 rounded opacity-0 group-hover/cell:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-opacity"
                                                                                >
                                                                                    <Pencil className="w-2.5 h-2.5" />
                                                                                </button>

                                                                                {/* Quick toggle verify on hover */}
                                                                                <button
                                                                                    type="button"
                                                                                    title={human === "confirmed" ? "Снять подтверждение" : "Подтвердить поле [Enter]"}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        if (onConfirmCell) onConfirmCell(fr.fileId, path);
                                                                                        else if (onToggleVerifyCell) onToggleVerifyCell(fr.fileId, path);
                                                                                    }}
                                                                                    className={`p-0.5 rounded opacity-0 group-hover/cell:opacity-100 hover:bg-muted transition-opacity ${
                                                                                        human === "confirmed"
                                                                                            ? "text-emerald-600 font-bold"
                                                                                            : "text-muted-foreground"
                                                                                    }`}
                                                                                >
                                                                                    <Check className="w-2.5 h-2.5" />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
