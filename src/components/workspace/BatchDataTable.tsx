"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { DocRow, RowVerificationStatus, FlatRow } from "@/lib/batchTypes";
import { ActiveHighlight } from "@/lib/types";
import { explodeDoc, getDisplayValue, isLocatedValue, walkLeaves, vKey } from "@/lib/flatten";
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
    Clock
} from "lucide-react";

interface BatchDataTableProps {
    rows: DocRow[];
    selectedRowId?: string;
    onSelectRow: (row: DocRow) => void;
    onSelectCellHighlight: (row: DocRow, colKey: string, highlight: ActiveHighlight) => void;
    onUpdateCell?: (rowId: string, path: string, newValue: string) => void;
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
    onToggleVerifyCell,
    onRetryFailed,
    schema,
    isProcessing,
}: BatchDataTableProps) {
    const [filter, setFilter] = useState<"all" | "problematic" | "verified">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [exportFormat, setExportFormat] = useState<"csv" | "excel" | "json">("excel");
    const [editingCell, setEditingCell] = useState<{ rowId: string; path: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingCell && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingCell]);

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

    // Real leaf verification statistics
    const stats = useMemo(() => {
        let totalLeaves = 0;
        let verifiedLeaves = 0;
        let failedDocs = 0;

        for (const r of rows) {
            if (r.status === "failed" || r.status === "timeout") {
                failedDocs++;
            }
            if (r.status === "done" && r.data) {
                const leaves = walkLeaves(r.data);
                for (const leaf of leaves) {
                    totalLeaves++;
                    const st = r.verified?.[leaf.path];
                    if (st === "verified" || st === "edited" || st === "auto_verified") {
                        verifiedLeaves++;
                    }
                }
            }
        }

        const percent = totalLeaves > 0 ? Math.round((verifiedLeaves / totalLeaves) * 100) : 0;

        // Check which flat rows are problematic
        const isFlatRowProblematic = (fr: FlatRow): boolean => {
            if (fr.status === "failed" || fr.status === "timeout") return true;
            if (fr.status === "extracting" || fr.status === "queued") return false;
            if (Object.keys(fr.cells).length === 0) return true;

            const parentDoc = rows.find(r => r.fileId === fr.fileId || r.fileName === fr.fileName);
            for (const col of columns) {
                const cell = fr.cells[col];
                if (!cell) continue;
                const disp = getDisplayValue(cell.node);
                if (disp === "—" || disp.trim() === "") return true;
                const st = parentDoc?.verified?.[cell.path] || "pending";
                if (st === "pending") return true;
            }
            return false;
        };

        const isFlatRowVerified = (fr: FlatRow): boolean => {
            if (fr.status !== "done") return false;
            if (Object.keys(fr.cells).length === 0) return false;
            const parentDoc = rows.find(r => r.fileId === fr.fileId || r.fileName === fr.fileName);
            for (const col of columns) {
                const cell = fr.cells[col];
                if (!cell) continue;
                const st = parentDoc?.verified?.[cell.path];
                if (st !== "verified" && st !== "edited" && st !== "auto_verified") return false;
            }
            return true;
        };

        const problemRowsCount = flatRows.filter(isFlatRowProblematic).length;
        const verifiedRowsCount = flatRows.filter(isFlatRowVerified).length;

        return {
            totalLeaves,
            verifiedLeaves,
            percent,
            problemRowsCount,
            verifiedRowsCount,
            totalItems: flatRows.length,
            totalDocs: rows.length,
            doneDocs: rows.filter(r => r.status === "done").length,
            failedDocs,
        };
    }, [rows, flatRows, columns]);

    // Filter flat rows
    const filteredFlatRows = useMemo(() => {
        return flatRows.filter(fr => {
            const parentDoc = rows.find(r => r.fileId === fr.fileId || r.fileName === fr.fileName);

            if (filter === "problematic") {
                if (fr.status === "failed" || fr.status === "timeout") return true;
                if (fr.status === "extracting" || fr.status === "queued") return false;
                let hasIssue = false;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const disp = getDisplayValue(cell.node);
                    if (disp === "—" || disp.trim() === "") { hasIssue = true; break; }
                    const st = parentDoc?.verified?.[cell.path] || "pending";
                    if (st === "pending") { hasIssue = true; break; }
                }
                if (!hasIssue) return false;
            } else if (filter === "verified") {
                if (fr.status !== "done") return false;
                let allGood = true;
                for (const col of columns) {
                    const cell = fr.cells[col];
                    if (!cell) continue;
                    const st = parentDoc?.verified?.[cell.path];
                    if (st !== "verified" && st !== "edited" && st !== "auto_verified") { allGood = false; break; }
                }
                if (!allGood) return false;
            }

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchesName = fr.fileName.toLowerCase().includes(q);
                const matchesCells = Object.values(fr.cells).some(c => getDisplayValue(c.node).toLowerCase().includes(q));
                if (!matchesName && !matchesCells) return false;
            }

            return true;
        });
    }, [flatRows, filter, searchQuery, rows, columns]);

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
            {/* Header & Export Controls */}
            <div className="p-4 border-b bg-muted/20 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base tracking-tight text-foreground">
                                Пакетная таблица позиций
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
                            Каждая строка — отдельная позиция чека. Кликните по ячейке для подсветки координат.
                        </p>
                    </div>

                    {/* Actions & Export */}
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

                {/* Verification Progress Bar */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">
                            Проверка данных:{" "}
                            <span className="text-foreground font-bold font-mono">
                                {stats.verifiedLeaves} / {stats.totalLeaves} полей ({stats.percent}%)
                            </span>
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                            {stats.doneDocs} из {stats.totalDocs} чеков готово
                        </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-primary"
                            initial={{ width: 0 }}
                            animate={{ width: `${stats.percent}%` }}
                            transition={{ duration: 0.4 }}
                        />
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
                            variant={filter === "problematic" ? "default" : "ghost"}
                            size="sm"
                            className={`h-7 text-xs px-2.5 gap-1.5 ${filter === "problematic" ? "" : stats.problemRowsCount > 0 ? "text-amber-600 hover:text-amber-700 bg-amber-500/10" : ""}`}
                            onClick={() => setFilter("problematic")}
                        >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                            Требуют внимания ({stats.problemRowsCount})
                        </Button>
                        <Button
                            variant={filter === "verified" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2.5 gap-1.5"
                            onClick={() => setFilter("verified")}
                        >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            Проверены ({stats.verifiedRowsCount})
                        </Button>
                    </div>

                    <div className="relative w-48">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Поиск по чекам..."
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
                                    {filter === "problematic" ? (
                                        <div className="flex flex-col items-center gap-1">
                                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                                            <p className="font-semibold text-foreground">Все строки корректны и проверены!</p>
                                            <p className="text-xs text-muted-foreground">Расхождений или пустых полей не обнаружено.</p>
                                        </div>
                                    ) : (
                                        "Нет позиций, соответствующих фильтру."
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filteredFlatRows.map((fr, idx) => {
                                const parentDoc = rows.find(r => r.fileId === fr.fileId || r.fileName === fr.fileName);
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
                                            const vStatus = parentDoc?.verified?.[path] || "pending";
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
                                                            onSelectCellHighlight(parentDoc || { fileId: fr.fileId, fileName: fr.fileName, file: fr.file!, data: {}, status: fr.status, verified: {} }, col, {
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

                                                            {/* Verification & Edit Actions on hover/status */}
                                                            <div className="flex items-center gap-0.5 shrink-0">
                                                                {vStatus === "auto_verified" && (
                                                                    <span title="Автоматически проверено правилом" className="text-emerald-500/80">
                                                                        <ShieldCheck className="w-3.5 h-3.5" />
                                                                    </span>
                                                                )}
                                                                {vStatus === "verified" && (
                                                                    <span title="Подтверждено пользователем" className="text-emerald-600 font-bold">
                                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                                    </span>
                                                                )}
                                                                {vStatus === "edited" && (
                                                                    <span title="Отредактировано" className="text-primary">
                                                                        <Pencil className="w-3 h-3" />
                                                                    </span>
                                                                )}

                                                                {/* Hover Buttons */}
                                                                <div className="flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity ml-1">
                                                                    <button
                                                                        type="button"
                                                                        title="Редактировать значение"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setEditingCell({ rowId: fr.fileId, path });
                                                                            setEditValue(cellVal === "—" ? "" : cellVal);
                                                                        }}
                                                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                    >
                                                                        <Pencil className="w-3 h-3" />
                                                                    </button>

                                                                    {onToggleVerifyCell && (
                                                                        <button
                                                                            type="button"
                                                                            title={vStatus === "verified" ? "Снять проверку" : "Отметить как проверенное"}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onToggleVerifyCell(fr.fileId, path);
                                                                            }}
                                                                            className={`p-1 rounded hover:bg-muted ${
                                                                                vStatus === "verified"
                                                                                    ? "text-emerald-600 hover:text-emerald-700"
                                                                                    : "text-muted-foreground hover:text-foreground"
                                                                            }`}
                                                                        >
                                                                            <Check className="w-3 h-3" />
                                                                        </button>
                                                                    )}
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
