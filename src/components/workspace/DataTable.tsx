"use client";

import { Badge } from "@/components/ui/badge";
import { Check, CheckCircle2, Pencil, X, Play, Keyboard, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/export";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, BoundingBox } from "@/lib/types";

interface DataTableProps {
    extracted: any;
    setActiveHighlight: (highlight: ActiveHighlight | null) => void;
}

function formatLabel(key: string) {
    return key
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase());
}

type VerificationStatus = 'pending' | 'verified' | 'edited';

// Helper: check if a value is a LocatedValue (has value + box_2d)
function isLocatedValue(v: any): v is { value: any; box_2d: BoundingBox; page: number } {
    return v && typeof v === 'object' && 'value' in v && 'box_2d' in v && Array.isArray(v.box_2d);
}

// Helper: extract display value from either a LocatedValue or a plain value
function getDisplayValue(v: any): string {
    if (v === null || v === undefined) return '-';
    if (isLocatedValue(v)) return String(v.value);
    return String(v);
}

// Helper: extract highlight info from a LocatedValue
function getHighlight(v: any, label?: string): ActiveHighlight | null {
    if (!isLocatedValue(v)) return null;
    return {
        box_2d: v.box_2d,
        page: v.page || 1,
        label,
    };
}

interface VerificationItem {
    id: string;
    type: 'field' | 'row';
    label: string;
    value: string;
    highlight: ActiveHighlight | null;
    status: VerificationStatus;
    editedValue?: string;
    // For rows
    rowIndex?: number;
    arrayKey?: string;
    columns?: { key: string; value: string; highlight: ActiveHighlight | null }[];
}

