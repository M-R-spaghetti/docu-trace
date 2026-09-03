// Dynamic CSV exporter - works with any AI-generated schema
// Handles the new LocatedValue format: { value, box_2d, page }

function isLocatedValue(v: any): boolean {
    return v && typeof v === 'object' && 'value' in v && 'box_2d' in v;
}

function extractValue(v: any): string {
    if (v === null || v === undefined) return '';
    if (isLocatedValue(v)) return String(v.value);
    return String(v);
}

export function exportToCSV(data: any, filename: string = "docutrace-export.csv") {
    if (!data || typeof data !== 'object') return;

    const allKeys = Object.keys(data).filter(k => k !== 'markdown_text');

    // Separate primitives (including LocatedValues) from arrays
    const primitiveKeys = allKeys.filter(k => !Array.isArray(data[k]) || isLocatedValue(data[k]));
    const arrayKeys = allKeys.filter(k => Array.isArray(data[k]) && !isLocatedValue(data[k]));

    const rows: string[][] = [];

    if (arrayKeys.length > 0) {
        // For each array, create a section
        arrayKeys.forEach(arrayKey => {
            const arr = data[arrayKey] as any[];
            if (!Array.isArray(arr) || arr.length === 0) return;

            const colKeys = Array.from(
                new Set(arr.flatMap(obj => Object.keys(obj || {})))
            );

            // Header row for this array section
            const headers = [
                ...primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase())),
                ...colKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()))
            ];

            if (rows.length === 0) {
                rows.push(headers);
            }

            // Data rows
            arr.forEach(item => {
                const row = [
                    ...primitiveKeys.map(k => extractValue(data[k])),
                    ...colKeys.map(ck => extractValue(item[ck]))
                ];
                rows.push(row);
            });
        });
    } else {
        // Only primitives — one header row + one data row
        const headers = primitiveKeys.map(k => k.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()));
        const values = primitiveKeys.map(k => extractValue(data[k]));
        rows.push(headers);
        rows.push(values);
    }

    // Convert to CSV string
    const csvContent = rows.map(row =>
        row.map(cell => {
            const cleanedCell = String(cell).replace(/"/g, '""');
            if (cleanedCell.includes(',') || cleanedCell.includes('\n') || cleanedCell.includes('"')) {
                return `"${cleanedCell}"`;
            }
            return cleanedCell;
        }).join(",")
    ).join("\n");

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
