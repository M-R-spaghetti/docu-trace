const EVIDENCE_PROPERTIES = {
    raw_text: { type: "string", description: "Дословный текст значения в документе без нормализации" },
    line_context: { type: "string", description: "Строка документа со значением и 5–10 соседними словами" },
    field_type: { type: "string", enum: ["date", "amount", "quantity", "text", "id"], description: "Тип поля для локального сопоставления" },
};

/** Adds grounding evidence to architect-created and reused batch schemas. */
export function addGroundingEvidence(schema: unknown): unknown {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map(addGroundingEvidence);

    const source = schema as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...source };
    if (source.properties && typeof source.properties === "object") {
        const properties = Object.fromEntries(Object.entries(source.properties as Record<string, unknown>)
            .map(([key, value]) => [key, addGroundingEvidence(value)]));
        const isLocatedValue = "value" in properties && "box_2d" in properties && "page" in properties;
        copy.properties = isLocatedValue ? { ...properties, ...EVIDENCE_PROPERTIES } : properties;
        if (isLocatedValue) {
            copy.required = Array.from(new Set([
                ...(Array.isArray(source.required) ? source.required.filter((v): v is string => typeof v === "string") : []),
                "value", "box_2d", "page", "raw_text", "line_context", "field_type",
            ]));
        }
    }
    if (source.items && typeof source.items === "object") copy.items = addGroundingEvidence(source.items);
    return copy;
}
