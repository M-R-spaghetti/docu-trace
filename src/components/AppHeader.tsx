"use client";

import React from "react";
import { useSessionContext } from "@/lib/sessionContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { 
    FileText, 
    Layers, 
    X, 
    Loader2, 
    FileSearch, 
    CheckCircle2, 
    Sparkles 
} from "lucide-react";

export function AppHeader() {
    const { 
        sessions, 
        activeSessionId, 
        switchToSession, 
        createSession, 
        closeSession 
    } = useSessionContext();

    const bgRunningCount = sessions.filter(
        s => s.id !== activeSessionId && (s.isExtracting || s.isProcessingBatch)
    ).length;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-xs">
            <div className="w-full flex h-14 items-center justify-between px-3 md:px-6 gap-3">
                {/* Brand / Logo */}
                <div className="flex items-center gap-3 shrink-0">
                    <button
                        onClick={createSession}
                        className="flex items-center gap-2 font-bold text-lg tracking-tight hover:opacity-85 transition-opacity group cursor-pointer focus:outline-none"
                        title="На главную / Загрузить документ"
                    >
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 font-black">
                            DocuTrace AI
                        </span>
                    </button>
                </div>

                {/* Session Tabs Navigation */}
                <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1">
                    {sessions.map((session) => {
                        const isActive = session.id === activeSessionId;
                        const isWorking = session.isExtracting || session.isProcessingBatch;

                        return (
                            <div
                                key={session.id}
                                onClick={() => switchToSession(session.id)}
                                className={`group relative flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-medium cursor-pointer transition-all shrink-0 border select-none ${
                                    isActive
                                        ? "bg-muted/80 text-foreground border-border shadow-xs"
                                        : "bg-background/50 hover:bg-muted/40 text-muted-foreground hover:text-foreground border-transparent hover:border-border/60"
                                }`}
                                title={session.title}
                            >
                                {/* Status Icon */}
                                {isWorking ? (
                                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                                ) : session.type === "batch" ? (
                                    <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
                                ) : (
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                )}

                                {/* Session Title */}
                                <span className="max-w-[130px] md:max-w-[180px] truncate">
                                    {session.title}
                                </span>

                                {/* Batch progress pill if running */}
                                {session.isProcessingBatch && session.batchTotalCount > 0 && (
                                    <span className="font-mono text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-primary/15 text-primary shrink-0">
                                        {session.batchCompletedCount}/{session.batchTotalCount}
                                    </span>
                                )}

                                {/* Close Session Button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeSession(session.id);
                                    }}
                                    className="opacity-40 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive p-0.5 rounded transition-all shrink-0 -mr-1"
                                    title="Закрыть вкладку"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Right controls: Background status + Theme */}
                <div className="flex items-center gap-2.5 shrink-0">
                    {bgRunningCount > 0 && (
                        <div 
                            className="hidden md:flex items-center gap-2 text-xs bg-primary/10 border border-primary/20 text-primary px-2.5 py-1 rounded-full font-medium"
                            title="Документы обрабатываются в фоновом режиме"
                        >
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            <span>{bgRunningCount} {bgRunningCount === 1 ? "в фоне" : "в фоне"}</span>
                        </div>
                    )}
                    <ThemeToggle />
                </div>
            </div>
        </header>
    );
}
