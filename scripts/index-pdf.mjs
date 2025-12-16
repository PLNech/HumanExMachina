#!/usr/bin/env node
/**
 * PDF Indexing Script for Algolia
 * Extracts text from PDF, chunks it with overlap, and pushes to Algolia index
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { algoliasearch } from 'algoliasearch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration - Index naming: machina_XXX
const CONFIG = {
  applicationId: process.env.ALGOLIA_APP_ID || 'latency',
  apiKey: process.env.ALGOLIA_ADMIN_KEY, // Admin key for indexing
  indexName: process.env.ALGOLIA_INDEX || 'machina_pdf',
  chunkSize: 1000, // characters per chunk
  chunkOverlap: 200, // overlap between chunks
};

/**
 * Split text into overlapping chunks
 */
function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;

  // Clean up text
  text = text.replace(/\s+/g, ' ').trim();

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > chunkSize * 0.5) {
        chunk = chunk.slice(0, breakPoint + 1);
      }
    }

    chunks.push(chunk.trim());
    start = start + chunk.length - overlap;

    if (start >= text.length - overlap) break;
  }

  return chunks;
}

/**
 * Extract text by page from PDF using pdfjs-dist
 */
async function extractPdfText(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = new Uint8Array(dataBuffer);

  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const numPages = doc.numPages;
  const textParts = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    textParts.push(pageText);
  }

  const metadata = await doc.getMetadata().catch(() => ({}));
  await doc.destroy();

  return {
    text: textParts.join('\n\n'),
    numPages,
    info: metadata?.info || {},
  };
}

/**
 * Create Algolia records from PDF
 */
async function createRecords(pdfPath) {
  console.log(`Reading PDF: ${pdfPath}`);
  const { text, numPages, info } = await extractPdfText(pdfPath);

  console.log(`Extracted ${text.length} characters from ${numPages} pages`);

  const chunks = chunkText(text, CONFIG.chunkSize, CONFIG.chunkOverlap);
  console.log(`Created ${chunks.length} chunks`);

  const fileName = path.basename(pdfPath, '.pdf');

  return chunks.map((content, index) => ({
    objectID: `${fileName}-chunk-${index}`,
    content,
    title: info?.Title || fileName,
    source: fileName,
    chunkIndex: index,
    totalChunks: chunks.length,
    documentId: fileName,
  }));
}

/**
 * Push records to Algolia with proper settings
 */
async function indexToAlgolia(records) {
  if (!CONFIG.apiKey) {
    console.error('Error: ALGOLIA_ADMIN_KEY environment variable required');
    console.log('\nUsage:');
    console.log('  ALGOLIA_ADMIN_KEY=your-admin-key node scripts/index-pdf.mjs');
    process.exit(1);
  }

  const client = algoliasearch(CONFIG.applicationId, CONFIG.apiKey);

  console.log(`Indexing ${records.length} records to ${CONFIG.indexName}...`);

  // Configure index settings for RAG
  await client.setSettings({
    indexName: CONFIG.indexName,
    indexSettings: {
      searchableAttributes: ['content', 'title'],
      attributesForFaceting: ['filterOnly(documentId)', 'filterOnly(source)'],
      attributeForDistinct: 'documentId',
      distinct: 1,
    },
  });

  // Batch save records
  const result = await client.saveObjects({
    indexName: CONFIG.indexName,
    objects: records,
  });

  console.log(`Indexed successfully!`);
  console.log(`Index: ${CONFIG.indexName}`);
  console.log(`Records: ${records.length}`);
}

async function main() {
  const pdfPath = process.argv[2] || path.join(__dirname, '..', 'EP3_HumanMachine.pdf');

  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const records = await createRecords(pdfPath);

  // Preview mode if no API key
  if (!CONFIG.apiKey) {
    console.log('\n--- Preview Mode (no ALGOLIA_ADMIN_KEY) ---');
    console.log(`Would index ${records.length} records`);
    console.log('\nFirst record preview:');
    console.log(JSON.stringify(records[0], null, 2));
    console.log('\nTo index, run:');
    console.log('  ALGOLIA_ADMIN_KEY=your-admin-key node scripts/index-pdf.mjs');
    return;
  }

  await indexToAlgolia(records);
}

main().catch(console.error);
