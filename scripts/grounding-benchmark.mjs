import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] || "benchmarks/grounding/annotations.json");
if (!fs.existsSync(input)) {
    console.error(`Grounding benchmark dataset is missing: ${input}\nCopy annotations.example.json to annotations.json and annotate 40–50 real documents.`);
    process.exit(2);
}
const records = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(records) || !records.length) throw new Error("Benchmark input must be a non-empty JSON array.");
const center = box => ({ x: (box[1] + box[3]) / 2, y: (box[0] + box[2]) / 2 });
const intersectsRow = (prediction, truth) => {
    const p = center(prediction);
    return p.y >= truth[0] && p.y <= truth[2];
};
const groups = new Map();
for (const row of records) {
    const group = groups.get(row.category) || { total: 0, correct: 0, fallback: 0, time: 0 };
    group.total++;
    if (intersectsRow(row.predicted_box, row.expected_box)) group.correct++;
    if (row.used_fallback) group.fallback++;
    group.time += Number(row.time_ms) || 0;
    groups.set(row.category, group);
}
const total = [...groups.values()].reduce((sum, group) => ({ total: sum.total + group.total, correct: sum.correct + group.correct, fallback: sum.fallback + group.fallback, time: sum.time + group.time }), { total: 0, correct: 0, fallback: 0, time: 0 });
console.table([...groups, ["ALL", total]].map(([category, group]) => ({
    category,
    fields: group.total,
    "correct row %": (group.correct / group.total * 100).toFixed(1),
    "fallback %": (group.fallback / group.total * 100).toFixed(1),
    "avg ms": (group.time / group.total).toFixed(1),
})));
if (new Set(records.map(row => row.document)).size < 40) {
    console.warn("Warning: fewer than 40 distinct real documents; results are directional only.");
}
