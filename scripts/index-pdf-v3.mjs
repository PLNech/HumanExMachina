#!/usr/bin/env node
/**
 * PDF Indexing Script v3 - Full Book Ontology
 * Uses official chapter structure from humanmachine.com
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
  indexName: process.env.ALGOLIA_INDEX || 'machina_v3',
  chunkSize: 800,
  chunkOverlap: 150,
};

// Official book ontology from humanmachine.com
const BOOK_ONTOLOGY = {
  sections: ['Comprendre', 'Agir'],
  chapters: [
    {
      title: "S'accepter",
      section: 'Comprendre',
      startPage: 35,
      subsections: ['Des hauts... et des bas', 'Relâcher la pression', "L'équilibre et le mouvement"],
      themes: ['acceptation', 'pression', 'équilibre', 'mouvement']
    },
    {
      title: "L'humain plus humain",
      section: 'Comprendre',
      startPage: 47,
      subsections: ["La dynamique de l'ignorance", "Pratiquer l'honnêteté", 'Raison et émotion', 'Vers un pilotage manuel', 'Facteurs déclencheurs et conditions du changement'],
      themes: ['ignorance', 'honnêteté', 'émotion', 'raison', 'changement']
    },
    {
      title: "L'humain comme personne",
      section: 'Comprendre',
      startPage: 67,
      subsections: ["L'honnêteté positive", 'Sourire, pourquoi ?', "Libérer son esprit", "S'organiser et planifier", 'Une tête bien faite', 'Se connaître soi-même', 'Des contradictions bénéfiques'],
      themes: ['honnêteté positive', 'sourire', 'esprit', 'organisation', 'connaissance de soi', 'contradictions']
    },
    {
      title: 'Maîtriser le temps, maîtriser ses journées',
      section: 'Agir',
      startPage: 95,
      subsections: ['Planifier et organiser', 'Les phases de travail', "S'engager et fixer des limites", 'Dire « non »', 'Maîtriser son temps', "L'intérêt des routines et des habitudes"],
      themes: ['temps', 'planification', 'phases de travail', 'limites', 'non', 'routines', 'habitudes']
    },
    {
      title: 'Les règles de vie en entreprise',
      section: 'Agir',
      startPage: 133,
      subsections: ['Être explicite', 'Le dilemme des réunions', "Les bienfaits de l'intensité et de la désynchronisation"],
      themes: ['entreprise', 'communication', 'explicite', 'réunions', 'intensité', 'désynchronisation']
    },
    {
      title: 'Utiliser sa machine',
      section: 'Agir',
      startPage: 157,
      subsections: ['Comment prendre des décisions', 'Gérer les opportunités', 'Progresser encore', 'Résister à la pression', 'Prévenir les interruptions', 'Corriger ses faiblesses'],
      themes: ['décisions', 'opportunités', 'progrès', 'pression', 'interruptions', 'faiblesses']
    },
    {
      title: "Vers une meilleure version de l'entreprise",
      section: 'Agir',
      startPage: 191,
      subsections: ['Complexité et détérioration', "S'élever et s'indigner", 'Ne pas capituler'],
      themes: ['entreprise', 'complexité', 'amélioration', 'persévérance']
    },
    {
      title: 'Envisager le long terme',
      section: 'Agir',
      startPage: 201,
      subsections: ['Succès et bonheur', 'Critiquer et progresser', 'La chance et ses effets cumulés'],
      themes: ['long terme', 'succès', 'bonheur', 'critique', 'chance']
    }
  ]
};

function getChapterForPage(pageNum) {
  const chapters = BOOK_ONTOLOGY.chapters;
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (pageNum >= chapters[i].startPage) {
      return chapters[i];
    }
  }
  return { title: 'Préambule', section: 'Introduction', themes: ['introduction'], subsections: [] };
}

function detectContentType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('en bref') && text.includes('•')) return 'summary';
  if (lower.includes('pratique et étapes') || /^\s*\d\)\s/.test(text)) return 'practice';
  if (/^chapitre\s+\d/i.test(text.trim())) return 'chapter_intro';
  if (lower.includes('bibliographie')) return 'bibliography';
  return 'content';
}

function detectSubsection(text, chapter) {
  if (!chapter.subsections) return null;
  const lower = text.toLowerCase();
  for (const sub of chapter.subsections) {
    if (lower.includes(sub.toLowerCase())) {
      return sub;
    }
  }
  return null;
}

function chunkText(text, chunkSize, overlap) {
  const chunks = [];

  // Normalize whitespace but preserve paragraph breaks (double newlines)
  text = text.replace(/[ \t]+/g, ' '); // Collapse horizontal whitespace
  text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
  text = text.trim();

  // Split into paragraphs first, then sentences
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';
  let overlapBuffer = [];

  for (const para of paragraphs) {
    // Split paragraph into sentences (French-aware)
    const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
    const sentences = para.match(sentenceRegex) || [para];

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;

      // If adding this sentence exceeds chunk size, save current and start new
      if (currentChunk.length + s.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());

        // Build overlap from recent sentences
        currentChunk = overlapBuffer.join(' ') + ' ' + s;
        overlapBuffer = [s];
      } else {
        currentChunk += (currentChunk ? ' ' : '') + s;

        // Keep track of recent sentences for overlap
        overlapBuffer.push(s);
        const overlapLen = overlapBuffer.join(' ').length;
        while (overlapLen > overlap && overlapBuffer.length > 1) {
          overlapBuffer.shift();
        }
      }
    }

    // Add paragraph break marker if we're continuing
    if (currentChunk && currentChunk.length < chunkSize * 0.8) {
      currentChunk += '\n\n';
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
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

    // Preserve paragraph structure by detecting Y-position changes
    let text = '';
    let lastY = null;
    const LINE_THRESHOLD = 5; // pixels difference to consider new line
    const PARA_THRESHOLD = 15; // larger gap = new paragraph

    for (const item of content.items) {
      if (!item.str) continue;

      const y = item.transform ? item.transform[5] : null;

      if (lastY !== null && y !== null) {
        const yDiff = Math.abs(lastY - y);
        if (yDiff > PARA_THRESHOLD) {
          // New paragraph - double newline
          text += '\n\n';
        } else if (yDiff > LINE_THRESHOLD) {
          // New line within paragraph
          text += ' ';
        } else if (item.str.startsWith(' ') || text.endsWith(' ')) {
          // Same line, already spaced
        } else {
          text += ' ';
        }
      }

      text += item.str;
      lastY = y;
    }

    pages.push({ pageNum: i, text: text.trim() });
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
    if (!text || text.length < 50) continue;

    const chapter = getChapterForPage(pageNum);
    const contentType = detectContentType(text);
    const subsection = detectSubsection(text, chapter);
    const chunks = chunkText(text, CONFIG.chunkSize, CONFIG.chunkOverlap);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      records.push({
        objectID: `${fileName}-p${pageNum}-c${i}`,
        content: chunk,
        page: pageNum,
        // Ontology fields for faceting
        chapter: chapter.title,
        section: chapter.section,
        subsection: subsection,
        contentType,
        themes: chapter.themes || [],
        // For display
        title: `${chapter.title} (p.${pageNum})`,
        source: fileName,
        documentId: fileName,
        // For Recommend CBF
        _tags: [chapter.section, chapter.title, contentType, ...(chapter.themes || [])].filter(Boolean),
      });
    }
  }

  // Stats
  const stats = {
    total: records.length,
    bySection: {},
    byChapter: {},
    byType: {}
  };
  records.forEach(r => {
    stats.bySection[r.section] = (stats.bySection[r.section] || 0) + 1;
    stats.byChapter[r.chapter] = (stats.byChapter[r.chapter] || 0) + 1;
    stats.byType[r.contentType] = (stats.byType[r.contentType] || 0) + 1;
  });
  console.log('Stats:', JSON.stringify(stats, null, 2));

  return records;
}

async function indexToAlgolia(records) {
  if (!CONFIG.apiKey) {
    console.error('Error: ALGOLIA_ADMIN_KEY required');
    process.exit(1);
  }

  const client = algoliasearch(CONFIG.applicationId, CONFIG.apiKey);
  console.log(`Indexing ${records.length} records to ${CONFIG.indexName}...`);

  // Configure index settings optimized for RAG + Recommend
  await client.setSettings({
    indexName: CONFIG.indexName,
    indexSettings: {
      searchableAttributes: ['content', 'title', 'chapter', 'themes', 'subsection'],
      attributesForFaceting: [
        'section',
        'chapter',
        'subsection',
        'contentType',
        'themes',
        'filterOnly(documentId)',
        'filterOnly(page)'
      ],
      attributeForDistinct: 'page',
      distinct: 1,
      // Highlighting
      attributesToHighlight: ['content'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToSnippet: ['content:100'],
      // Better French search
      removeWordsIfNoResults: 'allOptional',
      queryLanguages: ['fr'],
      indexLanguages: ['fr'],
    },
  });

  await client.saveObjects({
    indexName: CONFIG.indexName,
    objects: records,
  });

  console.log(`Indexed successfully to ${CONFIG.indexName}`);
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
    console.log('\nSample record:');
    console.log(JSON.stringify(records.find(r => r.contentType === 'content'), null, 2));
    console.log('\nTo index: ALGOLIA_ADMIN_KEY=xxx node scripts/index-pdf-v3.mjs');
    return;
  }

  await indexToAlgolia(records);
}

main().catch(console.error);
