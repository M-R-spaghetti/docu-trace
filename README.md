# DocuTrace - AI Document & Financial Data Auditor

> 🌐 **Live Demo**: [https://docu-trace-gray.vercel.app](https://docu-trace-gray.vercel.app)

An intelligent document analysis and data extraction platform powered by Google Gemini 2.5 Flash with spatial vision capabilities. Designed for accounting, invoice auditing, and financial document extraction.

## Features
- **Dynamic Schema Generation**: Translates natural language queries into strict JSON Schemas on the fly.
- **Forensic Spatial Extraction**: Extracts critical numbers, line items, totals, and metadata with exact 2D bounding boxes (`[ymin, xmin, ymax, xmax]`) and page references.
- **Interactive Visual Overlay**: Highlights extracted values with bounding boxes directly on rendered document pages (PDF and images).
- **Multiple Output Formats**: Supports structured tables, narrative reports, and hybrid summaries.
- **Multi-Format Verified Export**: Instant export of human-verified data to Excel-optimized CSV (UTF-8 BOM, semicolon delimiter for Cyrillic/European Excel), styled Excel spreadsheets (.xls), or clean structured JSON.
- **Session History & Refinement**: Local history tracking in IndexedDB and iterative prompt refinement.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Frontend**: React 19, Tailwind CSS, Framer Motion, Lucide Icons, Radix UI
- **AI / Vision**: Google Gemini 2.5 Flash (`@google/genai`)
- **Document Rendering**: `react-pdf`, `react-dropzone`

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/M-R-spaghetti/docu-trace.git
   cd docu-trace
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

   For a private deployment, also protect the entire site and API:
   ```env
   APP_BASIC_AUTH_USER=docutrace
   APP_BASIC_AUTH_PASSWORD=replace_with_a_long_random_password
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment & Production Notes

- **Vercel Serverless Execution Timeout**: The extraction route is configured with `export const maxDuration = 60` to accommodate multi-page documents and spatial vision extraction. Ensure your deployment tier supports functions up to 60 seconds (Vercel Pro or custom server).
- **Payload & Image Compression**: The default API limit is 4MB to stay below common serverless request-body limits. DocuTrace compresses large camera scans client-side to 2048px before transmission. Compression is lossy and may affect very small text; keep original scans available for human verification.
- **PDF Constraints**: Source PDFs may be up to 25MB and are split into smaller requests. Every generated request chunk must stay below 4MB.
- **Batch Constraints**: Up to 100 source documents and 500MB total per package. All limits are defined centrally in `src/lib/uploadLimits.ts`, ready for future free/paid plan profiles.
- **Abuse protection**: API routes apply per-IP burst, sustained-rate, and concurrent-request limits. The built-in limiter is per application instance; use a shared Redis-backed limiter before running many server instances.

## Privacy & Data Handling

- Uploaded documents are sent to the configured Google Gemini API for extraction and coordinate grounding. Do not upload documents unless you are authorized to share them with that provider.
- Session history and original file blobs are stored locally in the browser's IndexedDB. They are not encrypted by DocuTrace and remain available to other users of the same browser profile.
- Use **Clear history** in the application, or clear the site's browser storage, to remove locally stored sessions and document blobs.
- JSON and spreadsheet exports may contain sensitive source data. Store and share exported files according to your organization's retention policy.

## Quality Checks

Run the complete local verification suite before deployment:

```bash
npm run check
```

This runs unit tests, TypeScript, ESLint, and a production Next.js build.
