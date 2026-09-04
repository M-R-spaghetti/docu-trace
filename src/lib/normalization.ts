import { parseDocDate } from "./parseDocDate";

export interface NormalizationSettings {
    dateFormat: 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'raw';
    decimalSeparator: '.' | ',';
    stripCurrency: boolean;
    textCase: 'raw' | 'title' | 'upper' | 'lower';
    aiPrompt: string;
}

export const DEFAULT_NORMALIZATION_SETTINGS: NormalizationSettings = {
    dateFormat: 'DD.MM.YYYY',
    decimalSeparator: '.',
    stripCurrency: false,
    textCase: 'raw',
    aiPrompt: '',
};

const STORAGE_KEY = 'docutrace_normalization_settings';

export function getStoredNormalizationSettings(): NormalizationSettings {
    if (typeof window === 'undefined') return DEFAULT_NORMALIZATION_SETTINGS;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return DEFAULT_NORMALIZATION_SETTINGS;
        const parsed = JSON.parse(stored);
        return {
            ...DEFAULT_NORMALIZATION_SETTINGS,
            ...parsed,
        };
    } catch {
        return DEFAULT_NORMALIZATION_SETTINGS;
    }
}

export function saveNormalizationSettings(settings: NormalizationSettings): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        window.dispatchEvent(new CustomEvent('docutrace_settings_changed', { detail: settings }));
    } catch (e) {
        console.warn('Failed to save normalization settings:', e);
    }
}

/**
 * Normalizes date strings based on selected setting.
 */
export function normalizeDate(rawVal: unknown, format: NormalizationSettings['dateFormat']): string {
    if (rawVal === null || rawVal === undefined) return '—';
    const parsed = parseDocDate(rawVal);
    if (!parsed.isValid) return parsed.display;

    if (format === 'raw') {
        return parsed.raw;
    }

    if (format === 'YYYY-MM-DD') {
        return parsed.iso || parsed.display;
    }

    if (format === 'MM/DD/YYYY') {
        if (parsed.iso) {
            const [y, m, d] = parsed.iso.split('-');
            return `${m}/${d}/${y}`;
        }
        return parsed.display;
    }

    // Default: 'DD.MM.YYYY'
    return parsed.display;
}

/**
 * Normalizes numbers and prices (handles decimal commas/dots, stripping currency symbols).
 */
export function normalizeNumber(
    rawVal: unknown,
    separator: '.' | ',',
    stripCurrency: boolean
): string {
    if (rawVal === null || rawVal === undefined) return '—';
    const str = String(rawVal).trim();
    if (!str || str === '—') return '—';

    let cleaned = str;

    if (stripCurrency) {
        cleaned = cleaned.replace(/[$€£¥₽]|(RM|MYR|USD|EUR|RUB|UAH|PLN|GBP|KZT|тенге|руб\.?|грн\.?)/gi, '').trim();
    }

    const numMatch = cleaned.match(/^-?([0-9\s,.]+)/);
    if (numMatch) {
        let numStr = numMatch[1].replace(/\s+/g, '');
        if (numStr.includes(',') && numStr.includes('.')) {
            if (numStr.lastIndexOf('.') > numStr.lastIndexOf(',')) {
                numStr = numStr.replace(/,/g, '');
            } else {
                numStr = numStr.replace(/\./g, '').replace(',', '.');
            }
        } else if (numStr.includes(',')) {
            numStr = numStr.replace(',', '.');
        }

        const parsedNum = parseFloat(numStr);
        if (!isNaN(parsedNum)) {
            const formattedNum = parsedNum.toFixed(2);
            const withSeparator = separator === ',' ? formattedNum.replace('.', ',') : formattedNum;
            return stripCurrency ? withSeparator : cleaned.replace(numMatch[1], withSeparator);
        }
    }

    return cleaned;
}

/**
 * Normalizes text capitalization.
 */
export function normalizeText(rawVal: unknown, textCase: NormalizationSettings['textCase']): string {
    if (rawVal === null || rawVal === undefined) return '';
    const str = String(rawVal);
    if (!str || textCase === 'raw') return str;

    if (textCase === 'upper') {
        return str.toUpperCase();
    }

    if (textCase === 'lower') {
        return str.toLowerCase();
    }

    if (textCase === 'title') {
        return str.toLowerCase().replace(/(?:^|\s|\/|-)\S/g, match => match.toUpperCase());
    }

    return str;
}

/**
 * Automatically applies appropriate normalization based on column/field semantics.
 */
export function normalizeValue(
    rawVal: unknown,
    colKey: string,
    settings: NormalizationSettings
): string {
    if (rawVal === null || rawVal === undefined) return '—';
    const k = colKey.toLowerCase();

    if (/date|datum|data|день|дата/i.test(k)) {
        return normalizeDate(rawVal, settings.dateFormat);
    }

    if (/price|total|amount|sum|cost|tax|rate|fee|цена|сумма|стоимость|итог/i.test(k)) {
        return normalizeNumber(rawVal, settings.decimalSeparator, settings.stripCurrency);
    }

    if (/quantity|qty|count|кол-во|количество/i.test(k)) {
        return normalizeNumber(rawVal, settings.decimalSeparator, false);
    }

    return normalizeText(rawVal, settings.textCase);
}
