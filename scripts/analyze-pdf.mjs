#!/usr/bin/env node
import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function analyze() {
  const data = new Uint8Array(fs.readFileSync('EP3_HumanMachine.pdf'));
  const doc = await getDocument({ data }).promise;

  console.log('Total pages:', doc.numPages);

  // Extract pages to understand structure
  for (let i = 1; i <= Math.min(20, doc.numPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ').trim();
    console.log(`\n=== Page ${i} ===`);
    console.log(text.slice(0, 600));
  }

  // Check last pages for lexique/bibliography
  console.log('\n\n=== LAST PAGES (potential glossary/bibliography) ===');
  for (let i = Math.max(1, doc.numPages - 5); i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ').trim();
    console.log(`\n=== Page ${i} ===`);
    console.log(text.slice(0, 600));
  }

  await doc.destroy();
}

analyze();
