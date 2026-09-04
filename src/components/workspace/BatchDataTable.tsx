"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { DocRow, RowVerificationStatus } from "@/lib/batchTypes";
import { ActiveHighlight, LocatedValue } from "@/lib/types";
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
    Filter,
    FileSpreadsheet,
    FileText,
    Eye
} from "lucide-react";

interface BatchDataTableProps {
    rows: DocRow[];
    selectedRowId?: string;
    onSelectRow: (row: DocRow) => void;
    onSelectCellHighlight: (row: DocRow, colKey: string, highlight: ActiveHighlight) => void;
    onUpdateCell?: (rowId: string, colKey: string, newValue: string) => void;
    onToggleVerifyCell?: (rowId: string, colKey: string) => void;
    schema?: any;
    isProcessing?: boolean;
}

function isLocatedValue(v: any): v is LocatedValue<any> {
    return v && typeof v === "object" && "value" in v && "box_2d" in v && Array.isArray(v.box_2d);
}

function getCellValue(v: any): string {
    if (v === null || v === undefined) return "";
    if (isLocatedValue(v)) return String(v.value ?? "");
    return String(v);
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
    schema,
    isProcessing,
}: BatchDataTableProps) {
    const [filter, setFilter] = useState<"all" | "problematic" | "verified">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [exportFormat, setExportFormat] = useState<"csv" | "excel" | "json">("excel");
    const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);

    // Focus edit input
    useEffect(() => {
        if (editingCell && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingCell]);

    // Derive columns from schema properties or data keys
    const columns = useMemo(() => {
        const set = new Set<string>();
        if (schema?.properties) {
            for (const k of Object.keys(schema.properties)) {
                if (k !== "markdown_text") set.add(k);
            }
        }
        for (const r of rows) {
            if (r.data && typeof r.data === "object") {
                for (const k of Object.keys(r.data)) {
                    if (k !== "markdown_text" && !Array.isArray(r.data[k])) {
                        set.add(k);
                    }
                }
            }
        }
        return Array.from(set);
    }, [schema, rows]);

    // Check if row has problematic fields (failed status, or any empty field)
    const isRowProblematic = (row: DocRow): boolean => {
        if (row.status === "failed") return true;
        if (row.status === "extracting" || row.status === "queued") return false;
        if (!row.data || Object.keys(row.data).length === 0) return true;
        for (const col of columns) {
            const val = getCellValue(row.data[col]);
            if (!val || val.trim() === "" || val === "-") return true;
        }
        return false;
    };

    const isRowFullyVerified = (row: DocRow): boolean => {
        if (row.status !== "done") return false;
        if (columns.length === 0) return false;
        return columns.every(col => row.verified?.[col] === "verified" || row.verified?.[col] === "edited");
    };

    // Calculate verification stats across the entire batch
    const stats = useMemo(() => {
        let totalFields = 0;
        let verifiedFields = 0;
        let problemCount = 0;
        let verifiedRowCount = 0;

        for (const r of rows) {
            if (isRowProblematic(r)) problemCount++;
            if (isRowFullyVerified(r)) verifiedRowCount++;

            if (r.status === "done") {
                for (const col of columns) {
                    totalFields++;
                    const st = r.verified?.[col];
                    if (st === "verified" || st === "edited") {
                        verifiedFields++;
                    }
                }
            }
        }

        const percent = totalFields > 0 ? Math.round((verifiedFields / totalFields) * 100) : 0;
        return {
            totalFields,
            verifiedFields,
            percent,
            problemCount,
            verifiedRowCount,
            totalRows: rows.length,
            doneRows: rows.filter(r => r.status === "done").length,
        };
    }, [rows, columns]);

    // Filter and search rows
    const filteredRows = useMemo(() => {
        return rows.filter(r => {
            if (filter === "problematic" && !isRowProblematic(r)) return false;
            if (filter === "verified" && !isRowFullyVerified(r)) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchesName = r.fileName.toLowerCase().includes(q);
                const matchesData = Object.values(r.data || {}).some(v => getCellValue(v).toLowerCase().includes(q));
                if (!matchesName && !matchesData) return false;
            }
            return true;
        });
    }, [rows, filter, searchQuery, columns]);

    const handleSaveEdit = (rowId: string, colKey: string) => {
        if (onUpdateCell) {
            onUpdateCell(rowId, colKey, editValue);
        }
        setEditingCell(null);
    };

    const handleExport = () => {
        const baseName = `batch_export_${new Date().toISOString().slice(0, 10)}`;
        if (exportFormat === "excel") {
            exportBatchToExcel(rows, `${baseName}.xls`);
        } else if (exportFormat === "json") {
            exportBatchToJSON(rows, `${baseName}.json`);
        } else {
            exportBatchToCSV(rows, `${baseName}.csv`);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-card overflow-hidden border-l">
            {/* Top Toolbar */}
            <div className="p-4 border-b bg-muted/20 flex flex-col gap-3 flex-none">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                                <FileSpreadsheet className="w-4 h-4 text-primary" />
                                Таблица пакета ({rows.length} чеков)
                            </h2>
                            {isProcessing && (
                                <Badge variant="secondary" className="gap-1 text-xs py-0.5 animate-pulse bg-primary/10 text-primary">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Обработка...
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Кликните на ячейку, чтобы открыть скан чека и подсветить координаты поля.
                        </p>
                    </div>

                    {/* Export Controls */}
                    <div className="flex items-center gap-2">
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
                            Экспорт всех ({rows.length})
                        </Button>
                    </div>
                </div>

                {/* Batch Verification Progress Bar */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">
                            Проверка данных по пакету:{" "}
                            <span className="text-foreground font-bold font-mono">
                                {stats.verifiedFields} / {stats.totalFields} полей ({stats.percent}%)
                            </span>
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                            {stats.doneRows} из {stats.totalRows} чеков извлечено
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
                            Все ({rows.length})
                        </Button>
                        <Button
                            variant={filter === "problematic" ? "default" : "ghost"}
                            size="sm"
                            className={`h-7 text-xs px-2.5 gap-1.5 ${filter === "problematic" ? "" : stats.problemCount > 0 ? "text-amber-600 hover:text-amber-700 bg-amber-500/10" : ""}`}
                            onClick={() => setFilter("problematic")}
                        >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                            Требуют внимания ({stats.problemCount})
                        </Button>
                        <Button
                            variant={filter === "verified" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 text-xs px-2.5 gap-1.5"
                            onClick={() => setFilter("verified")}
                        >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            Проверены ({stats.verifiedRowCount})
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
                            <th className="py-2.5 px-3 min-w-[140px]">Файл</th>
                            {columns.map(col => (
                                <th key={col} className="py-2.5 px-3 min-w-[120px]">
                                    {formatHeader(col)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 font-mono">
                        {filteredRows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 3} className="py-12 text-center text-muted-foreground font-sans">
                                    {filter === "problematic" ? (
                                        <div className="flex flex-col items-center gap-1">
                                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                                            <p className="font-semibold text-foreground">Проблемных чеков не найдено!</p>
                                            <p className="text-xs text-muted-foreground">Все обязательные поля извлечены корректно.</p>
                                        </div>
                                    ) : (
                                        "Нет документов, соответствующих фильтру."
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filteredRows.map((row, idx) => {
                                const isSelected = row.fileId === selectedRowId || row.fileName === selectedRowId;
                                const isProblematic = isRowProblematic(row);

                                return (
                                    <tr
                                        key={row.fileId || row.fileName}
                                        onClick={() => onSelectRow(row)}
                                        className={`transition-colors cursor-pointer group hover:bg-muted/50 ${
                                            isSelected ? "bg-primary/10 ring-1 ring-primary/40 font-medium" : ""
                                        } ${isProblematic ? "bg-amber-500/5" : ""}`}
                                    >
                                        {/* # */}
                                        <td className="py-2 px-3 text-center text-muted-foreground text-[11px]">
                                            {idx + 1}
                                        </td>

                                        {/* Status */}
                                        <td className="py-2 px-3 font-sans">
                                            {row.status === "done" && (
                                                <Badge variant="outline" className="text-[10px] py-0 gap-1 text-emerald-600 bg-emerald-500/10 border-emerald-500/20">
                                                    <Check className="w-3 h-3" /> Готов
                                                </Badge>
                                            )}
                                            {row.status === "extracting" && (
                                                <Badge variant="outline" className="text-[10px] py-0 gap-1 text-primary bg-primary/10 border-primary/20 animate-pulse">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> Сканирование
                                                </Badge>
                                            )}
                                            {row.status === "queued" && (
                                                <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground bg-muted">
                                                    В очереди
                                                </Badge>
                                            )}
                                            {row.status === "failed" && (
                                                <Badge variant="destructive" className="text-[10px] py-0 gap-1" title={row.error}>
                                                    <AlertCircle className="w-3 h-3" /> Ошибка
                                                </Badge>
                                            )}
                                        </td>

                                        {/* File Name */}
                                        <td className="py-2 px-3 font-sans">
                                            <div className="flex items-center gap-1.5 max-w-[180px] truncate" title={row.fileName}>
                                                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                <span className="truncate text-xs text-foreground font-medium">
                                                    {row.fileName}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Dynamic Schema Columns */}
                                        {columns.map(col => {
                                            const rawObj = row.data?.[col];
                                            const cellVal = getCellValue(rawObj);
                                            const hasBox = isLocatedValue(rawObj);
                                            const vStatus = row.verified?.[col] || "pending";
                                            const isEditing = editingCell?.rowId === row.fileId && editingCell?.colKey === col;
                                            const isEmpty = !cellVal || cellVal.trim() === "";

                                            return (
                                                <td
                                                    key={col}
                                                    className="py-1.5 px-3 relative group/cell"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSelectRow(row);
                                                        if (hasBox) {
                                                            onSelectCellHighlight(row, col, {
                                                                box_2d: rawObj.box_2d,
                                                                page: rawObj.page || 1,
                                                                label: `${row.fileName} → ${formatHeader(col)}`,
                                                                rawValue: cellVal,
                                                                fileId: row.fileId,
                                                                fileName: row.fileName,
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
                                                                    if (e.key === "Enter") handleSaveEdit(row.fileId, col);
                                                                    if (e.key === "Escape") setEditingCell(null);
                                                                }}
                                                                onBlur={() => handleSaveEdit(row.fileId, col)}
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
                                                                    {isEmpty ? "—" : cellVal}
                                                                </span>
                                                            </div>

                                                            {/* Quick action buttons on hover */}
                                                            <div className="flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                                                <button
                                                                    type="button"
                                                                    title="Редактировать"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingCell({ rowId: row.fileId, colKey: col });
                                                                        setEditValue(cellVal);
                                                                    }}
                                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                >
                                                                    <Pencil className="w-3 h-3" />
                                                                </button>
                                                                {onToggleVerifyCell && (
                                                                    <button
                                                                        type="button"
                                                                        title={vStatus === "verified" ? "Подтверждено" : "Подтвердить значение"}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            onToggleVerifyCell(row.fileId, col);
                                                                        }}
                                                                        className={`p-1 rounded transition-colors ${
                                                                            vStatus === "verified"
                                                                                ? "text-emerald-500 bg-emerald-500/10"
                                                                                : "text-muted-foreground hover:text-emerald-600 hover:bg-muted"
                                                                        }`}
                                                                    >
                                                                        <Check className="w-3 h-3" />
                                                                    </button>
                                                                )}
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