export function DataTable({ extracted, setActiveHighlight }: DataTableProps) {
    const data = extracted?.data || {};
    const schema = extracted?.schema || {};

    // Build flat verification items list from new format
    const buildVerificationItems = useCallback((): VerificationItem[] => {
        const items: VerificationItem[] = [];
        const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');

        // Primitive / LocatedValue fields (not arrays)
        allKeys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k])).forEach(k => {
            const raw = data[k];
            if (raw === null || raw === undefined) return;

            // Skip if it's a plain object that isn't a LocatedValue (could be a nested group)
            if (typeof raw === 'object' && !isLocatedValue(raw) && !Array.isArray(raw)) return;

            const displayVal = getDisplayValue(raw);
            if (displayVal === '-') return;

            items.push({
                id: `field_${k}`,
                type: 'field',
                label: formatLabel(k),
                value: displayVal,
                highlight: getHighlight(raw, formatLabel(k)),
                status: 'pending',
            });
        });

        // Array fields
        allKeys.filter(k => Array.isArray(data[k])).forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            arr.forEach((item, idx) => {
                if (!item || typeof item !== 'object') return;
                const colKeys = Object.keys(item);
                const displayValue = colKeys.map(ck => getDisplayValue(item[ck])).join(' | ');

                // Get first available highlight for the row
                const firstHighlight = colKeys
                    .map(ck => getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`))
                    .find(Boolean) || null;

                items.push({
                    id: `row_${arrayKey}_${idx}`,
                    type: 'row',
                    label: `${formatLabel(arrayKey)} #${idx + 1}`,
                    value: displayValue,
                    highlight: firstHighlight,
                    status: 'pending',
                    rowIndex: idx,
                    arrayKey,
                    columns: colKeys.map(ck => ({
                        key: ck,
                        value: getDisplayValue(item[ck]),
                        highlight: getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`),
                    })),
                });
            });
        });

        return items;
    }, [data]);

    const [verificationItems, setVerificationItems] = useState<VerificationItem[]>(() => buildVerificationItems());
    const [isReviewMode, setIsReviewMode] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editColumnKey, setEditColumnKey] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Rebuild when data changes
    useEffect(() => {
        setVerificationItems(buildVerificationItems());
    }, [buildVerificationItems]);

    // Stats
    const stats = useMemo(() => {
        const total = verificationItems.length;
        const verified = verificationItems.filter(i => i.status === 'verified').length;
        const edited = verificationItems.filter(i => i.status === 'edited').length;
        const done = verified + edited;
        return { total, verified, edited, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }, [verificationItems]);

    // Keyboard handler for review mode
    useEffect(() => {
        if (!isReviewMode) return;

        const handler = (e: KeyboardEvent) => {
            if (editingId) return;

            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    approveItem(verificationItems[activeIndex]?.id);
                    const nextPending = verificationItems.findIndex((item, i) => i > activeIndex && item.status === 'pending');
                    if (nextPending !== -1) {
                        setActiveIndex(nextPending);
                    } else {
                        const fromStart = verificationItems.findIndex(item => item.status === 'pending');
                        if (fromStart !== -1 && fromStart !== activeIndex) {
                            setActiveIndex(fromStart);
                        } else {
                            toast.success("✅ All items verified!", { description: "Ready for export." });
                            setIsReviewMode(false);
                        }
                    }
                    break;
                case 'ArrowDown':
                case 'j':
                    e.preventDefault();
                    setActiveIndex(prev => Math.min(prev + 1, verificationItems.length - 1));
                    break;
                case 'ArrowUp':
                case 'k':
                    e.preventDefault();
                    setActiveIndex(prev => Math.max(prev - 1, 0));
                    break;
                case 'e':
                case 'E':
                    e.preventDefault();
                    startEditing(verificationItems[activeIndex]);
                    break;
                case 'Escape':
                    e.preventDefault();
                    setIsReviewMode(false);
                    break;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isReviewMode, activeIndex, verificationItems, editingId]);

    // Auto-scroll to active item and show highlight in document
    useEffect(() => {
        if (!isReviewMode) return;
        const item = verificationItems[activeIndex];
        if (!item) return;

        const el = itemRefs.current.get(item.id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        setActiveHighlight(item.highlight);
    }, [activeIndex, isReviewMode, verificationItems, setActiveHighlight]);

    // Focus edit input
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const approveItem = (id: string | undefined) => {
        if (!id) return;
        setVerificationItems(prev => prev.map(item =>
            item.id === id ? { ...item, status: 'verified' as VerificationStatus } : item
        ));
    };

    const startEditing = (item: VerificationItem | undefined) => {
        if (!item) return;
        setEditingId(item.id);
        setEditValue(item.editedValue || item.value);
        setEditColumnKey(null);
    };

    const startEditingColumn = (item: VerificationItem, colKey: string, value: string) => {
        setEditingId(item.id);
        setEditColumnKey(colKey);
        setEditValue(value);
    };

    const saveEdit = () => {
        if (!editingId) return;
        setVerificationItems(prev => prev.map(item => {
            if (item.id !== editingId) return item;
            if (editColumnKey && item.columns) {
                const updatedColumns = item.columns.map(col =>
                    col.key === editColumnKey ? { ...col, value: editValue } : col
                );
                const newDisplayValue = updatedColumns.map(c => c.value).join(' | ');
                return { ...item, status: 'edited', columns: updatedColumns, value: newDisplayValue, editedValue: newDisplayValue };
            }
            return { ...item, status: 'edited', editedValue: editValue, value: editValue };
        }));
        setEditingId(null);
        setEditColumnKey(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditColumnKey(null);
    };

    const getStatusBadge = (status: VerificationStatus) => {
        switch (status) {
            case 'verified':
                return (
                    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] uppercase font-bold tracking-wider gap-1">
                        <Check className="w-3 h-3" /> Verified
                    </Badge>
                );
            case 'edited':
                return (
                    <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-[10px] uppercase font-bold tracking-wider gap-1">
                        <Pencil className="w-3 h-3" /> Edited
                    </Badge>
                );
            default:
                return (
                    <Badge variant="secondary" className="text-[10px] uppercase font-semibold tracking-wider text-amber-600 bg-amber-500/10 border-amber-500/20">
                        Pending
                    </Badge>
                );
        }
    };

    // Separate data keys for rendering
    const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');
    const primitives = allKeys.filter(k => {
        const v = data[k];
        if (Array.isArray(v) && !isLocatedValue(v)) return false;
        if (typeof v === 'object' && !isLocatedValue(v)) return false;
        return true;
    });
    const arrays = allKeys.filter(k => Array.isArray(data[k]) && !isLocatedValue(data[k]));

    const renderFieldRow = (key: string) => {
        const raw = data[key];
        if (raw === null || raw === undefined) return null;

        const displayVal = getDisplayValue(raw);
        const highlight = getHighlight(raw, formatLabel(key));

        const itemId = `field_${key}`;
        const vItem = verificationItems.find(v => v.id === itemId);
        const isActive = isReviewMode && verificationItems[activeIndex]?.id === itemId;
        const isEditing = editingId === itemId;
        const hasLocation = highlight !== null;

        return (
            <motion.div
                key={key}
                ref={(el) => { if (el) itemRefs.current.set(itemId, el); }}
                layout
                className={`flex items-center justify-between p-3 rounded-lg transition-all duration-200 border-b last:border-0 group cursor-pointer
                    ${isActive ? 'bg-primary/8 ring-2 ring-primary/40 shadow-lg shadow-primary/5' : 'hover:bg-muted/50'}
                    ${vItem?.status === 'verified' ? 'bg-emerald-500/5' : ''}
                    ${vItem?.status === 'edited' ? 'bg-blue-500/5' : ''}
                `}
                onClick={() => {
                    if (highlight) setActiveHighlight(highlight);
                    if (isReviewMode) {
                        const idx = verificationItems.findIndex(v => v.id === itemId);
                        if (idx !== -1) setActiveIndex(idx);
                    }
                }}
                onMouseEnter={() => { if (highlight && !isReviewMode) setActiveHighlight(highlight); }}
                onMouseLeave={() => { if (!isReviewMode) setActiveHighlight(null); }}
            >
                <div className="flex flex-col gap-1.5 w-1/3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm text-muted-foreground font-medium">{formatLabel(key)}</span>
                        {hasLocation && (
                            <MapPin className="w-3 h-3 text-yellow-500 opacity-60" />
                        )}
                    </div>
                    {getStatusBadge(vItem?.status || 'pending')}
                </div>

                <div className="flex items-center justify-between w-2/3 pl-4 border-l gap-2">
                    {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                            <input
                                ref={editInputRef}
                                className="flex h-8 w-full rounded-md border border-primary/40 bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                                    if (e.key === 'Escape') cancelEdit();
                                }}
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:bg-emerald-100" onClick={saveEdit}>
                                <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={cancelEdit}>
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ) : (
                        <>
                            <span className="text-sm font-semibold truncate flex-1" title={String(vItem?.editedValue || displayVal)}>
                                {String(vItem?.editedValue || displayVal)}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                    title="Approve field"
                                    onClick={(e) => { e.stopPropagation(); approveItem(itemId); }}
                                >
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                    title="Edit field"
                                    onClick={(e) => { e.stopPropagation(); startEditing(vItem); }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </motion.div>
        );
    };

    const renderArrayField = (key: string) => {
        const arrayValue = data[key] as any[];
        if (!Array.isArray(arrayValue) || arrayValue.length === 0) return null;

        // Get column keys (each item is an object of LocatedValues or plain values)
        const commonKeys = Array.from(
            new Set(arrayValue.flatMap(obj => Object.keys(obj || {})))
        );

        return (
            <div key={key} className="space-y-1 mb-6">
                <h4 className="text-xs uppercase text-muted-foreground font-bold tracking-wider mb-2 px-2 mt-4">
                    {formatLabel(key)}
                </h4>
                <div className="border rounded-lg bg-card overflow-hidden">
                    <div className="flex gap-2 p-3 bg-muted/30 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="w-8 text-center">#</div>
                        {commonKeys.map((colKey) => (
                            <div key={colKey} className="flex-1 truncate" style={{ minWidth: 0 }}>
                                {formatLabel(colKey)}
                            </div>
                        ))}
                        <div className="w-28 text-right">Status</div>
                    </div>

                    {arrayValue.map((item, idx) => {
                        const itemId = `row_${key}_${idx}`;
                        const vItem = verificationItems.find(v => v.id === itemId);
                        const isActive = isReviewMode && verificationItems[activeIndex]?.id === itemId;
                        const isRowEditing = editingId === itemId;

                        return (
                            <motion.div
                                key={idx}
                                ref={(el) => { if (el) itemRefs.current.set(itemId, el); }}
                                layout
                                className={`flex gap-2 p-3 border-b last:border-0 transition-all duration-200 cursor-pointer group
                                    ${isActive ? 'bg-primary/8 ring-2 ring-primary/40 shadow-lg shadow-primary/5' : 'hover:bg-muted/50'}
                                    ${vItem?.status === 'verified' ? 'bg-emerald-500/5' : ''}
                                    ${vItem?.status === 'edited' ? 'bg-blue-500/5' : ''}
                                `}
                                onClick={() => {
                                    // Show first available highlight for this row
                                    const firstHL = commonKeys
                                        .map(ck => getHighlight(item[ck], `${formatLabel(key)} #${idx + 1} → ${formatLabel(ck)}`))
                                        .find(Boolean);
                                    if (firstHL) setActiveHighlight(firstHL);
                                    if (isReviewMode) {
                                        const vi = verificationItems.findIndex(v => v.id === itemId);
                                        if (vi !== -1) setActiveIndex(vi);
                                    }
                                }}
                                onMouseEnter={() => {
                                    if (!isReviewMode) {
                                        const firstHL = commonKeys
                                            .map(ck => getHighlight(item[ck], `${formatLabel(key)} #${idx + 1} → ${formatLabel(ck)}`))
                                            .find(Boolean);
                                        if (firstHL) setActiveHighlight(firstHL);
                                    }
                                }}
                                onMouseLeave={() => { if (!isReviewMode) setActiveHighlight(null); }}
                            >
                                <div className="w-8 text-center text-xs text-muted-foreground font-mono self-center">
                                    {idx + 1}
                                </div>
                                {commonKeys.map(colKey => {
                                    const raw = item[colKey];
                                    const val = vItem?.columns?.find(c => c.key === colKey)?.value || getDisplayValue(raw);
                                    const cellHighlight = getHighlight(raw, `${formatLabel(key)} #${idx + 1} → ${formatLabel(colKey)}`);
                                    const isThisCellEditing = isRowEditing && editColumnKey === colKey;

                                    return (
                                        <div
                                            key={colKey}
                                            className={`flex-1 text-sm truncate self-center flex items-center gap-1 ${cellHighlight ? 'cursor-crosshair' : ''}`}
                                            style={{ minWidth: 0 }}
                                            title={val}
                                            onClick={(e) => {
                                                // Cell-level click → highlight that specific cell's location
                                                if (cellHighlight) {
                                                    e.stopPropagation();
                                                    setActiveHighlight(cellHighlight);
                                                }
                                            }}
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                if (vItem) startEditingColumn(vItem, colKey, val);
                                            }}
                                        >
                                            {isThisCellEditing ? (
                                                <input
                                                    ref={editInputRef}
                                                    className="h-7 w-full rounded border border-primary/40 bg-background px-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                                                        if (e.key === 'Escape') cancelEdit();
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <>
                                                    <span className="truncate">{val}</span>
                                                    {cellHighlight && (
                                                        <MapPin className="w-3 h-3 text-yellow-500 opacity-40 flex-shrink-0" />
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="w-28 flex items-center justify-end gap-1">
                                    {getStatusBadge(vItem?.status || 'pending')}
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                                        <Button
                                            size="icon" variant="ghost"
                                            className="h-6 w-6 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                            title="Approve row"
                                            onClick={(e) => { e.stopPropagation(); approveItem(itemId); }}
                                        >
                                            <Check className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderMarkdown = (text: string) => {
        if (!text) return null;
        return (
            <div className="col-span-12 p-4 bg-muted/10 rounded-xl border border-muted-foreground/20 space-y-4">
                {text.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                        {paragraph}
                    </p>
                ))}
            </div>
        );
    };

    return (
        <div ref={containerRef} className="flex flex-col h-full bg-background border rounded-xl overflow-hidden shadow-sm">
            {/* Header with progress */}
            <div className="p-4 border-b bg-muted/20 space-y-3 flex-none">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        Extracted Data
                    </h3>
                    <div className="flex items-center gap-2">
                        {stats.total > 0 && (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-mono tabular-nums">
                                {stats.done}/{stats.total}
                            </Badge>
                        )}
                        <Button
                            size="sm"
                            variant={isReviewMode ? "default" : "outline"}
                            className={`gap-1.5 h-8 text-xs font-semibold transition-all ${isReviewMode
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white border-0 shadow-lg shadow-emerald-500/25'
                                : 'hover:border-primary/50 hover:text-primary'
                                }`}
                            onClick={() => {
                                setIsReviewMode(!isReviewMode);
                                if (!isReviewMode) {
                                    const firstPending = verificationItems.findIndex(item => item.status === 'pending');
                                    setActiveIndex(firstPending !== -1 ? firstPending : 0);
                                } else {
                                    setActiveHighlight(null);
                                }
                            }}
                        >
                            {isReviewMode ? (
                                <><Keyboard className="w-3.5 h-3.5" /> Review Active</>
                            ) : (
                                <><Play className="w-3.5 h-3.5" /> Start Review</>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Progress bar */}
                {stats.total > 0 && (
                    <div className="space-y-1.5">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${stats.percent}%` }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                                style={{ boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)' }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                            <span>{stats.percent}% verified</span>
                            {isReviewMode && (
                                <span className="text-primary animate-pulse">
                                    Enter ↵ approve • ↑↓ navigate • E edit • Esc exit
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
                <div className="p-4 space-y-6">
                    {data.markdown_text && (
                        <div className="space-y-1 mb-6">
                            <h4 className="text-xs uppercase text-muted-foreground font-bold tracking-wider mb-2 px-2">
                                Report Summary
                            </h4>
                            {renderMarkdown(data.markdown_text)}
                        </div>
                    )}

                    {primitives.length > 0 && (
                        <div className="space-y-1">
                            <h4 className="text-xs uppercase text-muted-foreground font-bold tracking-wider mb-2 px-2">
                                Header Information
                            </h4>
                            <div className="border rounded-lg bg-card">
                                {primitives.map(k => renderFieldRow(k))}
                            </div>
                        </div>
                    )}

                    {arrays.map(k => renderArrayField(k))}
                </div>
            </div>

            {/* Sticky bottom actions */}
            <div className="p-4 border-t bg-muted/10 flex-none">
                <Button
                    className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/20 border-0"
                    size="lg"
                    onClick={() => {
                        exportToCSV(data, `docutrace-export-${new Date().getTime()}.csv`);
                        toast.success("Export successful", {
                            description: "Your structured CSV file has been downloaded."
                        });
                    }}
                >
                    <CheckCircle2 className="w-4 h-4" />
                    {stats.percent === 100 ? 'All Verified — Export Now' : `Approve All & Export (${stats.percent}% done)`}
                </Button>
            </div>
        </div>
    );
}
