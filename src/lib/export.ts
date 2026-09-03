// Multi-format exporter for DocuTrace
// Supports:
// 1. CSV (Excel-optimized with UTF-8 BOM and semicolon ';' delimiter)
// 2. Excel SpreadsheetML (.xls with styled headers and typed numeric/string cells)
// 3. Clean JSON (.json with unwrapped values for API/database integration)

function isLocatedValue(v: any): boolean {
    return v && typeof v === 'object' && 'value' in v && 'box_2d' in v;
}

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
        row.map(cell => {
            const cleanedCell = String(cell ?? '').replace(/"/g, '""');
            // If cell contains semicolon, comma, newline, or double quote, wrap in double quotes
            if (
                cleanedCell.includes(';') ||
                cleanedCell.includes(',') ||
                cleanedCell.includes('\n') ||
                cleanedCell.includes('\r') ||
                cleanedCell.includes('"')
            ) {
                return `"${cleanedCell}"`;
            }
            return cleanedCell;
        }).join(";")
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

    const escapeXml = (val: string): string => {
        return String(val ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    const isNumeric = (val: string): boolean => {
        if (!val || typeof val !== 'string') return false;
        const trimmed = val.trim();
        // Keep codes with leading zeros as text (e.g. EDRPOU, postal code, IBAN)
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
        ' </Styles>',
        ' <Worksheet ss:Name="DocuTrace Export">',
        '  <Table ss:DefaultRowHeight="20">'
    ];

    // Header row
    xmlParts.push('   <Row ss:StyleID="Header" ss:Height="24">');
    headers.forEach(h => {
        xmlParts.push(`    <Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`);
    });
    xmlParts.push('   </Row>');

    // Data rows
    rows.forEach(row => {
        xmlParts.push('   <Row>');
        row.forEach(cell => {
            if (isNumeric(cell)) {
                xmlParts.push(`    <Cell ss:StyleID="NumberCell"><Data ss:Type="Number">${escapeXml(cell)}</Data></Cell>`);
            } else {
                xmlParts.push(`    <Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`);
            }
        });
        xmlParts.push('   </Row>');
    });

    xmlParts.push('  </Table>');
    xmlParts.push(' </Worksheet>');
    xmlParts.push('</Workbook>');

    const xmlContent = xmlParts.join('\r\n');
    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.xls') ? filename : `${filename}.xls`;
    downloadBlob(blob, cleanFilename);
}

/**
 * Export clean, unwrapped JSON (without internal box_2d/page metadata).
 * Perfect for software integrations, ERP import, or developer API payloads.
 */
export function exportToJSON(data: any, filename: string = "docutrace-export.json") {
    if (!data || typeof data !== 'object') return;

    function unwrapValues(obj: any): any {
        if (obj === null || obj === undefined) return null;
        if (isLocatedValue(obj)) {
            return obj.value;
        }
        if (Array.isArray(obj)) {
            return obj.map(unwrapValues);
        }
        if (typeof obj === 'object') {
            const clean: Record<string, any> = {};
            for (const k of Object.keys(obj)) {
                clean[k] = unwrapValues(obj[k]);
            }
            return clean;
        }
        return obj;
    }

    const cleanData = unwrapValues(data);
    const jsonString = JSON.stringify(cleanData, null, 2);

    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const cleanFilename = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
    downloadBlob(blob, cleanFilename);
}
