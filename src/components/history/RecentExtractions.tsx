"use client";

import { useState, useMemo } from "react";
import { HistoryRecord } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportToCSV, exportToExcel } from "@/lib/export";
import {
    FileText,
    FolderArchive,
    Trash2,
    Download,
    CheckCircle2,
    Clock,
    Search,
    ChevronRight,
    Sparkles,
    Layers,
    Receipt
} from "lucide-react";
import { toast } from "sonner";

interface RecentExtractionsProps {
    records: HistoryRecord[];
    onSelectRecord: (record: HistoryRecord) => void;
    onDeleteRecord: (id: string) => void;
    onClearAll: () => void;
}

interface ParsedRecordInfo {
    record: HistoryRecord;
    isBatch: boolean;
    title: string;
    itemCount: number;
    totalAmount: number | null;
    totalPages: number;
    verifiedPercent: number;
}

export function RecentExtractions({
    records,
    onSelectRecord,
    onDeleteRecord,
    onClearAll,
}: RecentExtractionsProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<"all" | "batches" | "single">("all");

    // Parse metadata for each history item
    const parsedRecords = useMemo(() => {
        return records.map((record): ParsedRecordInfo => {
            const data = record.extractedData || {};
            const isBatch =
                record.sessionId?.startsWith("batch_") ||
                record.file?.name?.toLowerCase().includes("stitched") ||
                record.file?.name?.toLowerCase().includes("batch");

            // Extract row items count
            let itemCount = 0;
            let totalAmount: number | null = null;
            let maxPage = 1;

            const scanForStats = (obj: any) => {
                if (!obj || typeof obj !== "object") return;
                if (Array.isArray(obj)) {
                    if (obj.length > itemCount) itemCount = obj.length;
                    obj.forEach(scanForStats);
                    return;
                }

                for (const [k, v] of Object.entries(obj)) {
                    if (v && typeof v === "object") {
                        if ("page" in v && typeof (v as any).page === "number") {
                            if ((v as any).page > maxPage) maxPage = (v as any).page;
                        }
                        if ("value" in v) {
                            const val = (v as any).value;
                            if (/total|amount|сума|разом/i.test(k) && typeof val === "number" && !totalAmount) {
                                totalAmount = val;
                            } else if (/total|amount|сума|разом/i.test(k) && typeof val === "string" && !totalAmount) {
                                const parsed = parseFloat(val.replace(/[^\d.-]/g, ""));
                                if (!isNaN(parsed)) totalAmount = parsed;
                            }
                        }
                        scanForStats(v);
                    } else if (/total|amount|сума|разом/i.test(k) && typeof v === "number" && !totalAmount) {
                        totalAmount = v;
                    }
                }
            };

            scanForStats(data);

            // Compute verification percent
            let verifiedPercent = 0;
            if (record.verificationState) {
                const values = Object.values(record.verificationState);
                if (values.length > 0) {
                    const verifiedCount = values.filter(v => v.status === "verified" || v.status === "edited").length;
                    verifiedPercent = Math.round((verifiedCount / values.length) * 100);
                }
            }

            let title = record.file?.name || "Untitled Document";
            if (isBatch) {
                title = maxPage > 1
                    ? `Batch Session: ${maxPage} Receipts / Pages`
                    : `Batch Extraction (${itemCount} Items)`;
            }

            return {
                record,
                isBatch: Boolean(isBatch),
                title,
                itemCount,
                totalAmount,
                totalPages: maxPage,
                verifiedPercent,
            };
        });
    }, [records]);

    // Filter by query and tab
    const filtered = useMemo(() => {
        return parsedRecords.filter(item => {
            if (filterType === "batches" && !item.isBatch) return false;
            if (filterType === "single" && item.isBatch) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchName = item.title.toLowerCase().includes(q) || item.record.file?.name?.toLowerCase().includes(q);
                const matchPrompt = item.record.prompt?.toLowerCase().includes(q);
                return matchName || matchPrompt;
            }
            return true;
        });
    }, [parsedRecords, searchQuery, filterType]);

    const handleQuickExport = (e: React.MouseEvent, record: HistoryRecord, format: "excel" | "csv") => {
        e.stopPropagation();
        const baseName = record.file.name.replace(/\.[^/.]+$/, "");
        if (format === "excel") {
            exportToExcel(record.extractedData, `${baseName}.xls`);
            toast.success("Excel downloaded", { description: `${baseName}.xls ready` });
        } else {
            exportToCSV(record.extractedData, `${baseName}.csv`);
            toast.success("CSV downloaded", { description: `${baseName}.csv ready` });
        }
    };

    if (records.length === 0) return null;

    return (
        <div className="mt-12 w-full max-w-4xl mx-auto space-y-4">
            {/* Header with Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
                        <span>🕒</span> Extraction History
                    </h3>
                    <Badge variant="secondary" className="font-mono text-xs">
                        {records.length}
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search history..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearAll}
                        className="text-xs text-muted-foreground hover:text-destructive h-8 px-2.5"
                    >
                        Clear All
                    </Button>
                </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 px-1 text-xs">
                <button
                    onClick={() => setFilterType("all")}
                    className={`px-3 py-1 rounded-full font-medium transition-all ${
                        filterType === "all"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    All ({parsedRecords.length})
                </button>
                <button
                    onClick={() => setFilterType("batches")}
                    className={`px-3 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
                        filterType === "batches"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <FolderArchive className="w-3 h-3" />
                    Batches ({parsedRecords.filter(r => r.isBatch).length})
                </button>
                <button
                    onClick={() => setFilterType("single")}
                    className={`px-3 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
                        filterType === "single"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <Receipt className="w-3 h-3" />
                    Single Docs ({parsedRecords.filter(r => !r.isBatch).length})
                </button>
            </div>

            {/* Records Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map(item => (
                    <div
                        key={item.record.id}
                        onClick={() => onSelectRecord(item.record)}
                        className="group relative p-4 rounded-xl border bg-card/60 hover:bg-card hover:border-primary/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between gap-3 overflow-hidden"
                    >
                        {/* Top Line: Icon, Title, Type */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`p-2 rounded-lg shrink-0 ${
                                    item.isBatch
                                        ? "bg-amber-500/10 text-amber-600"
                                        : "bg-primary/10 text-primary"
                                }`}>
                                    {item.isBatch ? (
                                        <Layers className="w-4 h-4" />
                                    ) : item.totalPages > 1 ? (
                                        <FileText className="w-4 h-4" />
                                    ) : (
                                        <Receipt className="w-4 h-4" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-sm font-semibold truncate text-foreground group-hover:text-primary transition-colors" title={item.title}>
                                        {item.title}
                                    </h4>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                        <Clock className="w-3 h-3" />
                                        <span>{new Date(item.record.timestamp).toLocaleDateString()} {new Date(item.record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    onDeleteRecord(item.record.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                                title="Delete from history"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Middle Line: Extracted Stats Badges */}
                        <div className="flex items-center flex-wrap gap-1.5 text-xs font-mono">
                            {item.totalPages > 1 && (
                                <Badge variant="outline" className="text-[11px] font-sans">
                                    📄 {item.totalPages} pages
                                </Badge>
                            )}

                            {item.itemCount > 0 && (
                                <Badge variant="secondary" className="text-[11px] font-sans">
                                    {item.itemCount} items
                                </Badge>
                            )}

                            {item.totalAmount !== null && (
                                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[11px] font-bold">
                                    ₴{item.totalAmount.toLocaleString()}
                                </Badge>
                            )}

                            {item.verifiedPercent > 0 && (
                                <Badge variant="outline" className="text-[11px] font-sans text-emerald-600 border-emerald-500/30">
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    {item.verifiedPercent}% verified
                                </Badge>
                            )}
                        </div>

                        {/* Bottom Actions Line on Hover */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                            <span className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={item.record.file.name}>
                                {item.record.file.name}
                            </span>

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={e => handleQuickExport(e, item.record, "excel")}
                                    className="px-2 py-0.5 rounded text-[11px] bg-muted hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-1 font-medium"
                                    title="Quick Export to Excel (.xls)"
                                >
                                    📗 Excel
                                </button>
                                <button
                                    onClick={e => handleQuickExport(e, item.record, "csv")}
                                    className="px-2 py-0.5 rounded text-[11px] bg-muted hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-1 font-medium"
                                    title="Quick Export to CSV"
                                >
                                    📊 CSV
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
