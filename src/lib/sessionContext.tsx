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

    const activeSessionIdRef = useRef<string | null>(activeSessionId);
    useEffect(() => {
        activeSessionIdRef.current = activeSessionId;
    }, [activeSessionId]);

    // Keep track of which sessions have already notified for their completion
    const notifiedSessionsRef = useRef<Set<string>>(new Set());
    // Keep track of previous running status of each session
    const prevSessionStatusRef = useRef<Map<string, { isExtracting: boolean; isProcessingBatch: boolean }>>(new Map());

    const activeSession = sessions.find(s => s.id === activeSessionId) || null;

    const switchToSession = useCallback((id: string | null) => {
        activeSessionIdRef.current = id;
        setActiveSessionId(id);
    }, []);

    const createSession = useCallback(() => {
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
    }, []);

    const closeSession = useCallback((id: string) => {
        notifiedSessionsRef.current.delete(id);
        prevSessionStatusRef.current.delete(id);
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
            activeSessionIdRef.current = null;
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
        activeSessionIdRef.current = newSession.id;
        setActiveSessionId(newSession.id);
    }, []);

    const updateSession = useCallback((id: string, update: Partial<AppSession> | ((prev: AppSession) => Partial<AppSession>)) => {
        setSessions(prev =>
            prev.map(s => {
                if (s.id !== id) return s;
                const resolved = typeof update === 'function' ? update(s) : update;
                return { ...s, ...resolved };
            })
        );
    }, []);

    // Effect to monitor session completions and notify once if user is in background
    useEffect(() => {
        const currentIds = new Set(sessions.map(s => s.id));
        for (const id of prevSessionStatusRef.current.keys()) {
            if (!currentIds.has(id)) {
                prevSessionStatusRef.current.delete(id);
                notifiedSessionsRef.current.delete(id);
            }
        }

        sessions.forEach(session => {
            const prev = prevSessionStatusRef.current.get(session.id);
            const wasRunning = prev ? (prev.isExtracting || prev.isProcessingBatch) : false;
            const isNowRunning = session.isExtracting || session.isProcessingBatch;
            const isNowFullyDone = !session.isExtracting && !session.isProcessingBatch;
            const hasResults = Boolean(session.extractedData || (session.batchRows && session.batchRows.length > 0));

            if (wasRunning && isNowFullyDone && hasResults && !session.error) {
                if (!notifiedSessionsRef.current.has(session.id)) {
                    notifiedSessionsRef.current.add(session.id);

                    // Only notify if user is NOT currently looking at this session
                    if (activeSessionIdRef.current !== session.id) {
                        toast.success(`Документ "${session.title}" успешно обработан!`, {
                            id: `session-completed-${session.id}`,
                            description: "Нажмите, чтобы открыть результаты",
                            action: {
                                label: "Открыть",
                                onClick: () => {
                                    activeSessionIdRef.current = session.id;
                                    setActiveSessionId(session.id);
                                },
                            },
                            duration: 8000,
                        });
                    }
                }
            } else if (isNowRunning) {
                // If a session restarts (e.g. batch retry), reset notification flag
                notifiedSessionsRef.current.delete(session.id);
            }

            prevSessionStatusRef.current.set(session.id, {
                isExtracting: session.isExtracting,
                isProcessingBatch: session.isProcessingBatch,
            });
        });
    }, [sessions]);

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
