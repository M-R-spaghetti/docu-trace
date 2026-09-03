"use client";

import { useState, useRef } from "react";
import { ActiveHighlight, VerificationStateMap } from "@/lib/types";
import dynamic from "next/dynamic";
import { DataTable } from "./DataTable";
import { PanelRightClose, PanelRightOpen, GripVertical, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { StreamingProgress } from "@/lib/streamingPipeline";

// Dynamically import the DocumentViewer, disabling SSR. 
// This prevents 'DOMMatrix is not defined' errors from react-pdf which relies on browser APIs.
const DocumentViewer = dynamic(
    () => import('./DocumentViewer').then((mod) => mod.DocumentViewer),
    { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center bg-muted/30 border rounded-xl animate-pulse" /> }
);

interface WorkspaceLayoutProps {
    file: File;
    data: any;
    isRefining?: boolean;
    onRefine?: (newPrompt: string) => Promise<void>;
    onDataChange?: (updatedExtracted: any, updatedVerificationState: VerificationStateMap) => void;
    verificationState?: VerificationStateMap;
    streamingProgress?: StreamingProgress | null;
}

export function WorkspaceLayout({
    file,
    data,
    isRefining,
    onRefine,
    onDataChange,
    verificationState,
    streamingProgress
}: WorkspaceLayoutProps) {
    const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isFloating, setIsFloating] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(450); // px

    // Drag resizing logic
    const isDragging = useRef(false);

    const onPointerDown = (e: React.PointerEvent) => {
        isDragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onPointerMove = (e: PointerEvent) => {
            if (!isDragging.current) return;
            const newWidth = document.body.clientWidth - e.clientX - 32;
            if (newWidth > 300 && newWidth < 800) {
                setSidebarWidth(newWidth);
            }
        };

        const onPointerUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    return (
        <div className="w-full h-[calc(100vh-6rem)] max-w-none flex flex-col relative gap-2 bg-background p-2 rounded-xl">
            {streamingProgress && streamingProgress.totalPages > 1 && (
                <div className="w-full bg-primary/10 border border-primary/20 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium shrink-0 mb-1">
                    <div className="flex items-center gap-3">
                        <span className="flex h-2.5 w-2.5 relative">
                            {streamingProgress.processedPages < streamingProgress.totalPages && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${streamingProgress.processedPages >= streamingProgress.totalPages ? 'bg-emerald-500' : 'bg-primary'}`}></span>
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                                {streamingProgress.processedPages >= streamingProgress.totalPages
                                    ? `✓ All ${streamingProgress.totalPages} Pages Extracted`
                                    : `Progressive Streaming: Pages 1–${streamingProgress.processedPages} of ${streamingProgress.totalPages} ready`}
                            </span>
                            {streamingProgress.isQuotaWaiting && (
                                <span className="text-amber-600 bg-amber-500/15 px-2.5 py-0.5 rounded-full font-mono text-[11px] animate-pulse font-medium">
                                    ⏳ Quota cooldown: resuming in {streamingProgress.quotaWaitSeconds}s (you can review ready pages)
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-muted-foreground font-mono">
                            {streamingProgress.percent}%
                        </span>
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden border">
                            <div
                                className="h-full bg-primary transition-all duration-300 rounded-full"
                                style={{ width: `${streamingProgress.percent}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full flex-1 flex relative gap-2 overflow-hidden">
                {/* Main Canvas: Document Viewer */}
                <div
                    className={`h-full flex flex-col transition-all duration-300 relative rounded-xl overflow-hidden shadow-sm border min-w-0 ${!isFloating && isSidebarOpen ? 'flex-1' : 'w-full'
                        }`}
                >
                <div className="absolute top-4 right-4 z-50 flex gap-2">
                    {isSidebarOpen && !isFloating && (
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => setIsFloating(true)}
                            className="shadow-md border"
                            title="Float Data Panel"
                        >
                            <Minimize2 className="w-4 h-4" />
                        </Button>
                    )}
                    {(!isSidebarOpen || isFloating) && (
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => { setIsSidebarOpen(true); setIsFloating(false); }}
                            className="shadow-md border bg-primary/10 text-primary hover:bg-primary/20"
                            title="Show Sidebar"
                        >
                            <PanelRightOpen className="w-5 h-5" />
                        </Button>
                    )}
                </div>

                <DocumentViewer file={file} activeHighlight={activeHighlight} />
            </div>

            {/* Resizer Handle */}
            {isSidebarOpen && !isFloating && (
                <div
                    className="w-3 flex items-center justify-center cursor-col-resize hover:bg-muted transition-colors group z-10 rounded-md"
                    onPointerDown={onPointerDown}
                >
                    <GripVertical className="h-6 w-6 text-muted-foreground opacity-30 group-hover:opacity-100" />
                </div>
            )}

            {/* Right Pane: Extracted Data Sidebar */}
            {isSidebarOpen && (
                <div
                    className={`h-full flex flex-col transition-shadow overflow-hidden ${isFloating
                        ? 'fixed top-24 right-8 bottom-8 shadow-2xl border bg-background/95 backdrop-blur-xl rounded-xl z-50'
                        : 'flex-none'
                        }`}
                    style={{ width: `${sidebarWidth}px` }}
                >
                    <div className="absolute top-3 right-3 z-50 flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1">
                        {isFloating && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsFloating(false)}
                                className="h-8 w-8 hover:bg-muted"
                                title="Dock to Sidebar"
                            >
                                <Maximize2 className="w-4 h-4" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsSidebarOpen(false)}
                            className="h-8 w-8 hover:bg-muted"
                            title="Close Sidebar"
                        >
                            <PanelRightClose className="w-4 h-4 text-foreground/70" />
                        </Button>
                    </div>

                    {/* DataTable component takes the full space */}
                    <div className="w-full flex-1 overflow-hidden">
                        <DataTable
                            extracted={data}
                            setActiveHighlight={setActiveHighlight}
                            onDataChange={onDataChange}
                            initialVerificationState={verificationState}
                            filename={file.name}
                        />
                    </div>

                    {/* Secondary Refinement Chat */}
                    {onRefine && (
                        <div className="w-full flex-none p-3 border-t bg-muted/10 relative z-20">
                            {isRefining ? (
                                <div className="flex items-center justify-center h-10 rounded-md bg-primary/10 text-primary border border-primary/20 animate-pulse text-sm font-medium">
                                    <span className="mr-2">✨</span>
                                    AI is re-analyzing document...
                                </div>
                            ) : (
                                <form
                                    className="flex gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const form = e.target as HTMLFormElement;
                                        const input = form.elements.namedItem('prompt') as HTMLInputElement;
                                        if (input.value.trim()) {
                                            onRefine(input.value.trim());
                                            input.value = '';
                                        }
                                    }}
                                >
                                    <input
                                        name="prompt"
                                        placeholder="Forgot something? Ask AI..."
                                        className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex-1 backdrop-blur-sm shadow-sm"
                                        autoComplete="off"
                                    />
                                    <Button type="submit" size="sm" className="h-10 px-4 shadow-sm">
                                        Send
                                    </Button>
                                </form>
                            )}
                        </div>
                    )}
                </div>
            )}
            </div>
        </div>
    );
}
