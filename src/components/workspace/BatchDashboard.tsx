"use client";

import { useState, useMemo } from "react";
import { BatchJob, BatchProgress, compileMasterRows } from "@/lib/batch/orchestrator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportToCSV, exportToExcel, exportToJSON } from "@/lib/export";
import dynamic from "next/dynamic";
import { ActiveHighlight } from "@/lib/types";

const DocumentViewer = dynamic(
    () => import("@/components/workspace/DocumentViewer").then(mod => mod.DocumentViewer),
    { ssr: false }
);
import { motion, AnimatePresence } from "framer-motion";
import {
    Loader2,
    CheckCircle2,
    AlertCircle,
    FileSpreadsheet,
    FileText,
    Play,
    Pause,
    X,
    Eye,
    ChevronRight,
    ArrowLeft,
    Check,
    Layers,
    Clock,
    Database,
    Download
} from "lucide-react";

interface BatchDashboardProps {
    jobs: BatchJob[];
    progress: BatchProgress;
    isPaused: boolean;
    onTogglePause: () => void;
    onCancel: () => void;
    onReset: () => void;
}

export function BatchDashboard({
    jobs,
    progress,
    isPaused,
    onTogglePause,
    onCancel,
    onReset,
}: BatchDashboardProps) {
    const [selectedJob, setSelectedJob] = useState<BatchJob | null>(null);
    const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);
    const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'json'>('excel');
    const [activeTab, setActiveTab] = useState<'table' | 'queue'>('table');

    // Compile all rows across all finished documents
    const masterData = useMemo(() => {
        return compileMasterRows(jobs);
    }, [jobs]);

    const isFinished = progress.total > 0 && (progress.completed + progress.failed + progress.skipped) === progress.total;

    // Handle export for all documents combined
    const handleMasterExport = () => {
        if (masterData.rows.length === 0) return;

        const baseFilename = `docutrace_batch_${new Date().toISOString().slice(0, 10)}`;

        if (exportFormat === 'excel') {
            exportToExcel(masterData.rows, `${baseFilename}.xls`);
        } else if (exportFormat === 'json') {
            exportToJSON(masterData.rows, `${baseFilename}.json`);
        } else {
            exportToCSV(masterData.rows, `${baseFilename}.csv`);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] w-full overflow-hidden bg-background">
            {/* Top Stats Banner */}
            <header className="border-b bg-muted/20 px-6 py-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                            <Layers className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold tracking-tight">Batch Processing Orchestrator</h1>
                                <Badge variant={isFinished ? "default" : "secondary"} className="text-xs">
                                    {isFinished ? "Completed" : isPaused ? "Paused" : "Processing"}
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Client-orchestrated parallel extraction with rate-limit defense and shared schema.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isFinished && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onTogglePause}
                                className="h-9 gap-1.5"
                            >
                                {isPaused ? <Play className="w-4 h-4 text-emerald-600" /> : <Pause className="w-4 h-4 text-amber-600" />}
                                {isPaused ? "Resume" : "Pause"}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onReset}
                            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Upload
                        </Button>
                    </div>
                </div>

                {/* Progress Bar and Metrics */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs font-medium">
                        <span className="text-muted-foreground">
                            Progress: {progress.completed + progress.skipped} of {progress.total} files processed ({progress.percent}%)
                        </span>
                        <div className="flex items-center gap-4 text-xs font-mono">
                            <span className="text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> {progress.completed} done
                            </span>
                            {progress.failed > 0 && (
                                <span className="text-destructive flex items-center gap-1">
                                    <AlertCircle className="w-3.5 h-3.5" /> {progress.failed} failed
                                </span>
                            )}
                            {progress.skipped > 0 && (
                                <span className="text-muted-foreground flex items-center gap-1">
                                    <Database className="w-3.5 h-3.5" /> {progress.skipped} cached
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Styled progress track */}
                    <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden relative">
                        <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress.percent}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                </div>

                {/* Quick Stats Grid & Export Bar */}
                <div className="flex items-center justify-between pt-1 border-t">
                    <div className="flex items-center gap-6 text-sm">
                        <div>
                            <span className="text-xs text-muted-foreground block">Master Rows</span>
                            <span className="font-bold text-foreground">{masterData.rows.length} rows</span>
                        </div>
                        {masterData.totalAmount > 0 && (
                            <div>
                                <span className="text-xs text-muted-foreground block">Total Extracted Sum</span>
                                <span className="font-bold text-emerald-600 font-mono">
                                    {masterData.totalAmount.toLocaleString()}
                                </span>
                            </div>
                        )}
                        <div>
                            <span className="text-xs text-muted-foreground block">View Mode</span>
                            <div className="flex items-center gap-1 mt-0.5">
                                <Button
                                    variant={activeTab === 'table' ? "default" : "ghost"}
                                    size="sm"
                                    className="h-7 text-xs px-2.5"
                                    onClick={() => setActiveTab('table')}
                                >
                                    Master Table ({masterData.rows.length})
                                </Button>
                                <Button
                                    variant={activeTab === 'queue' ? "default" : "ghost"}
                                    size="sm"
                                    className="h-7 text-xs px-2.5"
                                    onClick={() => setActiveTab('queue')}
                                >
                                    File Queue ({jobs.length})
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Master Export Control */}
                    <div className="flex items-center gap-2">
                        <div className="flex bg-muted rounded-lg p-0.5 border text-xs">
                            <button
                                onClick={() => setExportFormat('excel')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-all ${exportFormat === 'excel' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'}`}
                            >
                                📗 Excel (.xls)
                            </button>
                            <button
                                onClick={() => setExportFormat('csv')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-all ${exportFormat === 'csv' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'}`}
                            >
                                📊 CSV
                            </button>
                            <button
                                onClick={() => setExportFormat('json')}
                                className={`px-2.5 py-1 rounded-md font-medium transition-all ${exportFormat === 'json' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground'}`}
                            >
                                📄 JSON
                            </button>
                        </div>

                        <Button
                            onClick={handleMasterExport}
                            disabled={masterData.rows.length === 0}
                            size="sm"
                            className="h-8 gap-1.5 font-medium"
                        >
                            <Download className="w-4 h-4" />
                            Export All ({masterData.rows.length})
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content Area: Split View when inspecting a file */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left/Center: Table or Queue */}
                <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${selectedJob ? 'w-1/2 border-r' : 'w-full'}`}>
                    {activeTab === 'table' ? (
                        <div className="flex-1 overflow-auto p-4">
                            {masterData.rows.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                                    <FileSpreadsheet className="w-12 h-12 mb-3 stroke-[1.5] text-muted-foreground/60 animate-pulse" />
                                    <h3 className="font-semibold text-foreground">Waiting for document extractions...</h3>
                                    <p className="text-xs max-w-sm mt-1">
                                        Rows from all completed receipts will appear in this unified master table automatically.
                                    </p>
                                </div>
                            ) : (
                                <div className="rounded-xl border shadow-xs overflow-hidden bg-card">
                                    <table className="w-full text-xs text-left border-collapse">
                                        <thead className="bg-muted/70 sticky top-0 z-10 border-b font-semibold text-muted-foreground uppercase tracking-wider">
                                            <tr>
                                                <th className="px-3 py-2.5">Source</th>
                                                {masterData.columns.filter(c => !c.startsWith('_')).map(col => (
                                                    <th key={col} className="px-3 py-2.5">
                                                        {col.replace(/_/g, ' ')}
                                                    </th>
                                                ))}
                                                <th className="px-3 py-2.5 text-right">Inspect</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border font-mono">
                                            {masterData.rows.map((row, idx) => (
                                                <tr
                                                    key={`row_${idx}`}
                                                    className="hover:bg-muted/40 transition-colors group cursor-pointer"
                                                    onClick={() => {
                                                        const matchingJob = jobs.find(j => j.filename === row._source_file);
                                                        if (matchingJob) setSelectedJob(matchingJob);
                                                    }}
                                                >
                                                    <td className="px-3 py-2 whitespace-nowrap">
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[11px] font-sans text-foreground">
                                                            📄 {row._source_file}
                                                        </span>
                                                    </td>
                                                    {masterData.columns.filter(c => !c.startsWith('_')).map(col => (
                                                        <td key={col} className="px-3 py-2 text-foreground truncate max-w-[200px]">
                                                            {row[col] !== undefined && row[col] !== null ? String(row[col]) : '-'}
                                                        </td>
                                                    ))}
                                                    <td className="px-3 py-2 text-right">
                                                        <button className="text-primary hover:underline text-xs flex items-center gap-0.5 ml-auto">
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Queue List View */
                        <div className="flex-1 overflow-auto p-4 space-y-2">
                            {jobs.map(job => (
                                <div
                                    key={job.filename}
                                    onClick={() => setSelectedJob(job)}
                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedJob?.filename === job.filename ? 'border-primary bg-primary/5' : 'hover:bg-muted/30 bg-card'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        {job.status === 'extracting' || job.status === 'preparing' ? (
                                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                                        ) : job.status === 'done' ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        ) : job.status === 'failed' ? (
                                            <AlertCircle className="w-4 h-4 text-destructive" />
                                        ) : job.status === 'skipped' ? (
                                            <Database className="w-4 h-4 text-muted-foreground" />
                                        ) : (
                                            <Clock className="w-4 h-4 text-muted-foreground" />
                                        )}
                                        <div>
                                            <span className="text-sm font-medium text-foreground block">
                                                {job.filename}
                                            </span>
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {(job.size / 1024).toFixed(1)} KB {job.durationMs ? `· ${(job.durationMs / 1000).toFixed(1)}s` : ''}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                job.status === 'done' ? 'default' :
                                                job.status === 'extracting' ? 'secondary' :
                                                job.status === 'failed' ? 'destructive' : 'outline'
                                            }
                                            className="text-[11px] capitalize"
                                        >
                                            {job.status}
                                        </Badge>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Side: Document Inspector with Vector Snapping & Highlighter */}
                <AnimatePresence>
                    {selectedJob && (
                        <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: "50%", opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            className="flex-1 flex flex-col h-full bg-muted/10 overflow-hidden"
                        >
                            <div className="p-3 border-b bg-background flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm truncate max-w-xs">
                                        {selectedJob.filename}
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                        {selectedJob.status}
                                    </Badge>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setSelectedJob(null)}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="flex-1 overflow-hidden p-3">
                                <DocumentViewer
                                    file={selectedJob.file}
                                    activeHighlight={activeHighlight}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
