"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { VerificationStateMap } from "./types";
import { DocRow } from "./batchTypes";
import { StreamingProgress } from "./streamingPipeline";
import { toast } from "sonner";

export interface AppSession {
    id: string; // recordId
    title: string;
    type: 'single' | 'pdf_streaming' | 'batch';
    file: File | null;
    prompt: string;
    format: string;
    // Single / PDF state
    extractedData: any | null;
    verificationState: VerificationStateMap;
    streamingProgress: StreamingProgress | null;
    // Batch state
    isBatchMode: boolean;
    batchFiles: { name: string; size: number }[];
    batchFileObjects: File[];
    batchRows: DocRow[];
    batchSchema: any | null;
    batchCompletedCount: number;
    batchTotalCount: number;
    isProcessingBatch: boolean;
    // Status
    isExtracting: boolean;
    statusMessage?: string;
    abortController: AbortController | null;
    createdAt: number;
    error: string | null;
}

interface SessionContextType {
    sessions: AppSession[];
    activeSessionId: string | null;
    activeSession: AppSession | null;
    switchToSession: (id: string | null) => void;
    createSession: () => void;
    closeSession: (id: string) => void;
    addSession: (session: AppSession) => void;
    updateSession: (id: string, update: Partial<AppSession> | ((prev: AppSession) => Partial<AppSession>)) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [sessions, setSessions] = useState<AppSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    const activeSession = sessions.find(s => s.id === activeSessionId) || null;

    const switchToSession = useCallback((id: string | null) => {
        setActiveSessionId(id);
    }, []);

    const createSession = useCallback(() => {
        setActiveSessionId(null);
    }, []);

    const closeSession = useCallback((id: string) => {
        setSessions(prev => {
            const target = prev.find(s => s.id === id);
            if (target?.abortController) {
                try { target.abortController.abort("Session closed"); } catch {}
            }
            const filtered = prev.filter(s => s.id !== id);
            return filtered;
        });

        setActiveSessionId(curr => {
            if (curr !== id) return curr;
            return null;
        });
    }, []);

    const addSession = useCallback((newSession: AppSession) => {
        setSessions(prev => {
            const exists = prev.some(s => s.id === newSession.id);
            if (exists) {
                return prev.map(s => s.id === newSession.id ? { ...s, ...newSession } : s);
            }
            return [newSession, ...prev];
        });
        setActiveSessionId(newSession.id);
    }, []);

    const updateSession = useCallback((id: string, update: Partial<AppSession> | ((prev: AppSession) => Partial<AppSession>)) => {
        setSessions(prev =>
            prev.map(s => {
                if (s.id !== id) return s;

                const resolved = typeof update === 'function' ? update(s) : update;
                const next = { ...s, ...resolved };

                // Check if session just finished extracting or processing batch in background
                const wasRunning = s.isExtracting || s.isProcessingBatch;
                const isNowDone = (s.isExtracting && next.isExtracting === false) || (s.isProcessingBatch && next.isProcessingBatch === false);

                if (wasRunning && isNowDone && (next.extractedData || (next.batchRows && next.batchRows.length > 0))) {
                    // Send notification if user is not currently viewing this session
                    if (activeSessionId !== id) {
                        toast.success(`Документ "${s.title}" успешно обработан!`, {
                            description: "Нажмите, чтобы открыть результаты",
                            action: {
                                label: "Открыть",
                                onClick: () => setActiveSessionId(id),
                            },
                            duration: 8000,
                        });
                    }
                }

                return next;
            })
        );
    }, [activeSessionId]);

    return (
        <SessionContext.Provider
            value={{
                sessions,
                activeSessionId,
                activeSession,
                switchToSession,
                createSession,
                closeSession,
                addSession,
                updateSession,
            }}
        >
            {children}
        </SessionContext.Provider>
    );
}

export function useSessionContext() {
    const ctx = useContext(SessionContext);
    if (!ctx) {
        throw new Error("useSessionContext must be used within a SessionProvider");
    }
    return ctx;
}
