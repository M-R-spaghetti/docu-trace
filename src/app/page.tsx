"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DragDropZone } from "@/components/upload/DragDropZone";
import { UploadSuccess } from "@/components/upload/UploadSuccess";
import { DocumentScanner } from "@/components/upload/DocumentScanner";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { BatchDashboard } from "@/components/workspace/BatchDashboard";
import { runBatchOrchestration, BatchJob, BatchProgress } from "@/lib/batch/orchestrator";
import { stitchImagesToPdf } from "@/lib/pdfStitcher";
import { runStreamingPipeline, StreamingProgress } from "@/lib/streamingPipeline";
import { FileSearch, Trash2, Layers } from "lucide-react";

import { saveHistory, getHistory, HistoryRecord, deleteHistory, updateHistory } from "@/lib/db";
import { VerificationStateMap } from "@/lib/types";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState("auto");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [verificationState, setVerificationState] = useState<VerificationStateMap>({});
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // Progressive Streaming & Stitching State
  const [streamingProgress, setStreamingProgress] = useState<StreamingProgress | null>(null);
  const [isStitching, setIsStitching] = useState(false);
  const [stitchProgress, setStitchProgress] = useState(0);
  const [batchFileCount, setBatchFileCount] = useState(0);

  // Batch Mode States
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    active: 0,
    percent: 0,
  });
  const [isBatchPaused, setIsBatchPaused] = useState(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);

  // Auto-save debouncer ref for IndexedDB persistence
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDataChange = useCallback((newData: any, newVerificationState: VerificationStateMap) => {
    setExtractedData(newData);
    setVerificationState(newVerificationState);

    if (currentHistoryId) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        updateHistory(currentHistoryId, {
          extractedData: newData,
          verificationState: newVerificationState,
          timestamp: Date.now()
        }).catch(console.error);
      }, 500);
    }
  }, [currentHistoryId]);

  useEffect(() => {
    getHistory().then(setHistory).catch(console.error);
  }, []);

  const handleBatchFilesAccepted = async (files: File[]) => {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      setFile(files[0]);
      return;
    }

    setBatchFileCount(files.length);
    setIsStitching(true);
    setStitchProgress(0);

    try {
      // 1. Virtual client-side stitching of images into unified PDF
      const stitchedPdf = await stitchImagesToPdf(files, (percent) => {
        setStitchProgress(percent);
      });

      setFile(stitchedPdf);
      setIsStitching(false);

      // 2. Transition immediately into Workspace with progressive streaming!
      setExtractedData({ items: [] });
      setVerificationState({});
      batchAbortControllerRef.current = new AbortController();

      await runStreamingPipeline({
        file: stitchedPdf,
        prompt: prompt || "Extract receipt or invoice information: store name, date, items with quantity and price, and total amount.",
        format: "table",
        chunkSize: 5,
        onChunkSuccess: (chunkData, remappedData, aggregatedData) => {
          setExtractedData({ ...aggregatedData });
        },
        onProgress: (prog) => {
          setStreamingProgress(prog);
        },
        signal: batchAbortControllerRef.current.signal,
      });
    } catch (err: any) {
      console.error("Progressive streaming error:", err);
      setIsStitching(false);
    }
  };

  const handleExtract = async () => {
    if (!file) return;

    setError(null);

    // If multi-page PDF, use progressive streaming pipeline!
    if (file.type === "application/pdf") {
      setIsExtracting(true);
      batchAbortControllerRef.current = new AbortController();

      try {
        let firstChunkReady = false;
        await runStreamingPipeline({
          file,
          prompt: prompt.trim() || undefined,
          format,
          chunkSize: 5,
          onChunkSuccess: (chunkData, remappedData, aggregatedData) => {
            setExtractedData({ ...aggregatedData });
            if (!firstChunkReady) {
              firstChunkReady = true;
              setIsExtracting(false); // Switch to workspace immediately on first chunk!
            }
          },
          onProgress: (prog) => {
            setStreamingProgress(prog);
          },
          signal: batchAbortControllerRef.current.signal,
        });

        return;
      } catch (err: any) {
        setIsExtracting(false);
        setError(err.message || "Extraction failed");
        return;
      }
    }

    // Single image extraction
    setIsExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (prompt.trim()) {
        formData.append("prompt", prompt.trim());
      }
      formData.append("format", format);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned error (${response.status})`);
      }

      const data = await response.json();
      setExtractedData(data.data || data);
      setVerificationState({});

      const sessionId = `session_${Date.now()}`;
      const recordId = Date.now().toString();
      setCurrentSessionId(sessionId);
      setCurrentHistoryId(recordId);

      const record: HistoryRecord = {
        id: recordId,
        sessionId,
        file,
        prompt,
        format,
        extractedData: data.data || data,
        verificationState: {},
        timestamp: Date.now()
      };

      saveHistory(record).then(() => {
        setHistory(prev => [record, ...prev.filter(h => h.id !== recordId)]);
      }).catch(console.error);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleRefine = async (newPrompt: string) => {
    if (!file) return;

    setIsRefining(true);
    setError(null);

    try {
      const combinedPrompt = prompt ? `${prompt}\n\nДополнительно извлечь/уточнить: ${newPrompt}` : `Извлечь/уточнить: ${newPrompt}`;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("prompt", combinedPrompt);
      formData.append("format", format);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to extract data");
        } else {
          throw new Error(`Server returned an unexpected error (${response.status}).`);
        }
      }

      const data = await response.json();
      setExtractedData(data);
      setVerificationState({});
      setPrompt(combinedPrompt);

      // Update existing history record instead of creating a new one
      if (currentHistoryId) {
        const updates: Partial<HistoryRecord> = {
          prompt: combinedPrompt,
          extractedData: data,
          verificationState: {},
          timestamp: Date.now()
        };
        updateHistory(currentHistoryId, updates).then(() => {
          setHistory(prev => prev.map(h =>
            h.id === currentHistoryId ? { ...h, ...updates } : h
          ));
        }).catch(console.error);
      } else {
        // Fallback: create new record if no session exists
        const sessionId = currentSessionId || `session_${Date.now()}`;
        const recordId = Date.now().toString();
        setCurrentSessionId(sessionId);
        setCurrentHistoryId(recordId);

        const record: HistoryRecord = {
          id: recordId,
          sessionId,
          file,
          prompt: combinedPrompt,
          format,
          extractedData: data,
          verificationState: {},
          timestamp: Date.now()
        };

        saveHistory(record).then(() => {
          setHistory(prev => [record, ...prev]);
        }).catch(console.error);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred during refinement");
    } finally {
      setIsRefining(false);
    }
  };

  const handleReset = () => {
    batchAbortControllerRef.current?.abort();
    setFile(null);
    setExtractedData(null);
    setVerificationState({});
    setStreamingProgress(null);
    setIsStitching(false);
    setError(null);
    setCurrentSessionId(null);
    setCurrentHistoryId(null);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] p-4 md:p-8">
      <div className={`w-full mx-auto space-y-12 ${extractedData ? "max-w-[1800px]" : "max-w-4xl"}`}>
        {!extractedData && (
          <div className="text-center space-y-4">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex justify-center mb-6"
            >
              <div className="p-3 bg-primary/10 rounded-2xl">
                <FileSearch className="w-12 h-12 text-primary" />
              </div>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70"
            >
              AI Document Intelligence
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
            >
              Instantly extract, verify, and trace structured data from invoices and receipts with our human-in-the-loop verification system.
            </motion.p>
          </div>
        )}

        <div className="relative min-h-[400px]">
          <AnimatePresence mode="wait">
            {isStitching && (
              <motion.div
                key="stitching"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center p-12 text-center"
              >
                <div className="p-4 bg-primary/10 rounded-2xl mb-4 text-primary">
                  <Layers className="w-10 h-10 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold">Stitching Receipts into Unified Document...</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Merging {batchFileCount} receipt scans into one high-res multi-page document ({stitchProgress}%)...
                </p>
              </motion.div>
            )}

            {!file && !isExtracting && !isStitching && !extractedData && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
                className="w-full pb-12"
              >
                <DragDropZone
                  onFileAccepted={setFile}
                  onFilesAccepted={handleBatchFilesAccepted}
                />

                {history.length > 0 && (
                  <div className="mt-12 w-full max-w-4xl mx-auto space-y-4">
                    <h3 className="text-xl font-semibold px-2 flex items-center gap-2">
                      <span>🕒</span> Recent Extractions
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {history.map((record) => (
                        <div
                          key={record.id}
                          className="p-4 border rounded-xl bg-card hover:shadow-md transition cursor-pointer flex justify-between items-center group"
                          onClick={() => {
                            setFile(record.file);
                            setPrompt(record.prompt);
                            setFormat(record.format);
                            setExtractedData(record.extractedData);
                            setVerificationState(record.verificationState || {});
                            setCurrentSessionId(record.sessionId);
                            setCurrentHistoryId(record.id);
                          }}
                        >
                          <div className="flex flex-col truncate w-[85%]">
                            <span className="font-medium text-sm truncate" title={record.file.name}>{record.file.name}</span>
                            <span className="text-xs text-muted-foreground mt-1">
                              {new Date(record.timestamp).toLocaleDateString()} • {record.format.toUpperCase()}
                            </span>
                          </div>
                          <button
                            className="opacity-0 group-hover:opacity-100 p-2 text-destructive hover:bg-destructive/10 rounded transition-all"
                            title="Delete from history"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHistory(record.id).then(() => setHistory(h => h.filter(x => x.id !== record.id)));
                            }}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {file && !isExtracting && !isStitching && !extractedData && (
              <motion.div
                key="success"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <UploadSuccess
                  file={file}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  format={format}
                  onFormatChange={setFormat}
                  onProceed={handleExtract}
                  onReset={handleReset}
                />
                {error && (
                  <p className="text-destructive text-center mt-4">{error}</p>
                )}
              </motion.div>
            )}

            {isExtracting && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <DocumentScanner />
              </motion.div>
            )}

            {extractedData && file && !isExtracting && (
              <motion.div
                key="workspace"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, type: "spring" }}
                className="w-full"
              >
                <WorkspaceLayout
                  file={file}
                  data={extractedData}
                  isRefining={isRefining}
                  onRefine={handleRefine}
                  onDataChange={handleDataChange}
                  verificationState={verificationState}
                  streamingProgress={streamingProgress}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
