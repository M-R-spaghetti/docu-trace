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
    CheckCircle2,
    Clock,
    Search,
    Layers,
    Files,
    X,
    ExternalLink
} from "lucide-react";
import { toast } from "sonner";

interface RecentExtractionsProps {
    records: HistoryRecord[];
    onSelectRecord: (record: HistoryRecord) => void;
    onDeleteRecord: (idOrIds: string | string[]) => void;
    onClearAll: () => void;
}

interface GroupedSessionInfo {
    sessionId: string;
    recordIds: string[];
    primaryRecord: HistoryRecord;
    allRecords: HistoryRecord[];
    isBatch: boolean;
    title: string;
    fileCount: number;
    fileNames: string[];
    itemCount: number;
    totalAmount: number | null;
    totalPages: number;
    timestamp: number;
    mergedData: any;
}

export function RecentExtractions({
    records,
    onSelectRecord,
    onDeleteRecord,
    onClearAll,
}: RecentExtractionsProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<"all" | "batches" | "single">("all");
    const [viewingBatch, setViewingBatch] = useState<GroupedSessionInfo | null>(null);
    const [batchFileSearch, setBatchFileSearch] = useState("");

    // Intelligently group records by sessionId so multi-file uploads are ONE card
    const groupedSessions = useMemo(() => {
        const sessionMap = new Map<string, HistoryRecord[]>();

        for (const record of records) {
            // Group by sessionId (e.g. batch_1788460000 or stitched batch id)
            const key = record.sessionId || record.id;
            if (!sessionMap.has(key)) {
                sessionMap.set(key, []);
            }
            sessionMap.get(key)!.push(record);
        }

        const result: GroupedSessionInfo[] = [];

        sessionMap.forEach((sessionRecords, sessionId) => {
            const primaryRecord = sessionRecords[0];
            const recordIds = sessionRecords.map(r => r.id);

            // Determine if this session is a batch
            const hasMultipleRecords = sessionRecords.length > 1;
            const hasBatchInfo = Boolean(primaryRecord.batchInfo && primaryRecord.batchInfo.totalFiles > 1);
            const isStitched = Boolean(primaryRecord.file?.name?.toLowerCase().includes("stitched"));

            const isBatch = hasMultipleRecords || hasBatchInfo || isStitched;

            // Extract file names and total file count
            let fileCount = 1;
            let fileNames: string[] = [];

            if (hasMultipleRecords) {
                fileCount = sessionRecords.length;
                fileNames = sessionRecords.map(r => r.file?.name || "Scan");
            } else if (hasBatchInfo) {
                fileCount = primaryRecord.batchInfo!.totalFiles;
                fileNames = primaryRecord.batchInfo!.fileNames || [];
            } else {
                fileCount = 1;
                fileNames = [primaryRecord.file?.name || "Document"];
            }

            // Aggregate items, total amount, and merged data
            let totalItems = 0;
            let totalAmountSum: number | null = null;
            let maxPages = Math.max(fileCount, sessionRecords.length);
            const allItemsMerged: any[] = [];

            sessionRecords.forEach(rec => {
                const data = rec.extractedData || {};

                // Find arrays of items
                for (const [k, v] of Object.entries(data)) {
                    if (Array.isArray(v)) {
                        totalItems += v.length;
                        v.forEach(row => {
                            if (row && typeof row === "object") {
                                allItemsMerged.push({
                                    _sourceDocument: rec.file?.name || "Document",
                                    ...row
                                });
                            }
                        });
                    }
                }

                // Scan for total / amount
                const scanAmount = (obj: any) => {
                    if (!obj || typeof obj !== "object") return;
                    for (const [k, v] of Object.entries(obj)) {
                        if (/total|amount|сума|разом/i.test(k)) {
                            let num: number | null = null;
                            if (typeof v === "number") num = v;
                            else if (v && typeof v === "object" && "value" in v) {
                                const val = (v as any).value;
                                if (typeof val === "number") num = val;
                                else if (typeof val === "string") {
                                    const parsed = parseFloat(val.replace(/[^\d.-]/g, ""));
                                    if (!isNaN(parsed)) num = parsed;
                                }
                            } else if (typeof v === "string") {
                                const parsed = parseFloat(v.replace(/[^\d.-]/g, ""));
                                if (!isNaN(parsed)) num = parsed;
                            }
                            if (num !== null && !isNaN(num)) {
                                totalAmountSum = (totalAmountSum || 0) + num;
                                return; // count once per record
                            }
                        }
                    }
                };
                scanAmount(data);
            });

            // Build merged data payload for quick export & opening
            const mergedData = hasMultipleRecords
                ? { items: allItemsMerged }
                : primaryRecord.extractedData;

            // Generate clean title
            let title = primaryRecord.file?.name || "Untitled Document";
            if (isBatch && fileCount > 1) {
                title = `📁 Пакет: ${fileCount} файлов`;
            } else {
                title = primaryRecord.file?.name || "Документ";
            }

            // Collect all File objects available in this session
            const allFilesFromRecords = sessionRecords
                .map(r => r.file)
                .filter(Boolean) as File[];

            const combinedBatchFilesMap = new Map<string, File>();
            if (primaryRecord.batchFiles) {
                primaryRecord.batchFiles.forEach(f => {
                    if (f && f.name) combinedBatchFilesMap.set(f.name, f);
                });
            }
            allFilesFromRecords.forEach(f => {
                if (f && f.name && !combinedBatchFilesMap.has(f.name)) {
                    combinedBatchFilesMap.set(f.name, f);
                }
            });
            const sessionBatchFiles = Array.from(combinedBatchFilesMap.values());

            result.push({
                sessionId,
                recordIds,
                primaryRecord: {
                    ...primaryRecord,
                    extractedData: mergedData,
                    batchFiles: sessionBatchFiles.length > 0 ? sessionBatchFiles : primaryRecord.batchFiles,
                    batchInfo: {
                        totalFiles: fileCount,
                        fileNames: fileNames,
                        fileSizes: sessionRecords.map(r => r.file?.size || 0),
                    },
                },
                allRecords: sessionRecords,
                isBatch: isBatch && fileCount > 1,
                title,
                fileCount,
                fileNames,
                itemCount: totalItems,
                totalAmount: totalAmountSum,
                totalPages: maxPages,
                timestamp: primaryRecord.timestamp,
                mergedData,
            });
        });

        return result.sort((a, b) => b.timestamp - a.timestamp);
    }, [records]);

    // Filter by search query and tab
    const filtered = useMemo(() => {
        return groupedSessions.filter(item => {
            if (filterType === "batches" && !item.isBatch) return false;
            if (filterType === "single" && item.isBatch) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchTitle = item.title.toLowerCase().includes(q);
                const matchFiles = item.fileNames.some(f => f.toLowerCase().includes(q));
                return matchTitle || matchFiles;
            }
            return true;
        });
    }, [groupedSessions, searchQuery, filterType]);

    const handleQuickExport = (e: React.MouseEvent, session: GroupedSessionInfo, format: "excel" | "csv") => {
        e.stopPropagation();
        const baseName = session.isBatch
            ? `docutrace_batch_${session.fileCount}_files_${new Date().toISOString().slice(0, 10)}`
            : session.primaryRecord.file.name.replace(/\.[^/.]+$/, "");

        if (format === "excel") {
            exportToExcel(session.mergedData, `${baseName}.xls`);
            toast.success("Excel downloaded", { description: `${baseName}.xls ready` });
        } else {
            exportToCSV(session.mergedData, `${baseName}.csv`);
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
                        {groupedSessions.length} {groupedSessions.length === 1 ? "сессия" : "сессий"}
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Поиск по истории..."
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
                        Очистить всё
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
                    Все ({groupedSessions.length})
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
                    Пакеты документов ({groupedSessions.filter(r => r.isBatch).length})
                </button>
                <button
                    onClick={() => setFilterType("single")}
                    className={`px-3 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
                        filterType === "single"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <FileText className="w-3 h-3" />
                    Одиночные ({groupedSessions.filter(r => !r.isBatch).length})
                </button>
            </div>

            {/* Records Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map(session => (
                    <div
                        key={session.sessionId}
                        onClick={() => onSelectRecord(session.primaryRecord)}
                        className="group relative p-4 rounded-xl border bg-card/60 hover:bg-card hover:border-primary/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between gap-3 overflow-hidden"
                    >
                        {/* Top Line: Icon, Title, Delete */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`p-2.5 rounded-lg shrink-0 ${
                                    session.isBatch
                                        ? "bg-amber-500/10 text-amber-600"
                                        : "bg-primary/10 text-primary"
                                }`}>
                                    {session.isBatch ? (
                                        <Layers className="w-5 h-5" />
                                    ) : (
                                        <FileText className="w-5 h-5" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-sm font-bold truncate text-foreground group-hover:text-primary transition-colors" title={session.title}>
                                        {session.title}
                                    </h4>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                        <Clock className="w-3 h-3" />
                                        <span>{new Date(session.timestamp).toLocaleDateString()} {new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    onDeleteRecord(session.recordIds);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                                title="Удалить сессию из истории"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Middle Line: Badges */}
                        <div className="flex items-center flex-wrap gap-1.5 text-xs font-mono">
                            {session.isBatch ? (
                                <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs font-bold font-sans">
                                    📦 {session.fileCount} файлов
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-[11px] font-sans">
                                    📄 1 документ
                                </Badge>
                            )}

                            {session.totalPages > 1 && (
                                <Badge variant="outline" className="text-[11px] font-sans">
                                    📑 {session.totalPages} стр.
                                </Badge>
                            )}

                            {session.itemCount > 0 && (
                                <Badge variant="secondary" className="text-[11px] font-sans">
                                    {session.itemCount} строк
                                </Badge>
                            )}

                            {session.totalAmount !== null && (
                                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[11px] font-bold">
                                    ₴{session.totalAmount.toLocaleString()}
                                </Badge>
                            )}
                        </div>

                        {/* Bottom Actions Line */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                            {session.fileNames.length > 1 ? (
                                <button
                                    onClick={e => {
                                        e.stopPropagation();
                                        setViewingBatch(session);
                                    }}
                                    className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
                                >
                                    <Files className="w-3.5 h-3.5" />
                                    Список файлов ({session.fileNames.length})
                                </button>
                            ) : (
                                <span className="text-[11px] text-muted-foreground truncate max-w-[180px]" title={session.fileNames[0] || session.title}>
                                    {session.fileNames[0] || session.title}
                                </span>
                            )}

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={e => handleQuickExport(e, session, "excel")}
                                    className="px-2 py-0.5 rounded text-[11px] bg-muted hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-1 font-medium"
                                    title="Скачать Excel (.xls)"
                                >
                                    📗 Excel
                                </button>
                                <button
                                    onClick={e => handleQuickExport(e, session, "csv")}
                                    className="px-2 py-0.5 rounded text-[11px] bg-muted hover:bg-primary/10 hover:text-primary transition-colors flex items-center gap-1 font-medium"
                                    title="Скачать CSV"
                                >
                                    📊 CSV
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal: View All Files in Batch */}
            {viewingBatch && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-background border rounded-2xl shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-4 border-b flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600">
                                    <Layers className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm">
                                        Файлы в пакете ({viewingBatch.fileNames.length} файлов)
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        Все загруженные документы этой сессии
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => setViewingBatch(null)}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>

                        <div className="p-3 border-b bg-muted/20">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Поиск по файлам пакета..."
                                    value={batchFileSearch}
                                    onChange={e => setBatchFileSearch(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-1 divide-y divide-border/30">
                            {viewingBatch.fileNames
                                .filter(f => f.toLowerCase().includes(batchFileSearch.toLowerCase()))
                                .map((filename, idx) => (
                                    <div
                                        key={idx}
                                        className="py-2 px-2.5 flex items-center justify-between text-xs hover:bg-muted/40 rounded-lg transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-muted-foreground w-6 text-right shrink-0">
                                                #{idx + 1}
                                            </span>
                                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                            <span className="font-medium truncate" title={filename}>
                                                {filename}
                                            </span>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] font-mono shrink-0 ml-2">
                                            Стр. {idx + 1}
                                        </Badge>
                                    </div>
                                ))}
                        </div>

                        <div className="p-3 border-t bg-muted/10 flex items-center justify-between">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setViewingBatch(null)}
                                className="text-xs h-8"
                            >
                                Закрыть
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => {
                                    onSelectRecord(viewingBatch.primaryRecord);
                                    setViewingBatch(null);
                                }}
                                className="text-xs h-8 gap-1.5"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Открыть рабочую область
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
