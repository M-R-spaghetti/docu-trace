# DocuTrace - AI Document & Financial Data Auditor

An intelligent document analysis and data extraction platform powered by Google Gemini 2.5 Flash with spatial vision capabilities. Designed for accounting, invoice auditing, and financial document extraction.

## Features
- **Dynamic Schema Generation**: Translates natural language queries into strict JSON Schemas on the fly.
- **Forensic Spatial Extraction**: Extracts critical numbers, line items, totals, and metadata with exact 2D bounding boxes (`[ymin, xmin, ymax, xmax]`) and page references.
- **Interactive Visual Overlay**: Highlights extracted values with bounding boxes directly on rendered document pages (PDF and images).
- **Multiple Output Formats**: Supports structured tables, narrative reports, and hybrid summaries.
- **Session History & Refinement**: Local history tracking and iterative prompt refinement.

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
