// Multi-format exporter for DocuTrace
// Supports:
// 1. CSV (Excel-optimized with UTF-8 BOM and semicolon ';' delimiter)
// 2. Excel SpreadsheetML (.xls with styled headers and typed numeric/string cells)
// 3. Clean JSON (.json with unwrapped values for API/database integration)

import type { DocRow } from "./batchTypes";
import { FlatRow, explodeDoc, getDisplayValue, isLocatedValue } from "./flatten";

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

    const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');

    // Separate top-level primitives from array collections
    const primitiveKeys = allKeys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k]));
    const arrayKeys = allKeys.filter(k => Array.isArray(data[k]) && !isLocatedValue(data[k]));

    const rows: string[][] = [];
    let headers: string[] = [];

    if (arrayKeys.length > 0) {
        // Collect rows across arrays (e.g. invoice line items, tax breakdown)
        arrayKeys.forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            if (!Array.isArray(arr) || arr.length === 0) return;

            const colKeys = Array.from(
                new Set(arr.flatMap(obj => Object.keys(obj || {})))
            );

            // Combine headers: primitive fields first, then table columns
            headers = [
                ...primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase())),
                ...colKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()))
            ];

            arr.forEach(item => {
                const row = [
                    ...primitiveKeys.map(k => extractValue(data[k])),
                    ...colKeys.map(ck => extractValue(item[ck]))
                ];
                rows.push(row);
            });
        });
    } else {
        // Only primitives — 1 header row + 1 data row
        headers = primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()));
        const values = primitiveKeys.map(k => extractValue(data[k]));
        rows.push(values);
    }

    return { headers, rows };
}

/**
 * Trigger browser file download from a Blob
 */
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

/**
 * Export to CSV with UTF-8 BOM (\uFEFF) and semicolon (;) delimiter.
 * Guarantees that Ukrainian/Cyrillic and European Excel versions open the file
 * directly on double-click with proper columns and zero encoding corruption.
 */
export function exportToCSV(data: any, filename: string = "docutrace-export.csv") {
    const { headers, rows } = extractTableRows(data);
    if (headers.length === 0 && rows.length === 0) return;

    const allRows = [headers, ...rows];

    // Format with semicolon delimiter and RFC 4180 escaping
    const csvContent = allRows.map(row =>
        row.map(escapeCSVValue).join(";")
    ).join("\r\n");

    // Prepend UTF-8 BOM (\uFEFF) so Excel for Windows & Mac automatically detects UTF-8
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
    downloadBlob(blob, cleanFilename);
}

/**
 * Export to native Excel SpreadsheetML XML format (.xls).
 * Opens cleanly in Excel with styled teal headers, auto-row heights,
 * and proper number vs string column typing.
 */
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

    // Header row
    xmlParts.push('   <Row ss:Height="26">');
    for (const h of headers) {
        xmlParts.push(`    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    }
    xmlParts.push('   </Row>');

    // Data rows
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

/**
 * Export raw or unwrapped data as clean JSON.
 */
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
 * Compiles a batch of documents into flat item-level 2D grid data for Excel/CSV.
 */
export function compileBatchExportData(rows: DocRow[] | FlatRow[]): { headers: string[]; dataRows: string[][] } {
    const flatRows: FlatRow[] = (rows.length > 0 && "cells" in rows[0])
        ? (rows as FlatRow[])
        : (rows as DocRow[]).flatMap(r => explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error));

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
        ...colKeys.map(k => k.replace(/_/g, " ").replace(/^./, s => s.toUpperCase()))
    ];

    const dataRows = flatRows.map(fr => {
        const posStr = fr.totalItemsInDoc > 1 ? `${fr.rowIndex + 1} of ${fr.totalItemsInDoc}` : "1";
        const vals = colKeys.map(k => {
            const cell = fr.cells[k];
            return cell ? getDisplayValue(cell.node) : "";
        });
        return [fr.fileName, posStr, fr.status, ...vals];
    });

    return { headers, dataRows };
}

export function exportBatchToCSV(rows: DocRow[] | FlatRow[], filename = "batch_export.csv") {
    const { headers, dataRows } = compileBatchExportData(rows);
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

export function exportBatchToExcel(rows: DocRow[] | FlatRow[], filename = "batch_export.xls") {
    const { headers, dataRows } = compileBatchExportData(rows);
    if (headers.length === 0) return;

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
        '  <Style ss:ID="Cell">',
        '   <Alignment ss:Vertical="Center"/>',
        '  </Style>',
        ' </Styles>',
        ' <Worksheet ss:Name="Batch Results">',
        '  <Table>'
    ];

    xmlParts.push('   <Row ss:Height="26">');
    for (const h of headers) {
        xmlParts.push(`    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    }
    xmlParts.push('   </Row>');

    for (const r of dataRows) {
        xmlParts.push('   <Row ss:Height="20">');
        for (const val of r) {
            xmlParts.push(`    <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`);
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

export function exportBatchToJSON(rows: DocRow[] | FlatRow[], filename = "batch_export.json") {
    const flatRows: FlatRow[] = (rows.length > 0 && "cells" in rows[0])
        ? (rows as FlatRow[])
        : (rows as DocRow[]).flatMap(r => explodeDoc(r.fileId, r.fileName, r.data, r.file, r.status, r.error));

    const clean = flatRows.map(fr => {
        const itemFields: Record<string, any> = {};
        for (const [k, cell] of Object.entries(fr.cells)) {
            itemFields[k] = isLocatedValue(cell.node) ? cell.node.value : cell.node;
        }
        return {
            fileName: fr.fileName,
            fileId: fr.fileId,
            position: fr.totalItemsInDoc > 1 ? fr.rowIndex + 1 : 1,
            totalPositions: fr.totalItemsInDoc,
            status: fr.status,
            data: itemFields,
        };
    });

    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    downloadBlob(blob, cleanFilename);
}
