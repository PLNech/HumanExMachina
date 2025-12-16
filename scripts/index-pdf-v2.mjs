#!/usr/bin/env node
/**
 * PDF Indexing Script v2 - Structured Book Indexing
 * Extracts chapters, summaries, practice sections with proper metadata
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { algoliasearch } from 'algoliasearch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  applicationId: process.env.ALGOLIA_APP_ID || 'latency',
  apiKey: process.env.ALGOLIA_ADMIN_KEY,
  indexName: process.env.ALGOLIA_INDEX || 'machina_pdf_v2',
  chunkSize: 800,
  chunkOverlap: 150,
};

// Book structure from TOC
const CHAPTERS = [
  { num: 0, title: 'Préambule', section: 'Introduction', startPage: 11 },
  { num: 1, title: "S'accepter", section: 'Comprendre', startPage: 35 },
  { num: 2, title: "L'humain plus humain", section: 'Comprendre', startPage: 47 },
  { num: 3, title: "L'humain comme personne", section: 'Comprendre', startPage: 67 },
  { num: 4, title: 'Maîtriser le temps, maîtriser ses journées', section: 'Agir', startPage: 95 },
  { num: 5, title: 'Les règles de vie en entreprise', section: 'Agir', startPage: 133 },
  { num: 6, title: 'Utiliser sa machine', section: 'Agir', startPage: 157 },
  { num: 7, title: "Vers une meilleure version de l'entreprise", section: 'Agir', startPage: 191 },
  { num: 8, title: 'Conclusion', section: 'Conclusion', startPage: 219 },
  { num: 9, title: 'Bibliographie', section: 'Annexes', startPage: 225 },
];

function getChapterForPage(pageNum) {
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    if (pageNum >= CHAPTERS[i].startPage) {
      return CHAPTERS[i];
    }
  }
  return { num: -1, title: 'Préface', section: 'Introduction', startPage: 1 };
}

function detectContentType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('en bref') && text.includes('•')) return 'summary';
  if (lower.includes('pratique et étapes') || /^\d\)\s/.test(text)) return 'practice';
  if (/^chapitre\s+\d/i.test(text.trim())) return 'chapter_intro';
  if (lower.includes('bibliographie')) return 'bibliography';
  if (lower.includes('sommaire')) return 'toc';
  return 'content';
}

function extractTags(text, chapter) {
  const tags = new Set();

  // Add section tag
  if (chapter.section) tags.add(chapter.section.toLowerCase());

  // Key themes detection
  const themes = {
    'temps': ['temps', 'journée', 'agenda', 'planning', 'routine'],
    'organisation': ['organiser', 'planifier', 'structur', 'méthode'],
    'décision': ['décision', 'décider', 'choix', 'choisir'],
    'communication': ['communic', 'email', 'réunion', 'échange'],
    'leadership': ['leader', 'manager', 'équipe', 'collabor'],
    'productivité': ['productif', 'efficace', 'performance', 'résultat'],
    'développement personnel': ['soi-même', 'personnel', 'progrès', 'améliorer'],
    'pression': ['pression', 'stress', 'équilibre'],
    'habitudes': ['habitude', 'routine', 'quotidien'],
  };

  const lower = text.toLowerCase();
  for (const [tag, keywords] of Object.entries(themes)) {
    if (keywords.some(k => lower.includes(k))) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  text = text.replace(/\s+/g, ' ').trim();

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

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

async function extractPdfPages(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = new Uint8Array(dataBuffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ').trim();
    pages.push({ pageNum: i, text });
  }

  await doc.destroy();
  return pages;
}

async function createRecords(pdfPath) {
  console.log(`Reading PDF: ${pdfPath}`);
  const pages = await extractPdfPages(pdfPath);
  console.log(`Extracted ${pages.length} pages`);

  const records = [];
  const fileName = path.basename(pdfPath, '.pdf');

  for (const { pageNum, text } of pages) {
    if (!text || text.length < 50) continue; // Skip empty/title pages

    const chapter = getChapterForPage(pageNum);
    const contentType = detectContentType(text);
    const chunks = chunkText(text, CONFIG.chunkSize, CONFIG.chunkOverlap);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const tags = extractTags(chunk, chapter);

      records.push({
        objectID: `${fileName}-p${pageNum}-c${i}`,
        content: chunk,
        page: pageNum,
        chapter: chapter.title,
        chapterNum: chapter.num,
        section: chapter.section,
        contentType,
        tags,
        // For highlighting
        title: `${chapter.title} (p.${pageNum})`,
        source: fileName,
        documentId: fileName,
      });
    }
  }

  // Log stats
  const types = {};
  records.forEach(r => { types[r.contentType] = (types[r.contentType] || 0) + 1; });
  console.log(`Created ${records.length} records`);
  console.log('Content types:', types);

  return records;
}

async function indexToAlgolia(records) {
  if (!CONFIG.apiKey) {
    console.error('Error: ALGOLIA_ADMIN_KEY required');
    process.exit(1);
  }

  const client = algoliasearch(CONFIG.applicationId, CONFIG.apiKey);
  console.log(`Indexing ${records.length} records to ${CONFIG.indexName}...`);

  // Configure index settings for RAG with highlighting
  await client.setSettings({
    indexName: CONFIG.indexName,
    indexSettings: {
      searchableAttributes: ['content', 'title', 'chapter', 'tags'],
      attributesForFaceting: [
        'filterOnly(documentId)',
        'section',
        'chapter',
        'contentType',
        'tags'
      ],
      attributeForDistinct: 'page',
      distinct: 1,
      // Highlighting
      attributesToHighlight: ['content'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToSnippet: ['content:80'],
      // Better search
      removeWordsIfNoResults: 'allOptional',
      queryLanguages: ['fr'],
      indexLanguages: ['fr'],
    },
  });

  const result = await client.saveObjects({
    indexName: CONFIG.indexName,
    objects: records,
  });

  console.log(`Indexed successfully to ${CONFIG.indexName}`);
  console.log(`Records: ${records.length}`);
}

async function main() {
  const pdfPath = process.argv[2] || path.join(__dirname, '..', 'EP3_HumanMachine.pdf');

  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const records = await createRecords(pdfPath);

  if (!CONFIG.apiKey) {
    console.log('\n--- Preview Mode ---');
    console.log(`Would index ${records.length} records`);
    console.log('\nSample records:');

    // Show one of each type
    const shown = new Set();
    for (const r of records) {
      if (!shown.has(r.contentType)) {
        console.log(`\n[${r.contentType}] ${r.title}`);
        console.log(`Tags: ${r.tags.join(', ')}`);
        console.log(`Content: ${r.content.slice(0, 200)}...`);
        shown.add(r.contentType);
      }
    }
    console.log('\nTo index: ALGOLIA_ADMIN_KEY=xxx node scripts/index-pdf-v2.mjs');
    return;
  }

  await indexToAlgolia(records);
}

main().catch(console.error);
