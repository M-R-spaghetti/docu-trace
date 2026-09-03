"use client";

import { Badge } from "@/components/ui/badge";
import { Check, CheckCircle2, Pencil, X, Play, Keyboard, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV, exportToExcel, exportToJSON } from "@/lib/export";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, BoundingBox, LocatedValue, VerificationStatus, VerificationStateMap } from "@/lib/types";

interface DataTableProps {
    extracted: any;
    setActiveHighlight: (highlight: ActiveHighlight | null) => void;
    onDataChange?: (updatedExtracted: any, updatedVerificationState: VerificationStateMap) => void;
    initialVerificationState?: VerificationStateMap;
    filename?: string;
}

function formatLabel(key: string) {
    return key
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase());
}

// Helper: check if a value is a LocatedValue (has value + box_2d)
function isLocatedValue(v: any): v is LocatedValue<any> {
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
        rawValue: String(v.value ?? ''),
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

function mutateExtractedData(
    currentExtracted: any,
    target: { type: 'field'; key: string } | { type: 'cell'; arrayKey: string; rowIndex: number; colKey: string },
    newVal: string
): any {
    if (!currentExtracted || !currentExtracted.data) return currentExtracted;

    const currentData = { ...currentExtracted.data };

    if (target.type === 'field') {
        const raw = currentData[target.key];
        if (isLocatedValue(raw)) {
            currentData[target.key] = {
                ...raw,
                originalValue: raw.originalValue ?? raw.value,
                value: newVal
            };
        } else {
            currentData[target.key] = newVal;
        }
    } else if (target.type === 'cell') {
        const arr = [...(currentData[target.arrayKey] || [])];
        const row = { ...(arr[target.rowIndex] || {}) };
        const rawCell = row[target.colKey];
        if (isLocatedValue(rawCell)) {
            row[target.colKey] = {
                ...rawCell,
                originalValue: rawCell.originalValue ?? rawCell.value,
                value: newVal
            };
        } else {
            row[target.colKey] = newVal;
        }
        arr[target.rowIndex] = row;
        currentData[target.arrayKey] = arr;
    }

    return {
        ...currentExtracted,
        data: currentData
    };
}

export function DataTable({
    extracted,
    setActiveHighlight,
    onDataChange,
    initialVerificationState,
    filename
}: DataTableProps) {
    const data = useMemo(() => {
        if (!extracted) return {};
        if (extracted.data !== undefined && typeof extracted.data === 'object' && extracted.data !== null) {
            return extracted.data;
        }
        return extracted;
    }, [extracted]);
    const schema = useMemo(() => {
        return extracted?.schema || {};
    }, [extracted]);

    const verificationItemsRef = useRef<VerificationItem[]>([]);
    const initialVerificationStateRef = useRef(initialVerificationState);

    useEffect(() => {
        if (initialVerificationState && Object.keys(initialVerificationState).length > 0) {
            initialVerificationStateRef.current = initialVerificationState;
        }
    }, [initialVerificationState]);

    // Build flat verification items list from new format, preserving existing/saved statuses
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

            const id = `field_${k}`;
            const existingItem = verificationItemsRef.current.find(i => i.id === id);
            const savedState = initialVerificationStateRef.current?.[id];

            const status: VerificationStatus = existingItem?.status
                || savedState?.status
                || (raw.originalValue !== undefined ? 'edited' : 'pending');

            const editedVal = existingItem?.editedValue
                || savedState?.editedValue
                || (raw.originalValue !== undefined ? displayVal : undefined);

            items.push({
                id,
                type: 'field',
                label: formatLabel(k),
                value: displayVal,
                highlight: getHighlight(raw, formatLabel(k)),
                status,
                editedValue: editedVal,
            });
        });

        // Array fields
        allKeys.filter(k => Array.isArray(data[k])).forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            arr.forEach((item, idx) => {
                if (!item || typeof item !== 'object') return;
                const colKeys = Object.keys(item);
                const displayValue = colKeys.map(ck => getDisplayValue(item[ck])).join(' | ');

                const id = `row_${arrayKey}_${idx}`;
                const existingItem = verificationItemsRef.current.find(i => i.id === id);
                const savedState = initialVerificationStateRef.current?.[id];

                // Get first available highlight for the row
                const firstHighlight = colKeys
                    .map(ck => getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`))
                    .find(Boolean) || null;

                const columns = colKeys.map(ck => ({
                    key: ck,
                    value: getDisplayValue(item[ck]),
                    highlight: getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`),
                }));

                const hasAnyColumnEdited = colKeys.some(ck => item[ck]?.originalValue !== undefined);

                const status: VerificationStatus = existingItem?.status
                    || savedState?.status
                    || (hasAnyColumnEdited ? 'edited' : 'pending');

                items.push({
                    id,
                    type: 'row',
                    label: `${formatLabel(arrayKey)} #${idx + 1}`,
                    value: displayValue,
                    highlight: firstHighlight,
                    status,
                    editedValue: existingItem?.editedValue || savedState?.editedValue,
                    rowIndex: idx,
                    arrayKey,
                    columns,
                });
            });
        });

        return items;
    }, [data]);

    const [verificationItems, setVerificationItems] = useState<VerificationItem[]>(() => {
        const initial = buildVerificationItems();
        verificationItemsRef.current = initial;
        return initial;
    });

    const [isReviewMode, setIsReviewMode] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editColumnKey, setEditColumnKey] = useState<string | null>(null);
    const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'json'>('csv');
    const scrollRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keep ref updated
    useEffect(() => {
        verificationItemsRef.current = verificationItems;
    }, [verificationItems]);

    // Rebuild when data or initialVerificationState changes
    useEffect(() => {
        const updated = buildVerificationItems();
        setVerificationItems(updated);
        verificationItemsRef.current = updated;
    }, [buildVerificationItems]);

    const syncChanges = useCallback((newExtracted: any, currentItems: VerificationItem[]) => {
        if (!onDataChange) return;
        const vMap: VerificationStateMap = {};
        currentItems.forEach(item => {
            vMap[item.id] = {
                status: item.status,
                editedValue: item.editedValue,
                columns: item.columns ? Object.fromEntries(item.columns.map(c => [c.key, c.value])) : undefined
            };
        });
        onDataChange(newExtracted, vMap);
    }, [onDataChange]);

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
        setVerificationItems(prev => {
            const updated = prev.map(item =>
                item.id === id ? { ...item, status: 'verified' as VerificationStatus } : item
            );
            verificationItemsRef.current = updated;
            syncChanges(extracted, updated);
            return updated;
        });
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

        let updatedExtracted = extracted;

        if (editColumnKey) {
            const item = verificationItems.find(i => i.id === editingId);
            if (item && item.arrayKey !== undefined && item.rowIndex !== undefined) {
                updatedExtracted = mutateExtractedData(
                    extracted,
                    {
                        type: 'cell',
                        arrayKey: item.arrayKey,
                        rowIndex: item.rowIndex,
                        colKey: editColumnKey
                    },
                    editValue
                );
            }
        } else {
            const key = editingId.replace(/^field_/, '');
            updatedExtracted = mutateExtractedData(
                extracted,
                { type: 'field', key },
                editValue
            );
        }

        setVerificationItems(prev => {
            const updated = prev.map(item => {
                if (item.id !== editingId) return item;
                if (editColumnKey && item.columns) {
                    const updatedColumns = item.columns.map(col =>
                        col.key === editColumnKey ? { ...col, value: editValue } : col
                    );
                    const newDisplayValue = updatedColumns.map(c => c.value).join(' | ');
                    return {
                        ...item,
                        status: 'edited' as VerificationStatus,
                        columns: updatedColumns,
                        value: newDisplayValue,
                        editedValue: newDisplayValue
                    };
                }
                return {
                    ...item,
                    status: 'edited' as VerificationStatus,
                    editedValue: editValue,
                    value: editValue
                };
            });

            verificationItemsRef.current = updated;
            syncChanges(updatedExtracted, updated);
            return updated;
        });

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
            <div className="p-3 border-t bg-muted/10 flex-none space-y-2">
                {/* Export Format Selector */}
                <div className="flex items-center justify-between gap-2 px-0.5">
                    <span className="text-xs text-muted-foreground font-medium">Export format:</span>
                    <div className="flex bg-muted/60 p-0.5 rounded-lg text-xs">
                        <button
                            type="button"
                            className={`px-2 py-0.5 rounded-md transition-all font-medium flex items-center gap-1 text-xs ${
                                exportFormat === 'csv'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setExportFormat('csv')}
                            title="CSV for Excel / 1C with UTF-8 BOM & semicolon delimiter"
                        >
                            <span className="text-[11px]">📊</span> CSV (Excel)
                        </button>
                        <button
                            type="button"
                            className={`px-2 py-0.5 rounded-md transition-all font-medium flex items-center gap-1 text-xs ${
                                exportFormat === 'excel'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setExportFormat('excel')}
                            title="Excel Spreadsheet (.xls) with styled headers"
                        >
                            <span className="text-[11px]">📗</span> Excel (.xls)
                        </button>
                        <button
                            type="button"
                            className={`px-2 py-0.5 rounded-md transition-all font-medium flex items-center gap-1 text-xs ${
                                exportFormat === 'json'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setExportFormat('json')}
                            title="Clean JSON without internal coordinates"
                        >
                            <span className="text-[11px]">📄</span> JSON
                        </button>
                    </div>
                </div>

                <Button
                    className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-500/20 border-0 h-9 text-xs font-semibold"
                    size="default"
                    onClick={() => {
                        const approvedItems = verificationItems.map(item => ({
                            ...item,
                            status: (item.status === 'pending' ? 'verified' : item.status) as VerificationStatus
                        }));
                        setVerificationItems(approvedItems);
                        verificationItemsRef.current = approvedItems;
                        syncChanges(extracted, approvedItems);

                        const baseName = filename
                            ? filename.replace(/\.[^/.]+$/, "")
                            : `docutrace-export-${new Date().getTime()}`;

                        if (exportFormat === 'csv') {
                            const targetFile = `${baseName}-verified.csv`;
                            exportToCSV(data, targetFile);
                            toast.success("CSV Export successful", {
                                description: `Downloaded ${targetFile} (UTF-8 BOM, semicolon delimited for Excel).`
                            });
                        } else if (exportFormat === 'excel') {
                            const targetFile = `${baseName}-verified.xls`;
                            exportToExcel(data, targetFile);
                            toast.success("Excel Export successful", {
                                description: `Downloaded ${targetFile} with styled headers.`
                            });
                        } else if (exportFormat === 'json') {
                            const targetFile = `${baseName}-verified.json`;
                            exportToJSON(data, targetFile);
                            toast.success("JSON Export successful", {
                                description: `Downloaded clean JSON to ${targetFile}.`
                            });
                        }
                    }}
                >
                    <CheckCircle2 className="w-4 h-4" />
                    {stats.percent === 100
                        ? `All Verified — Export ${exportFormat.toUpperCase()}`
                        : `Approve All & Export (${stats.percent}% done)`}
                </Button>
            </div>
        </div>
    );
}
