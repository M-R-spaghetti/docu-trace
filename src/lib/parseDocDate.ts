/**
 * Normalizes receipt dates to dd.MM.yyyy and ISO YYYY-MM-DD.
 * Detects ambiguous formats (e.g. 12-01-19 where DD/MM and MM/DD are both plausible)
 * and supports Cyrillic and English month names.
 */

export interface ParsedDocDate {
    raw: string;
    iso: string | null;           // "2019-01-17" for sorting, DB, and exports
    display: string;              // "17.01.2019" (10 chars)
    isValid: boolean;
    isAmbiguous: boolean;
    ambiguousAlternative?: string; // e.g. "01.12.2019"
    reason?: string;
}

const MONTH_NAMES_MAP: Record<string, number> = {
    // English
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,

    // Russian
    янв: 1, января: 1, январ: 1,
    фев: 2, февраля: 2, феврал: 2,
    мар: 3, марта: 3, март: 3,
    апр: 4, апреля: 4, апрел: 4,
    май: 5, мая: 5, маю: 5,
    июн: 6, июня: 6, июнь: 6,
    июл: 7, июля: 7, июль: 7,
    авг: 8, августа: 8, август: 8,
    сен: 9, сентября: 9, сент: 9,
    окт: 10, октября: 10, октябр: 10,
    ноя: 11, ноября: 11, ноябр: 11,
    дек: 12, декабря: 12, декабр: 12,

    // Ukrainian
    січ: 1, січня: 1,
    лют: 2, лютого: 2,
    бер: 3, березня: 3,
    кві: 4, квітня: 4,
    трав: 5, травня: 5,
    черв: 6, червня: 6,
    лип: 7, липня: 7,
    серп: 8, серпня: 8,
    вер: 9, вересня: 9,
    жовт: 10, жовтня: 10,
    лист: 11, листопада: 11,
    груд: 12, грудня: 12,
};

function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

export function parseDocDate(rawVal: unknown): ParsedDocDate {
    if (rawVal === null || rawVal === undefined) {
        return { raw: "", iso: null, display: "—", isValid: false, isAmbiguous: false };
    }

    const rawStr = String(
        typeof rawVal === "object" && rawVal && "value" in rawVal
            ? (rawVal as any).value
            : rawVal
    ).trim();

    if (!rawStr || rawStr === "—" || rawStr.toLowerCase() === "null" || rawStr.toLowerCase() === "undefined") {
        return { raw: rawStr, iso: null, display: "—", isValid: false, isAmbiguous: false };
    }

    // Strip time portion if present (e.g., "25/12/2018 14:30:00" or "2018-12-25T14:30:00")
    const dateOnlyPart = rawStr.split(/[ T]/)[0].trim();

    // 1. Check for text month formats, e.g., "17 JAN 2019", "17-янв-2019", "January 17, 2019"
    // Match: [day]? [monthWord] [day]?, [year]
    const textMonthRegex = /([0-9]{1,2})?[\s./\-]*([a-zA-Zа-яА-ЯёЁіїєґІЇЄҐ]{3,12})[\s./\-]*([0-9]{1,2})?[\s,./\-]+([0-9]{2,4})/;
    const textMatch = rawStr.match(textMonthRegex);
    if (textMatch) {
        const monthWord = textMatch[2].toLowerCase();
        const monthNum = MONTH_NAMES_MAP[monthWord];
        if (monthNum) {
            const dayNum = parseInt(textMatch[1] || textMatch[3] || "1", 10);
            let yearNum = parseInt(textMatch[4], 10);
            if (yearNum < 100) yearNum += 2000;

            if (dayNum >= 1 && dayNum <= 31 && yearNum >= 1990 && yearNum <= 2050) {
                const iso = `${yearNum}-${pad2(monthNum)}-${pad2(dayNum)}`;
                const display = `${pad2(dayNum)}.${pad2(monthNum)}.${yearNum}`;
                return {
                    raw: rawStr,
                    iso,
                    display,
                    isValid: true,
                    isAmbiguous: false,
                };
            }
        }
    }

    // 2. Pure Numeric with separators: DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY, DD.MM.YY
    const cleanNumeric = dateOnlyPart.replace(/,/g, ".");
    const numericParts = cleanNumeric.match(/^([0-9]{1,4})[./\-]([0-9]{1,2})[./\-]([0-9]{1,4})$/);

    if (numericParts) {
        const p1 = parseInt(numericParts[1], 10);
        const p2 = parseInt(numericParts[2], 10);
        const p3 = parseInt(numericParts[3], 10);

        // Case A: YYYY-MM-DD (p1 is 4 digits)
        if (p1 >= 1000) {
            const year = p1;
            const month = p2;
            const day = p3;
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return {
                    raw: rawStr,
                    iso: `${year}-${pad2(month)}-${pad2(day)}`,
                    display: `${pad2(day)}.${pad2(month)}.${year}`,
                    isValid: true,
                    isAmbiguous: false,
                };
            }
        }

        // Case B: DD/MM/YYYY or MM/DD/YYYY or DD/MM/YY (p3 is year)
        let year = p3;
        if (year < 100) year += 2000;

        if (year >= 1990 && year <= 2050) {
            // Check ambiguity: both p1 and p2 could be month (<= 12)
            const isAmbiguous = p1 <= 12 && p2 <= 12 && p1 !== p2;

            // Default assumption for receipts: Day = p1, Month = p2 (unless p1 > 12)
            let day = p1;
            let month = p2;

            if (p1 > 12 && p2 <= 12) {
                day = p1;
                month = p2;
            } else if (p2 > 12 && p1 <= 12) {
                day = p2;
                month = p1;
            }

            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                const iso = `${year}-${pad2(month)}-${pad2(day)}`;
                const display = `${pad2(day)}.${pad2(month)}.${year}`;
                const altDisplay = isAmbiguous ? `${pad2(month)}.${pad2(day)}.${year}` : undefined;

                return {
                    raw: rawStr,
                    iso,
                    display,
                    isValid: true,
                    isAmbiguous,
                    ambiguousAlternative: altDisplay,
                    reason: isAmbiguous ? `неоднозначно: dd/mm или mm/dd (возможно ${altDisplay})` : undefined,
                };
            }
        }
    }

    // 3. Fallback: JavaScript Date.parse
    const ts = Date.parse(rawStr);
    if (!isNaN(ts)) {
        const d = new Date(ts);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        if (year >= 1990 && year <= 2050) {
            return {
                raw: rawStr,
                iso: `${year}-${pad2(month)}-${pad2(day)}`,
                display: `${pad2(day)}.${pad2(month)}.${year}`,
                isValid: true,
                isAmbiguous: false,
            };
        }
    }

    // If completely unrecognized as date, return raw truncated
    return {
        raw: rawStr,
        iso: null,
        display: rawStr.length > 12 ? `${rawStr.slice(0, 11)}…` : rawStr,
        isValid: false,
        isAmbiguous: false,
        reason: "формат даты не распознан",
    };
}
