# DocuTrace - AI Document & Financial Data Auditor

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
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment & Production Notes

- **Vercel Serverless Execution Timeout**: The extraction route is configured with `export const maxDuration = 60` to accommodate multi-page documents and spatial vision extraction. Ensure your deployment tier supports functions up to 60 seconds (Vercel Pro or custom server).
- **Payload & Image Compression**: Vercel Serverless has a strict 4.5MB incoming body limit. DocuTrace features an automatic client-side image optimizer that downscales high-resolution camera scans (e.g. 15MB photos from smartphones) to 2048px before transmission, reducing file sizes to ~600KB-1MB with zero quality loss for OCR.
- **PDF Constraints**: PDFs should be under 4.5MB when deployed on Vercel. For self-hosted Docker deployments, the limit can be increased via the `MAX_FILE_SIZE_MB` environment variable.
