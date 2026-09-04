"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DragDropZone } from "@/components/upload/DragDropZone";
import { UploadSuccess } from "@/components/upload/UploadSuccess";
import { DocumentScanner } from "@/components/upload/DocumentScanner";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { RecentExtractions } from "@/components/history/RecentExtractions";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

import { saveHistory, getHistory, HistoryRecord, deleteHistory, updateHistory, clearAllHistory } from "@/lib/db";
import { VerificationStateMap } from "@/lib/types";
import { runReceiptBatch, retryFailedBatchFiles } from "@/lib/runReceiptBatch";
import { DocRow } from "@/lib/batchTypes";
import { generateFileId } from "@/lib/review";
import { runStreamingPipeline } from "@/lib/streamingPipeline";
import { useSessionContext, AppSession } from "@/lib/sessionContext";
import { toast } from "sonner";

export default function Home() {
  const { 
    sessions, 
    activeSessionId, 
    activeSession, 
    switchToSession, 
    createSession, 
    addSession, 
    updateSession 
  } = useSessionContext();

  // Staging / Upload state for the Home screen
  const [homeFile, setHomeFile] = useState<File | null>(null);
  const [homePrompt, setHomePrompt] = useState("");
  const [homeFormat, setHomeFormat] = useState("auto");
  const [homeBatchFiles, setHomeBatchFiles] = useState<{ name: string; size: number }[]>([]);
  const [homeBatchFileObjects, setHomeBatchFileObjects] = useState<File[]>([]);
  const [homeBatchFileCount, setHomeBatchFileCount] = useState(0);
  const [homeError, setHomeError] = useState<string | null>(null);

  // History records state
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  // AI Refine loading state
  const [isRefining, setIsRefining] = useState(false);

  // Auto-save debouncer ref for IndexedDB persistence
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    getHistory().then(setHistory).catch(console.error);
  }, []);

  const handleBatchFilesAccepted = (files: File[]) => {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      setHomeFile(files[0]);
      setHomeBatchFiles([]);
      setHomeBatchFileObjects([]);
      setHomeBatchFileCount(0);
      return;
    }

    const fileList = files.map(f => ({ name: f.name, size: f.size }));
    setHomeBatchFiles(fileList);
    setHomeBatchFileObjects(files);
    setHomeBatchFileCount(files.length);
    setHomeFile(files[0]);
  };

  const handleFileAccepted = (file: File) => {
    setHomeFile(file);
    setHomeBatchFiles([]);
    setHomeBatchFileObjects([]);
    setHomeBatchFileCount(0);
  };

  const handleHomeReset = () => {
    setHomeFile(null);
    setHomeBatchFiles([]);
    setHomeBatchFileObjects([]);
    setHomeBatchFileCount(0);
    setHomePrompt("");
    setHomeError(null);
  };

  // Start extraction and register as a background-capable AppSession
  const handleExtract = async () => {
    if (!homeFile) return;
    setHomeError(null);

    const isBatch = homeBatchFileObjects.length > 1;
    const isPdf = homeFile.type === "application/pdf" || homeFile.name.toLowerCase().endsWith(".pdf");

    const recordId = Date.now().toString();
    const sessionId = isBatch ? `batch_${recordId}` : (isPdf ? `pdf_${recordId}` : `session_${recordId}`);
    const abortController = new AbortController();

    const title = isBatch
      ? `Пакет (${homeBatchFileObjects.length} файлов)`
      : homeFile.name;

    const chosenPrompt = homePrompt.trim() || (isBatch ? "Extract store name, date, total, and items." : (isPdf ? "Extract all key entities, structured tables, and important data points from this document." : ""));
    const chosenFormat = homeFormat;

    // Snapshot current upload files before resetting home staging state
    const curFile = homeFile;
    const curBatchFiles = [...homeBatchFiles];
    const curBatchObjects = [...homeBatchFileObjects];

    // Create and register session
    const newSession: AppSession = {
      id: recordId,
      title,
      type: isBatch ? 'batch' : (isPdf ? 'pdf_streaming' : 'single'),
      file: curFile,
      prompt: chosenPrompt,
      format: chosenFormat,
      extractedData: null,
      verificationState: {},
      streamingProgress: null,
      isBatchMode: isBatch,
      batchFiles: curBatchFiles,
      batchFileObjects: curBatchObjects,
      batchRows: [],
      batchSchema: null,
      batchCompletedCount: 0,
      batchTotalCount: isBatch ? curBatchObjects.length : 0,
      isProcessingBatch: isBatch,
      isExtracting: true,
      abortController,
      createdAt: Date.now(),
      error: null,
    };

    addSession(newSession);

    // Reset home staging so user can navigate Home anytime and upload another document!
    setHomeFile(null);
    setHomeBatchFiles([]);
    setHomeBatchFileObjects([]);
    setHomeBatchFileCount(0);
    setHomePrompt("");

    // Run async extraction in background
    if (isBatch) {
      try {
        const schemaRes = await fetch("/api/schema", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: chosenPrompt,
            format: "table",
          }),
          signal: abortController.signal,
        });

        if (!schemaRes.ok) {
          throw new Error("Failed to generate shared schema for batch.");
        }

        const { schema: masterSchema } = await schemaRes.json();

        const initialRows: DocRow[] = curBatchObjects.map(f => ({
          fileId: generateFileId(f),
          fileName: f.name,
          file: f,
          data: {},
          status: "queued",
          reviews: {},
        }));

        const initialRecord: HistoryRecord = {
          id: recordId,
          sessionId,
          file: curBatchObjects[0],
          prompt: chosenPrompt,
          format: "table",
          extractedData: { batch: true, schema: masterSchema },
          timestamp: Date.now(),
          batchInfo: {
            totalFiles: curBatchObjects.length,
            fileNames: curBatchObjects.map(f => f.name),
            fileSizes: curBatchObjects.map(f => f.size),
          },
          batchSchema: masterSchema,
          batchRows: initialRows.map(r => ({ ...r, file: undefined })),
          batchFiles: curBatchObjects,
        };

        saveHistory(initialRecord).then(() => {
          setHistory(prev => [initialRecord, ...prev.filter(h => h.id !== recordId)]);
        }).catch(console.error);

        updateSession(recordId, {
          batchSchema: masterSchema,
          batchRows: initialRows,
          extractedData: { batch: true, schema: masterSchema },
          isExtracting: false,
        });

        await runReceiptBatch(curBatchObjects, masterSchema, {
          prompt: chosenPrompt || undefined,
          format: "table",
          sessionId,
          concurrency: 4,
          rpm: 12,
          maxAutoRetryPasses: 6,
          onStatusMessage: (msg) => {
            updateSession(recordId, { statusMessage: msg });
          },
          onRow: (row) => {
            updateSession(recordId, prev => {
              const prevRows = prev.batchRows || [];
              const idx = prevRows.findIndex(r => r.fileName === row.fileName || r.fileId === row.fileId);
              let updated: DocRow[];
              if (idx !== -1) {
                updated = [...prevRows];
                updated[idx] = row;
              } else {
                updated = [...prevRows, row];
              }
              return { batchRows: updated };
            });
          },
          onProgress: (done, total) => {
            updateSession(recordId, {
              batchCompletedCount: done,
              batchTotalCount: total,
            });
          },
          signal: abortController.signal,
        });

        updateSession(recordId, { isProcessingBatch: false, statusMessage: undefined });
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) return;
        console.error("Batch extraction error:", err);
        updateSession(recordId, {
          isExtracting: false,
          isProcessingBatch: false,
          error: err.message || "Batch extraction failed",
        });
      }
      return;
    }

    if (isPdf) {
      const initialRecord: HistoryRecord = {
        id: recordId,
        sessionId,
        file: curFile,
        prompt: chosenPrompt,
        format: chosenFormat,
        extractedData: { items: [] },
        verificationState: {},
        timestamp: Date.now(),
      };

      saveHistory(initialRecord).then(() => {
        setHistory(prev => [initialRecord, ...prev.filter(h => h.id !== recordId)]);
      }).catch(console.error);

      try {
        let firstChunkReady = false;
        let finalAggregated: any = null;

        await runStreamingPipeline({
          file: curFile,
          prompt: chosenPrompt || undefined,
          format: chosenFormat,
          chunkSize: 10,
          onChunkSuccess: (_chunkData, _remappedData, aggregatedData) => {
            finalAggregated = aggregatedData;
            updateSession(recordId, {
              extractedData: { ...aggregatedData },
              isExtracting: false,
            });
            if (!firstChunkReady) {
              firstChunkReady = true;
            }
            updateHistory(recordId, { extractedData: aggregatedData }).catch(console.error);
          },
          onProgress: (prog) => {
            updateSession(recordId, { streamingProgress: prog });
          },
          signal: abortController.signal,
        });

        if (finalAggregated) {
          await updateHistory(recordId, { extractedData: finalAggregated }).catch(console.error);
        }
        updateSession(recordId, { isExtracting: false });
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) return;
        console.error("PDF streaming error:", err);
        updateSession(recordId, {
          isExtracting: false,
          error: err.message || "Extraction failed",
        });
      }
      return;
    }

    // Single image extraction
    try {
      const formData = new FormData();
      formData.append("file", curFile);
      if (chosenPrompt) {
        formData.append("prompt", chosenPrompt);
      }
      formData.append("format", chosenFormat);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned error (${response.status})`);
      }

      const data = await response.json();
      const extracted = data.data || data;

      const record: HistoryRecord = {
        id: recordId,
        sessionId,
        file: curFile,
        prompt: chosenPrompt,
        format: chosenFormat,
        extractedData: extracted,
        verificationState: {},
        timestamp: Date.now(),
      };

      saveHistory(record).then(() => {
        setHistory(prev => [record, ...prev.filter(h => h.id !== recordId)]);
      }).catch(console.error);

      updateSession(recordId, {
        extractedData: extracted,
        verificationState: {},
        isExtracting: false,
      });
    } catch (err: any) {
      if (err.name === "AbortError" || abortController.signal.aborted) return;
      console.error("Single extraction error:", err);
      updateSession(recordId, {
        isExtracting: false,
        error: err.message || "An unexpected error occurred",
      });
    }
  };

  // Active session state modifiers
  const handleActiveSessionDataChange = useCallback((newData: any, newVerificationState: VerificationStateMap) => {
    if (!activeSession) return;
    const sessId = activeSession.id;
    updateSession(sessId, {
      extractedData: newData,
      verificationState: newVerificationState,
    });

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateHistory(sessId, {
        extractedData: newData,
        verificationState: newVerificationState,
        timestamp: Date.now(),
      }).catch(console.error);
    }, 500);
  }, [activeSession, updateSession]);

  const handleActiveSessionBatchRowsChange = useCallback((newRows: DocRow[]) => {
    if (!activeSession) return;
    const sessId = activeSession.id;
    const schema = activeSession.batchSchema;
    updateSession(sessId, { batchRows: newRows });

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const safeRows = newRows.map(r => ({ ...r, file: undefined }));
      updateHistory(sessId, {
        batchRows: safeRows,
        batchSchema: schema,
        timestamp: Date.now(),
      }).catch(console.warn);
    }, 600);
  }, [activeSession, updateSession]);

  const handleActiveSessionFileChange = useCallback((newFile: File) => {
    if (!activeSession) return;
    const sessId = activeSession.id;
    updateSession(sessId, { file: newFile });
    updateHistory(sessId, { file: newFile }).catch(console.error);
  }, [activeSession, updateSession]);

  const handleRetryActiveSessionFailedBatch = async () => {
    if (!activeSession || !activeSession.batchRows || !activeSession.batchSchema || activeSession.isProcessingBatch) return;
    const sessId = activeSession.id;
    const abortController = new AbortController();
    updateSession(sessId, { isProcessingBatch: true, abortController });

    try {
      await retryFailedBatchFiles(activeSession.batchRows, activeSession.batchSchema, {
        prompt: activeSession.prompt || undefined,
        format: "table",
        sessionId: sessId,
        concurrency: 4,
        rpm: 12,
        maxAutoRetryPasses: 6,
        onStatusMessage: (msg) => {
          updateSession(sessId, { statusMessage: msg });
        },
        onRow: (row) => {
          updateSession(sessId, prev => {
            const prevRows = prev.batchRows || [];
            const idx = prevRows.findIndex(r => r.fileName === row.fileName || r.fileId === row.fileId);
            let updated: DocRow[];
            if (idx !== -1) {
              updated = [...prevRows];
              updated[idx] = row;
            } else {
              updated = [...prevRows, row];
            }
            return { batchRows: updated };
          });
        },
        onProgress: (done, total) => {
          updateSession(sessId, {
            batchCompletedCount: done,
            batchTotalCount: total,
          });
        },
        signal: abortController.signal,
      });
    } catch (err: any) {
      console.error("Retry failed batch error:", err);
    } finally {
      updateSession(sessId, { isProcessingBatch: false, statusMessage: undefined });
    }
  };

  const handleRefineActiveSession = async (newPrompt: string) => {
    if (!activeSession || !activeSession.file) return;
    const sessId = activeSession.id;
    setIsRefining(true);

    try {
      const combinedPrompt = activeSession.prompt ? `${activeSession.prompt}\n\nДополнительно извлечь/уточнить: ${newPrompt}` : `Извлечь/уточнить: ${newPrompt}`;

      const formData = new FormData();
      formData.append("file", activeSession.file);
      formData.append("prompt", combinedPrompt);
      formData.append("format", activeSession.format);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to extract data");
      }

      const data = await response.json();
      updateSession(sessId, {
        extractedData: data,
        verificationState: {},
        prompt: combinedPrompt,
      });

      updateHistory(sessId, {
        prompt: combinedPrompt,
        extractedData: data,
        verificationState: {},
        timestamp: Date.now(),
      }).catch(console.error);
    } catch (err: any) {
      console.error("Refine error:", err);
      toast.error(err.message || "Ошибка уточнения данных");
    } finally {
      setIsRefining(false);
    }
  };

  // Re-open past session from IndexedDB history
  const handleSelectHistoryRecord = (record: HistoryRecord) => {
    const existing = sessions.find(s => s.id === record.id);
    if (existing) {
      switchToSession(record.id);
      return;
    }

    const isBatch = Boolean(record.batchRows && record.batchRows.length > 0);
    const session: AppSession = {
      id: record.id,
      title: isBatch
        ? `Пакет (${record.batchRows?.length || 0} файлов)`
        : (record.file?.name || "Документ"),
      type: isBatch ? 'batch' : 'single',
      file: record.file || null,
      prompt: record.prompt || "",
      format: record.format || "auto",
      extractedData: record.extractedData,
      verificationState: record.verificationState || {},
      streamingProgress: null,
      isBatchMode: isBatch,
      batchFiles: record.batchInfo?.fileNames?.map((name, i) => ({
        name,
        size: record.batchInfo?.fileSizes?.[i] || 0,
      })) || [],
      batchFileObjects: record.batchFiles || [],
      batchRows: record.batchRows || [],
      batchSchema: record.batchSchema || null,
      batchCompletedCount: record.batchRows?.filter((r: any) => r.status === "done").length || 0,
      batchTotalCount: record.batchRows?.length || 0,
      isProcessingBatch: false,
      isExtracting: false,
      abortController: null,
      createdAt: record.timestamp,
      error: null,
    };

    addSession(session);
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-start p-4 md:p-6 bg-gradient-to-b from-background to-muted/20">
      <div className="w-full max-w-7xl">
        {/* Render Active Document Session */}
        {activeSessionId !== null && activeSession ? (
          <div className="w-full">
            {/* If session failed with error */}
            {activeSession.error && !activeSession.extractedData && (
              <div className="max-w-md mx-auto my-12 p-6 border border-destructive/30 rounded-xl bg-destructive/10 text-center space-y-4">
                <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
                <h3 className="font-bold text-lg text-foreground">Ошибка обработки</h3>
                <p className="text-sm text-destructive">{activeSession.error}</p>
                <div className="flex justify-center gap-3 pt-2">
                  <Button variant="outline" size="sm" onClick={() => switchToSession(null)}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                    На главную
                  </Button>
                </div>
              </div>
            )}

            {/* If session is actively scanning/extracting initial chunk */}
            {activeSession.isExtracting && !activeSession.extractedData && (
              <div className="w-full py-8">
                <DocumentScanner
                  fileName={activeSession.file?.name}
                  promptText={activeSession.prompt}
                />
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => switchToSession(null)}
                    className="gap-2 text-xs text-muted-foreground hover:text-foreground"
                    title="Вернуться к загрузке новых документов"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>На главную (обработка продолжится в фоне)</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Workspace when document data is available */}
            {activeSession.extractedData && (
              <motion.div
                key={activeSession.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="w-full"
              >
                <WorkspaceLayout
                  file={activeSession.file || new File([], "document")}
                  data={activeSession.extractedData}
                  isRefining={isRefining}
                  onRefine={handleRefineActiveSession}
                  onDataChange={handleActiveSessionDataChange}
                  onFileChange={handleActiveSessionFileChange}
                  verificationState={activeSession.verificationState}
                  streamingProgress={activeSession.streamingProgress}
                  batchFiles={activeSession.batchFiles}
                  batchFileObjects={activeSession.batchFileObjects}
                  batchRows={activeSession.batchRows}
                  onBatchRowsChange={handleActiveSessionBatchRowsChange}
                  onRetryFailed={handleRetryActiveSessionFailedBatch}
                  schema={activeSession.batchSchema}
                  isProcessingBatch={activeSession.isProcessingBatch}
                />
              </motion.div>
            )}
          </div>
        ) : (
          /* Home Screen: Upload dropzone and recent history */
          <div className="w-full">
            <div className="text-center space-y-4 mb-8">
              <motion.h1
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
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
                Мгновенное извлечение, верификация и трассировка структурированных данных из чеков, счетов, накладных и многостраничных отчетов.
              </motion.p>
            </div>

            <div className="relative min-h-[400px]">
              <AnimatePresence mode="wait">
                {/* Upload Staging Screen */}
                {homeFile ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3 }}
                  >
                    <UploadSuccess
                      file={homeFile}
                      prompt={homePrompt}
                      onPromptChange={setHomePrompt}
                      format={homeFormat}
                      onFormatChange={setHomeFormat}
                      onProceed={handleExtract}
                      onReset={handleHomeReset}
                      batchCount={homeBatchFileCount}
                      batchFiles={homeBatchFiles}
                    />
                    {homeError && (
                      <p className="text-destructive text-center mt-4">{homeError}</p>
                    )}
                  </motion.div>
                ) : (
                  /* Drag & Drop Zone + History */
                  <motion.div
                    key="upload"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3 }}
                    className="w-full pb-12"
                  >
                    <DragDropZone
                      onFileAccepted={handleFileAccepted}
                      onFilesAccepted={handleBatchFilesAccepted}
                    />

                    <RecentExtractions
                      records={history}
                      onSelectRecord={handleSelectHistoryRecord}
                      onDeleteRecord={(idOrIds) => {
                        const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
                        Promise.all(ids.map(id => deleteHistory(id))).then(() => {
                          setHistory(h => h.filter(x => !ids.includes(x.id)));
                        });
                      }}
                      onClearAll={() => {
                        clearAllHistory().then(() => setHistory([]));
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
