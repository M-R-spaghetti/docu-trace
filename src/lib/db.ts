import { BoundingBox, GroundingStatus, VerificationStateMap } from "@/lib/types";

export interface HistoryRecord {
    id: string;
    sessionId: string;
    file: File;
    prompt: string;
    format: string;
    extractedData: any;
    verificationState?: VerificationStateMap;
    timestamp: number;
    batchInfo?: {
        totalFiles: number;
        fileNames: string[];
        fileSizes?: number[];
    };
    batchRows?: any[];
    batchSchema?: any;
    batchFiles?: File[];
}

const DB_NAME = 'docutrace_db';
const STORE_NAME = 'history';
const GROUNDING_STORE_NAME = 'grounding';

export interface GroundingCacheRecord {
    id: string;
    box_2d: BoundingBox;
    status: GroundingStatus;
    source: "pdf_text" | "projection" | "approximate" | "gemini_fallback";
    updatedAt: number;
}

export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(GROUNDING_STORE_NAME)) {
                db.createObjectStore(GROUNDING_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

export const getGroundingCache = async (id: string): Promise<GroundingCacheRecord | null> => {
    if (typeof indexedDB === "undefined") return null;
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(GROUNDING_STORE_NAME, "readonly").objectStore(GROUNDING_STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
};

export const saveGroundingCache = async (record: GroundingCacheRecord): Promise<void> => {
    if (typeof indexedDB === "undefined") return;
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(GROUNDING_STORE_NAME, "readwrite").objectStore(GROUNDING_STORE_NAME).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const saveHistory = async (record: HistoryRecord): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const getHistory = async (): Promise<HistoryRecord[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            const results = req.result as HistoryRecord[];
            resolve(results.sort((a, b) => b.timestamp - a.timestamp));
        };
        req.onerror = () => reject(req.error);
    });
};

export const updateHistory = async (id: string, updates: Partial<HistoryRecord>): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const existing = getReq.result;
            if (existing) {
                const updated = { ...existing, ...updates };
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            } else {
                resolve();
            }
        };
        getReq.onerror = () => reject(getReq.error);
    });
};

export const deleteHistory = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const clearAllHistory = async (): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};
