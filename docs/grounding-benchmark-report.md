# Grounding benchmark

## Metric

The primary metric is whether the centre of the displayed highlight lands inside the manually annotated text row. The harness also reports fallback rate and average client/fallback latency by document category.

## Required dataset

Use 40–50 real documents split across clear, faded, skewed, repeated-value, dense-table and scanned-PDF categories. Do not use UI screenshots as source documents. Copy `benchmarks/grounding/annotations.example.json` to `annotations.json`, record the app output, then run `npm run benchmark:grounding`.

## Current result

No real receipt corpus is stored in this repository, so a statistically meaningful field-accuracy percentage cannot be reported honestly yet. The deterministic unit suite covers line detection, adaptive thresholding, fuzzy OCR confusions, duplicate-value disambiguation and distant PDF matches. It is a regression gate, not a substitute for the real 40–50 document benchmark.
