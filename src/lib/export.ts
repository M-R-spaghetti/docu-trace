// Multi-format exporter for DocuTrace with comprehensive Audit Trail
// Supports:
// 1. CSV (Excel-optimized with UTF-8 BOM, semicolon ';' delimiter, and audit trail)
// 2. Excel SpreadsheetML (.xls with styled headers, typed cells, and audit trail)
// 3. Clean JSON (.json with audit metadata for database / ERP sync)

import type { DocRow } from "./batchTypes";
import { FlatRow, explodeDoc, getDisplayValue, isLocatedValue } from "./flatten";
import { parseDocDate } from "./parseDocDate";
import { getStoredNormalizationSettings, normalizeValue } from "./normalization";

function extractValue(v: any): string {
    if (v === null || v === undefined) return '';
    if (isLocatedValue(v)) return String(v.value ?? '');
    return String(v);
}

/**
 * Extracts a normalized 2D table grid (headers + rows) from dynamic AI-generated data.
 * Handles both flat primitive fields and array row collections.
 */
function extractTableRows(data: any): { headers: string[]; rows: string[][] } {
    if (!data || typeof data !== 'object') return { headers: [], rows: [] };

    const settings = getStoredNormalizationSettings();
    const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');

    const primitiveKeys = allKeys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k]));
    const arrayKeys = allKeys.filter(k => Array.isArray(data[k]) && !isLocatedValue(data[k]));

    const rows: string[][] = [];
    let headers: string[] = [];

    if (arrayKeys.length > 0) {
        arrayKeys.forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            if (!Array.isArray(arr) || arr.length === 0) return;

            const colKeys = Array.from(
                new Set(arr.flatMap(obj => Object.keys(obj || {})))
            );

            headers = [
                ...primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase())),
                ...colKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()))
            ];

            arr.forEach(item => {
                const row = [
                    ...primitiveKeys.map(k => normalizeValue(extractValue(data[k]), k, settings)),
                    ...colKeys.map(ck => normalizeValue(extractValue(item[ck]), ck, settings))
                ];
                rows.push(row);
            });
        });
    } else {
        headers = primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()));
        const values = primitiveKeys.map(k => normalizeValue(extractValue(data[k]), k, settings));
        rows.push(values);
    }

    return { headers, rows };
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeCSVValue(val: any): string {
    const cleaned = String(val ?? '').replace(/"/g, '""');
    if (
        cleaned.includes(';') ||
        cleaned.includes(',') ||
        cleaned.includes('\n') ||
        cleaned.includes('\r') ||
        cleaned.includes('"')
    ) {
        return `"${cleaned}"`;
    }
    return cleaned;
}

function escapeXml(val: any): string {
    return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function exportToCSV(data: any, filename: string = "docutrace-export.csv") {
    const { headers, rows } = extractTableRows(data);
    if (headers.length === 0 && rows.length === 0) return;

    const allRows = [headers, ...rows];
    const csvContent = allRows.map(row =>
        row.map(escapeCSVValue).join(";")
    ).join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
    downloadBlob(blob, cleanFilename);
}

export function exportToExcel(data: any, filename: string = "docutrace-export.xls") {
    const { headers, rows } = extractTableRows(data);
    if (headers.length === 0 && rows.length === 0) return;

    const isNumeric = (val: string): boolean => {
        if (!val || typeof val !== 'string') return false;
        const trimmed = val.trim();
        if (/^0\d+/.test(trimmed)) return false;
        return !isNaN(Number(trimmed)) && !isNaN(parseFloat(trimmed));
    };

    const xmlParts: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
        ' xmlns:o="urn:schemas-microsoft-com:office:office"',
        ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
        ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
        ' xmlns:html="http://www.w3.org/TR/REC-html40">',
        ' <Styles>',
        '  <Style ss:ID="Default" ss:Name="Normal">',
        '   <Alignment ss:Vertical="Center"/>',
        '   <Font ss:FontName="Segoe UI" ss:Size="10"/>',
        '  </Style>',
        '  <Style ss:ID="Header">',
        '   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>',
        '   <Interior ss:Color="#0D9488" ss:Pattern="Solid"/>',
        '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
        '  </Style>',
        '  <Style ss:ID="NumberCell">',
        '   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>',
        '   <NumberFormat ss:Format="#,##0.00"/>',
        '  </Style>',
        '  <Style ss:ID="StringCell">',
        '   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>',
        '  </Style>',
        ' </Styles>',
        ' <Worksheet ss:Name="Extracted Data">',
        '  <Table>'
    ];

    xmlParts.push('   <Row ss:Height="26">');
    for (const h of headers) {
        xmlParts.push(`    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    }
    xmlParts.push('   </Row>');

    for (const row of rows) {
        xmlParts.push('   <Row ss:Height="20">');
        for (const cell of row) {
            if (isNumeric(cell)) {
                xmlParts.push(`    <Cell ss:StyleID="NumberCell"><Data ss:Type="Number">${escapeXml(cell.replace(',', '.'))}</Data></Cell>`);
            } else {
                xmlParts.push(`    <Cell ss:StyleID="StringCell"><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`);
            }
        }
        xmlParts.push('   </Row>');
    }

    xmlParts.push('  </Table>');
    xmlParts.push(' </Worksheet>');
    xmlParts.push('</Workbook>');

    const xmlContent = xmlParts.join('\r\n');
    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.xls') ? filename : `${filename}.xls`;
    downloadBlob(blob, cleanFilename);
}

export function exportToJSON(data: any, filename: string = "docutrace-export.json") {
    if (!data) return;

    function unwrapNode(node: any): any {
        if (node === null || node === undefined) return node;
        if (isLocatedValue(node)) return node.value;
        if (Array.isArray(node)) return node.map(unwrapNode);
        if (typeof node === 'object') {
            const cleanObj: Record<string, any> = {};
            for (const [k, v] of Object.entries(node)) {
                if (k === 'markdown_text') continue;
                cleanObj[k] = unwrapNode(v);
            }
            return cleanObj;
        }
        return node;
    }

    const cleanData = unwrapNode(data);
    const jsonStr = JSON.stringify(cleanData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    downloadBlob(blob, cleanFilename);
}

/**
 * Compiles a batch of documents into flat item-level 2D grid data for Excel/CSV with complete audit trail.
 */
export function compileBatchExportData(
    rows: DocRow[] | FlatRow[],
    docRows?: DocRow[]
): { headers: string[]; dataRows: string[][] } {
    let flatRows: FlatRow[];
    let docs: DocRow[];

    if (rows.length > 0 && "cells" in rows[0]) {
        flatRows = rows as FlatRow[];
        docs = docRows || [];
    } else {
        docs = rows as DocRow[];
        flatRows = docs.flatMap(r => explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error));
    }

    const docMap = new Map<string, DocRow>();
    for (const d of docs) {
        docMap.set(d.fileId, d);
        docMap.set(d.fileName, d);
    }

    if (flatRows.length === 0) return { headers: [], dataRows: [] };

    const colKeysSet = new Set<string>();
    for (const fr of flatRows) {
        for (const k of Object.keys(fr.cells)) {
            colKeysSet.add(k);
        }
    }
    const colKeys = Array.from(colKeysSet);

    const headers = [
        "Source File",
        "Position #",
        "Status",
        ...colKeys.map(k => k.replace(/_/g, " ").replace(/^./, s => s.toUpperCase())),
        "Audit: Auto-Check",
        "Audit: Reasons",
        "Audit: Human Review",
        "Audit: Original Values",
        "Audit: Reviewed At"
    ];

    const dataRows = flatRows.map(fr => {
        const parentDoc = docMap.get(fr.fileId);
        const posStr = fr.totalItemsInDoc > 1 ? `${fr.rowIndex + 1} of ${fr.totalItemsInDoc}` : "1";
        const vals = colKeys.map(k => {
            const cell = fr.cells[k];
            if (!cell) return "";
            if (/date/i.test(k)) {
                const parsed = parseDocDate(cell.node);
                if (parsed.isValid && parsed.iso) return parsed.iso;
            }
            return getDisplayValue(cell.node);
        });

        // Audit Trail Columns
        let autoStatus = "OK";
        const reasonsList: string[] = [];
        let humanStatus = "Не проверено";
        const originalVals: string[] = [];
        let latestReviewTime: number | undefined = undefined;

        for (const k of colKeys) {
            const cell = fr.cells[k];
            if (!cell) continue;
            const rev = parentDoc?.reviews?.[cell.path];
            if (rev) {
                if (rev.auto === "error") autoStatus = "Ошибка";
                else if (rev.auto === "warn" && autoStatus !== "Ошибка") autoStatus = "Замечание";

                if (rev.reasons.length > 0) {
                    reasonsList.push(`${k}: ${rev.reasons.join(", ")}`);
                }

                if (rev.human === "confirmed") {
                    if (humanStatus !== "Исправлено") humanStatus = "Подтверждено";
                } else if (rev.human === "corrected") {
                    humanStatus = "Исправлено";
                } else if (rev.human === "bulk_confirmed") {
                    if (humanStatus === "Не проверено") humanStatus = "Массово подтверждено";
                }

                if (rev.reviewedAt && (!latestReviewTime || rev.reviewedAt > latestReviewTime)) {
                    latestReviewTime = rev.reviewedAt;
                }
            }

            if (isLocatedValue(cell.node) && cell.node.originalValue !== undefined && cell.node.originalValue !== cell.node.value) {
                originalVals.push(`${k}: ${cell.node.originalValue}`);
            }
        }

        const reviewTimeStr = latestReviewTime ? new Date(latestReviewTime).toLocaleString("ru-RU") : "";

        return [
            fr.fileName,
            posStr,
            fr.status,
            ...vals,
            autoStatus,
            reasonsList.join("; "),
            humanStatus,
            originalVals.join("; "),
            reviewTimeStr
        ];
    });

    return { headers, dataRows };
}

export function exportBatchToCSV(rows: DocRow[] | FlatRow[], docRows?: DocRow[], filename = "batch_export.csv") {
    const { headers, dataRows } = compileBatchExportData(rows, docRows);
    if (headers.length === 0) return;

    const csvLines: string[] = [];
    csvLines.push(headers.map(escapeCSVValue).join(';'));
    for (const row of dataRows) {
        csvLines.push(row.map(escapeCSVValue).join(';'));
    }

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
    downloadBlob(blob, cleanFilename);
}

export function exportBatchToExcel(rows: DocRow[] | FlatRow[], docRows?: DocRow[], filename = "batch_export.xls") {
    const { headers, dataRows } = compileBatchExportData(rows, docRows);
    if (headers.length === 0) return;

    const isNumeric = (val: string): boolean => {
        if (!val || typeof val !== 'string') return false;
        const trimmed = val.trim();
        if (/^0\d+/.test(trimmed)) return false;
        return !isNaN(Number(trimmed)) && !isNaN(parseFloat(trimmed));
    };

    const xmlParts: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
        ' xmlns:o="urn:schemas-microsoft-com:office:office"',
        ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
        ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
        ' xmlns:html="http://www.w3.org/TR/REC-html40">',
        ' <Styles>',
        '  <Style ss:ID="Header">',
        '   <Font ss:Bold="1" ss:Color="#FFFFFF"/>',
        '   <Interior ss:Color="#0D9488" ss:Pattern="Solid"/>',
        '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
        '  </Style>',
        '  <Style ss:ID="AuditHeader">',
        '   <Font ss:Bold="1" ss:Color="#FFFFFF"/>',
        '   <Interior ss:Color="#4F46E5" ss:Pattern="Solid"/>',
        '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
        '  </Style>',
        '  <Style ss:ID="Cell">',
        '   <Alignment ss:Vertical="Center"/>',
        '  </Style>',
        '  <Style ss:ID="NumberCell">',
        '   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>',
        '   <NumberFormat ss:Format="#,##0.00"/>',
        '  </Style>',
        ' </Styles>',
        ' <Worksheet ss:Name="Batch Results">',
        '  <Table>'
    ];

    xmlParts.push('   <Row ss:Height="26">');
    for (const h of headers) {
        const isAudit = h.startsWith("Audit:");
        const styleId = isAudit ? "AuditHeader" : "Header";
        xmlParts.push(`    <Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    }
    xmlParts.push('   </Row>');

    for (const r of dataRows) {
        xmlParts.push('   <Row ss:Height="20">');
        for (const val of r) {
            if (isNumeric(val)) {
                xmlParts.push(`    <Cell ss:StyleID="NumberCell"><Data ss:Type="Number">${escapeXml(val.replace(',', '.'))}</Data></Cell>`);
            } else {
                xmlParts.push(`    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`);
            }
        }
        xmlParts.push('   </Row>');
    }

    xmlParts.push('  </Table>');
    xmlParts.push(' </Worksheet>');
    xmlParts.push('</Workbook>');

    const xmlContent = xmlParts.join('\r\n');
    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.xls') ? filename : `${filename}.xls`;
    downloadBlob(blob, cleanFilename);
}

export function exportBatchToJSON(rows: DocRow[] | FlatRow[], docRows?: DocRow[], filename = "batch_export.json") {
    let flatRows: FlatRow[];
    let docs: DocRow[];

    if (rows.length > 0 && "cells" in rows[0]) {
        flatRows = rows as FlatRow[];
        docs = docRows || [];
    } else {
        docs = rows as DocRow[];
        flatRows = docs.flatMap(r => explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error));
    }

    const docMap = new Map<string, DocRow>();
    for (const d of docs) {
        docMap.set(d.fileId, d);
    }

    const clean = flatRows.map(fr => {
        const parentDoc = docMap.get(fr.fileId);
        const itemFields: Record<string, any> = {};
        const cellReviews: Record<string, any> = {};

        for (const [k, cell] of Object.entries(fr.cells)) {
            itemFields[k] = isLocatedValue(cell.node) ? cell.node.value : cell.node;
            if (parentDoc?.reviews?.[cell.path]) {
                cellReviews[k] = parentDoc.reviews[cell.path];
            }
        }

        return {
            fileName: fr.fileName,
            fileId: fr.fileId,
            position: fr.totalItemsInDoc > 1 ? fr.rowIndex + 1 : 1,
            totalPositions: fr.totalItemsInDoc,
            status: fr.status,
            data: itemFields,
            audit: cellReviews,
        };
    });

    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    downloadBlob(blob, cleanFilename);
}
