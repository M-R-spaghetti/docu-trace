"use client";

import { Badge } from "@/components/ui/badge";
import { Check, CheckCheck, Pencil, X, Play, Keyboard, Download, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV, exportToExcel, exportToJSON } from "@/lib/export";
import { parseDocDate } from "@/lib/parseDocDate";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveHighlight, LocatedValue, VerificationStatus, VerificationStateMap } from "@/lib/types";

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

function getColType(colKey: string): "date" | "money" | "qty" | "source" | "text" {
    const k = colKey.toLowerCase();
    if (/source|file/i.test(k)) return "source";
    if (/date/i.test(k)) return "date";
    if (/price|total|amount|sum|cost|tax|rate|fee/i.test(k)) return "money";
    if (/quantity|qty|count/i.test(k)) return "qty";
    return "text";
}

function getColWidth(colKey: string): number {
    const type = getColType(colKey);
    switch (type) {
        case "source": return 92;
        case "date": return 110;
        case "money": return 96;
        case "qty": return 56;
        default: return 160;
    }
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
function getHighlight(v: any, label?: string, fileName?: string, columnKey?: string): ActiveHighlight | null {
    if (!isLocatedValue(v)) return null;
    return {
        box_2d: v.box_2d,
        page: v.page || 1,
        label,
        rawValue: String(v.value ?? ''),
        fileName,
        columnKey,
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
    fileName?: string;
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
        let raw = extracted.data !== undefined && extracted.data !== null ? extracted.data : extracted;
        if (Array.isArray(raw)) {
            return { items: raw };
        }
        if (typeof raw === 'object' && raw !== null) {
            const keys = Object.keys(raw);
            if (keys.length > 0 && keys.every(k => !isNaN(Number(k)))) {
                return { items: Object.values(raw) };
            }
            return raw;
        }
        return {};
    }, [extracted]);

    const verificationItemsRef = useRef<VerificationItem[]>([]);
    const initialVerificationStateRef = useRef(initialVerificationState);

    useEffect(() => {
        if (initialVerificationState && Object.keys(initialVerificationState).length > 0) {
            initialVerificationStateRef.current = initialVerificationState;
        }
    }, [initialVerificationState]);

    // Build flat verification items list
    const buildVerificationItems = useCallback((): VerificationItem[] => {
        const items: VerificationItem[] = [];
        const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');

        // Primitive / LocatedValue fields (not arrays)
        allKeys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k])).forEach(k => {
            const raw = data[k];
            if (raw === null || raw === undefined) return;

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
                highlight: getHighlight(raw, formatLabel(k), filename, k),
                status,
                editedValue: editedVal,
                fileName: filename,
            });
        });

        // Array fields
        allKeys.filter(k => Array.isArray(data[k])).forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            arr.forEach((item, idx) => {
                if (!item || typeof item !== 'object') return;
                const colKeys = Object.keys(item);
                const itemSource = item.source || item.Source || item.file || item.fileName || item.filename || filename;
                const displayValue = colKeys.map(ck => getDisplayValue(item[ck])).join(' | ');

                const id = `row_${arrayKey}_${idx}`;
                const existingItem = verificationItemsRef.current.find(i => i.id === id);
                const savedState = initialVerificationStateRef.current?.[id];

                // Get first available highlight for the row
                const firstHighlight = colKeys
                    .map(ck => getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`, itemSource, ck))
                    .find(Boolean) || null;

                const columns = colKeys.map(ck => ({
                    key: ck,
                    value: getDisplayValue(item[ck]),
                    highlight: getHighlight(item[ck], `${formatLabel(arrayKey)} #${idx + 1} → ${formatLabel(ck)}`, itemSource, ck),
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
                    fileName: itemSource,
                    rowIndex: idx,
                    arrayKey,
                    columns,
                });
            });
        });

        return items;
    }, [data, filename]);

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
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
    const editInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keep ref updated
    useEffect(() => {
        verificationItemsRef.current = verificationItems;
    }, [verificationItems]);

    // Rebuild when data changes
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

    const activeItem = verificationItems[activeIndex];

    // Approve an item and advance to next pending
    const approveItem = useCallback((id: string | undefined) => {
        if (!id) return;
        const current = verificationItemsRef.current;
        const updated = current.map(item =>
            item.id === id ? { ...item, status: 'verified' as VerificationStatus } : item
        );
        verificationItemsRef.current = updated;
        setVerificationItems(updated);
        syncChanges(extracted, updated);
    }, [extracted, syncChanges]);

    const approveAndNext = useCallback((id: string | undefined) => {
        approveItem(id);
        const nextPending = verificationItems.findIndex((item, i) => i > activeIndex && item.status === 'pending');
        if (nextPending !== -1) {
            setActiveIndex(nextPending);
        } else {
            const fromStart = verificationItems.findIndex(item => item.status === 'pending');
            if (fromStart !== -1 && fromStart !== activeIndex) {
                setActiveIndex(fromStart);
            } else {
                toast.success("✅ Все позиции проверены!", { description: "Данные готовы к экспорту." });
                setIsReviewMode(false);
            }
        }
    }, [approveItem, activeIndex, verificationItems]);

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

        const current = verificationItemsRef.current;
        const updated = current.map(item => {
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
        setVerificationItems(updated);
        syncChanges(updatedExtracted, updated);

        setEditingId(null);
        setEditColumnKey(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditColumnKey(null);
    };

    // Keyboard handler for review mode
    useEffect(() => {
        if (!isReviewMode) return;

        const handler = (e: KeyboardEvent) => {
            if (editingId) return;

            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    approveAndNext(verificationItems[activeIndex]?.id);
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
    }, [isReviewMode, activeIndex, verificationItems, editingId, approveAndNext]);

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

    const getStatusBadge = (status: VerificationStatus) => {
        switch (status) {
            case 'verified':
                return (
                    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] uppercase font-bold tracking-wider gap-1 shrink-0">
                        <Check className="w-3 h-3" /> Проверено
                    </Badge>
                );
            case 'edited':
                return (
                    <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-[10px] uppercase font-bold tracking-wider gap-1 shrink-0">
                        <Pencil className="w-3 h-3" /> Изменено
                    </Badge>
                );
            default:
                return (
                    <Badge variant="secondary" className="text-[10px] uppercase font-semibold tracking-wider text-amber-600 bg-amber-500/10 border-amber-500/20 shrink-0">
                        Ожидает
                    </Badge>
                );
        }
    };

    const handleExport = () => {
        const baseName = filename
            ? filename.replace(/\.[^/.]+$/, "")
            : `docutrace-export-${Date.now()}`;

        if (exportFormat === 'csv') {
            const targetFile = `${baseName}.csv`;
            exportToCSV(data, targetFile);
            toast.success("CSV файл успешно сохранён", {
                description: `Файл ${targetFile} с разделителем ';' и UTF-8 BOM готов для Excel/1C.`
            });
        } else if (exportFormat === 'excel') {
            const targetFile = `${baseName}.xls`;
            exportToExcel(data, targetFile);
            toast.success("Excel таблица успешно сохранена", {
                description: `Файл ${targetFile} со стилизованными заголовками готов.`
            });
        } else if (exportFormat === 'json') {
            const targetFile = `${baseName}.json`;
            exportToJSON(data, targetFile);
            toast.success("JSON данные успешно сохранены", {
                description: `Файл ${targetFile} сформирован без внутренних координат.`
            });
        }
    };

    const handleApproveAll = () => {
        const approvedItems = verificationItems.map(item => ({
            ...item,
            status: (item.status === 'pending' ? 'verified' : item.status) as VerificationStatus
        }));
        setVerificationItems(approvedItems);
        verificationItemsRef.current = approvedItems;
        syncChanges(extracted, approvedItems);
        toast.success("Все позиции подтверждены как проверенные");
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
        const highlight = getHighlight(raw, formatLabel(key), filename, key);

        const itemId = `field_${key}`;
        const vItem = verificationItems.find(v => v.id === itemId);
        const isActive = isReviewMode && verificationItems[activeIndex]?.id === itemId;
        const isEditing = editingId === itemId;

        return (
            <div
                key={key}
                ref={(el) => { if (el) itemRefs.current.set(itemId, el); }}
                className={`flex items-center justify-between p-3 rounded-lg transition-all duration-150 border-b last:border-0 group cursor-pointer
                    ${isActive ? 'bg-primary/10 ring-2 ring-primary shadow-sm' : 'hover:bg-muted/50'}
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
                <div className="flex flex-col gap-1 w-1/3 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-muted-foreground font-semibold truncate">{formatLabel(key)}</span>
                        {highlight && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Привязано к чеку" />
                        )}
                    </div>
                    {getStatusBadge(vItem?.status || 'pending')}
                </div>

                <div className="flex items-center justify-between w-2/3 pl-3 border-l gap-2 min-w-0">
                    {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                            <input
                                ref={editInputRef}
                                className="flex h-8 w-full rounded-md border border-primary/40 bg-background px-2 py-1 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm"
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
                            <span className="text-xs font-mono font-semibold truncate flex-1" title={String(vItem?.editedValue || displayVal)}>
                                {String(vItem?.editedValue || displayVal)}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                    title="Одобрить"
                                    onClick={(e) => { e.stopPropagation(); approveItem(itemId); }}
                                >
                                    <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    size="icon" variant="ghost"
                                    className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                    title="Редактировать"
                                    onClick={(e) => { e.stopPropagation(); startEditing(vItem); }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    };

    const renderArrayField = (key: string) => {
        const arrayValue = data[key] as any[];
        if (!Array.isArray(arrayValue) || arrayValue.length === 0) return null;

        // Get column keys
        const commonKeys = Array.from(
            new Set(arrayValue.flatMap(obj => Object.keys(obj || {})))
        );

        return (
            <div key={key} className="space-y-2 mb-6">
                <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs uppercase text-foreground font-bold tracking-wider">
                        {formatLabel(key)} ({arrayValue.length})
                    </h4>
                    <span className="text-[10px] text-muted-foreground">
                        Двойной клик — редактировать • Клик — подсветить на чеке
                    </span>
                </div>

                <div className="overflow-x-auto w-full border rounded-xl bg-card shadow-xs">
                    <table className="w-full text-left border-collapse min-w-full table-fixed">
                        <colgroup>
                            <col style={{ width: "38px" }} />
                            {commonKeys.map(colKey => (
                                <col key={colKey} style={{ width: `${getColWidth(colKey)}px` }} />
                            ))}
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "68px" }} />
                        </colgroup>
                        <thead className="bg-muted/40 border-b text-[11px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 z-10">
                            <tr>
                                <th className="p-2.5 text-center font-mono">#</th>
                                {commonKeys.map((colKey) => (
                                    <th key={colKey} className="p-2.5 truncate font-medium" title={formatLabel(colKey)}>
                                        {formatLabel(colKey)}
                                    </th>
                                ))}
                                <th className="p-2.5 text-center">Статус</th>
                                <th className="p-2.5 text-right pr-3">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60 text-xs font-mono">
                            {arrayValue.map((item, idx) => {
                                const itemId = `row_${key}_${idx}`;
                                const vItem = verificationItems.find(v => v.id === itemId);
                                const isActive = isReviewMode && verificationItems[activeIndex]?.id === itemId;
                                const isRowEditing = editingId === itemId;
                                const itemSource = item.source || item.Source || item.file || item.fileName || item.filename || filename;

                                return (
                                    <tr
                                        key={idx}
                                        ref={(el) => { if (el) itemRefs.current.set(itemId, el); }}
                                        className={`transition-colors duration-150 cursor-pointer group ${
                                            isActive
                                                ? 'bg-primary/10 ring-2 ring-primary shadow-xs font-semibold'
                                                : 'hover:bg-muted/50'
                                        } ${vItem?.status === 'verified' ? 'bg-emerald-500/5' : ''} ${
                                            vItem?.status === 'edited' ? 'bg-blue-500/5' : ''
                                        }`}
                                        onClick={() => {
                                            const firstHL = commonKeys
                                                .map(ck => getHighlight(item[ck], `${formatLabel(key)} #${idx + 1} → ${formatLabel(ck)}`, itemSource, ck))
                                                .find(Boolean);
                                            if (firstHL) setActiveHighlight(firstHL);
                                            if (isReviewMode) {
                                                const vi = verificationItems.findIndex(v => v.id === itemId);
                                                if (vi !== -1) setActiveIndex(vi);
                                            }
                                        }}
                                    >
                                        <td className="p-2.5 text-center text-muted-foreground font-mono text-[11px]">
                                            {idx + 1}
                                        </td>
                                        {commonKeys.map(colKey => {
                                            const raw = item[colKey];
                                            const val = vItem?.columns?.find(c => c.key === colKey)?.value || getDisplayValue(raw);
                                            const cellHighlight = getHighlight(raw, `${formatLabel(key)} #${idx + 1} → ${formatLabel(colKey)}`, itemSource, colKey);
                                            const isThisCellEditing = isRowEditing && editColumnKey === colKey;

                                            const isDate = /date/i.test(colKey);
                                            const dateParsed = isDate ? parseDocDate(val) : null;
                                            const displayStr = dateParsed?.isValid ? dateParsed.display : val;

                                            return (
                                                <td
                                                    key={colKey}
                                                    className={`p-2.5 truncate max-w-0 ${cellHighlight ? 'cursor-crosshair' : ''}`}
                                                    title={dateParsed?.isValid ? `${dateParsed.display} (Исходное: ${val})` : val}
                                                    onClick={(e) => {
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
                                                            className="h-7 w-full rounded border border-primary/40 bg-background px-1.5 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                                                                if (e.key === 'Escape') cancelEdit();
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            {cellHighlight && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Привязано к чеку (клик)" />
                                                            )}
                                                            <span className="truncate">{displayStr}</span>
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        <td className="p-2.5 text-center">
                                            {getStatusBadge(vItem?.status || 'pending')}
                                        </td>
                                        <td className="p-2.5 text-right pr-3">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    size="icon" variant="ghost"
                                                    className="h-6 w-6 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                                    title="Одобрить"
                                                    onClick={(e) => { e.stopPropagation(); approveItem(itemId); }}
                                                >
                                                    <Check className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    size="icon" variant="ghost"
                                                    className="h-6 w-6 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                                    title="Редактировать"
                                                    onClick={(e) => { e.stopPropagation(); startEditing(vItem); }}
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderMarkdown = (text: string) => {
        if (!text) return null;
        return (
            <div className="p-4 bg-muted/10 rounded-xl border border-muted-foreground/20 space-y-3">
                {text.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                        {paragraph}
                    </p>
                ))}
            </div>
        );
    };

    return (
        <div ref={containerRef} className="flex flex-col h-full bg-background border rounded-xl overflow-hidden shadow-sm">
            {/* Header with progress */}
            <div className="p-3 border-b bg-muted/20 space-y-2.5 flex-none">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                            Извлечённые данные
                        </h3>
                        {stats.total > 0 && (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-mono text-[11px] tabular-nums">
                                {stats.done} / {stats.total} проверено
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant={isReviewMode ? "default" : "outline"}
                            className={`gap-1.5 h-7 text-xs font-semibold transition-all ${isReviewMode
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white border-0 shadow-md shadow-emerald-500/25'
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
                                <><Keyboard className="w-3.5 h-3.5" /> Режим проверки активен</>
                            ) : (
                                <><Play className="w-3.5 h-3.5" /> Начать проверку</>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Progress bar */}
                {stats.total > 0 && (
                    <div className="space-y-1">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${stats.percent}%` }}
                                transition={{ duration: 0.4, ease: "easeOut" }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                            <span>{stats.percent}% подтверждено</span>
                            {isReviewMode && (
                                <span className="text-primary font-semibold">
                                    Enter ↵ одобрить • ↑↓ навигация • E изменить • Esc закрыть
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
                <div className="p-3 space-y-4">
                    {/* Focused Review Card Mode */}
                    {isReviewMode && activeItem && (
                        <div className="p-3 bg-card border-2 border-primary/40 rounded-xl shadow-md space-y-3 bg-gradient-to-b from-primary/5 to-transparent">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                                        Проверка ({activeIndex + 1} из {verificationItems.length})
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[11px]"
                                        onClick={() => setActiveIndex(p => Math.max(0, p - 1))}
                                        disabled={activeIndex <= 0}
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Назад
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[11px]"
                                        onClick={() => setActiveIndex(p => Math.min(verificationItems.length - 1, p + 1))}
                                        disabled={activeIndex >= verificationItems.length - 1}
                                    >
                                        Вперёд <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 ml-1 text-muted-foreground hover:text-foreground"
                                        onClick={() => setIsReviewMode(false)}
                                        title="Закрыть проверку (Esc)"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>

                            <div className="bg-background/90 border rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-foreground text-sm">
                                            {activeItem.label}
                                        </span>
                                        {activeItem.fileName && (
                                            <span className="text-muted-foreground font-mono text-[10px]">
                                                ({activeItem.fileName})
                                            </span>
                                        )}
                                    </div>
                                    {getStatusBadge(activeItem.status)}
                                </div>

                                {/* Raw vs Normalized Comparison */}
                                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                                    <div className="p-2.5 bg-muted/40 rounded-lg border">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">
                                            В чеке (Raw OCR)
                                        </span>
                                        <span className="font-mono font-bold text-foreground text-sm break-all">
                                            {activeItem.highlight?.rawValue || activeItem.value || "—"}
                                        </span>
                                    </div>
                                    <div className="p-2.5 bg-primary/5 rounded-lg border border-primary/20">
                                        <span className="text-[10px] uppercase font-bold text-primary block mb-1">
                                            Нормализовано / В системе
                                        </span>
                                        <span className="font-mono font-bold text-primary text-sm break-all">
                                            {activeItem.editedValue || activeItem.value || "—"}
                                        </span>
                                    </div>
                                </div>

                                {/* Actions & Hotkeys */}
                                <div className="flex items-center justify-between pt-1.5 text-[11px] text-muted-foreground">
                                    <div className="flex items-center gap-1.5">
                                        <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-[10px] text-foreground font-semibold shadow-xs">Enter</kbd>
                                        <span>Одобрить</span>
                                        <span className="mx-1">•</span>
                                        <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-[10px] text-foreground font-semibold shadow-xs">E</kbd>
                                        <span>Изменить</span>
                                    </div>
                                    <div className="flex gap-1.5">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs gap-1"
                                            onClick={() => startEditing(activeItem)}
                                        >
                                            <Pencil className="w-3 h-3" /> Редактировать (E)
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                                            onClick={() => approveAndNext(activeItem.id)}
                                        >
                                            <Check className="w-3.5 h-3.5" /> Подтвердить (Enter)
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {data.markdown_text && (
                        <div className="space-y-1 mb-4">
                            <h4 className="text-xs uppercase text-muted-foreground font-bold tracking-wider mb-2 px-1">
                                Краткое содержание
                            </h4>
                            {renderMarkdown(data.markdown_text)}
                        </div>
                    )}

                    {primitives.length > 0 && (
                        <div className="space-y-1">
                            <h4 className="text-xs uppercase text-muted-foreground font-bold tracking-wider mb-2 px-1">
                                Основные реквизиты
                            </h4>
                            <div className="border rounded-xl bg-card">
                                {primitives.map(k => renderFieldRow(k))}
                            </div>
                        </div>
                    )}

                    {arrays.map(k => renderArrayField(k))}

                    {primitives.length === 0 && arrays.length === 0 && !data.markdown_text && (
                        <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-3">
                            <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">Ожидание данных...</p>
                                <p className="text-xs text-muted-foreground max-w-[280px]">
                                    Результаты обработки отобразятся в таблице в реальном времени.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Sticky bottom actions */}
            <div className="p-3 border-t bg-muted/15 flex-none space-y-2">
                {/* Export Format Selector */}
                <div className="flex items-center justify-between gap-2 px-0.5">
                    <span className="text-xs text-muted-foreground font-medium">Формат экспорта:</span>
                    <div className="flex bg-muted/60 p-0.5 rounded-lg text-xs">
                        <button
                            type="button"
                            className={`px-2 py-0.5 rounded-md transition-all font-medium flex items-center gap-1 text-xs ${
                                exportFormat === 'csv'
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setExportFormat('csv')}
                            title="CSV с UTF-8 BOM и разделителем ';' для Excel / 1C"
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
                            title="Excel Spreadsheet (.xls)"
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
                            title="Чистый JSON без внутренних координат"
                        >
                            <span className="text-[11px]">📄</span> JSON
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        className="flex-1 gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20 border-0 h-9 text-xs font-semibold"
                        size="default"
                        onClick={handleExport}
                    >
                        <Download className="w-4 h-4" />
                        <span>Экспорт {exportFormat.toUpperCase()} ({stats.done}/{stats.total} проверено)</span>
                    </Button>

                    {stats.done < stats.total && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 px-3 text-xs gap-1.5 shrink-0 border-muted-foreground/30 hover:border-emerald-500/50 hover:bg-emerald-500/5"
                            onClick={handleApproveAll}
                            title="Одобрить все оставшиеся позиции"
                        >
                            <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Одобрить все</span>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
