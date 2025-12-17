#!/usr/bin/env node
/**
 * Extract key concepts from chunks using LLM
 * Updates Algolia index with extracted concepts
 */

import { algoliasearch } from 'algoliasearch';

const CONFIG = {
  algoliaAppId: process.env.ALGOLIA_APP_ID || 'latency',
  algoliaApiKey: process.env.ALGOLIA_ADMIN_KEY,
  indexName: process.env.ALGOLIA_INDEX || 'machina_v3',
  llmEndpoint: 'https://openai.api.enablers.algolia.net/v1/chat/completions',
  llmKey: process.env.LLM_API_KEY,
  llmModel: 'qwen3-coder-30b-fp16',
  batchSize: 10,
  delayMs: 500, // Rate limiting
};

async function extractConcepts(text) {
  const response = await fetch(CONFIG.llmEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.llmKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CONFIG.llmModel,
      messages: [{
        role: 'user',
        content: `Extract 3-5 key concepts from this French text about personal/professional development. Return ONLY a JSON array of French strings, no explanation.

Text: "${text.slice(0, 600)}"`
      }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';

  try {
    // Parse JSON, handle potential markdown wrapping
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Parse error:', content);
    return [];
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (!CONFIG.algoliaApiKey || !CONFIG.llmKey) {
    console.error('Required: ALGOLIA_ADMIN_KEY and LLM_API_KEY');
    process.exit(1);
  }

  const client = algoliasearch(CONFIG.algoliaAppId, CONFIG.algoliaApiKey);

  // Fetch all records
  console.log('Fetching records from index...');
  let allHits = [];
  let page = 0;

  while (true) {
    const { results } = await client.search({
      requests: [{
        indexName: CONFIG.indexName,
        query: '',
        hitsPerPage: 100,
        page,
        attributesToRetrieve: ['objectID', 'content', 'chapter', 'themes'],
      }]
    });

    const hits = results[0].hits;
    if (hits.length === 0) break;

    allHits = allHits.concat(hits);
    page++;
    console.log(`Fetched page ${page}, total: ${allHits.length} records`);
  }

  console.log(`\nProcessing ${allHits.length} records...`);

  // Track all concepts for later analysis
  const conceptCounts = {};
  const updates = [];

  for (let i = 0; i < allHits.length; i++) {
    const hit = allHits[i];

    if (!hit.content || hit.content.length < 50) {
      console.log(`[${i + 1}/${allHits.length}] Skipping ${hit.objectID} (too short)`);
      continue;
    }

    try {
      console.log(`[${i + 1}/${allHits.length}] Processing ${hit.objectID}...`);
      const concepts = await extractConcepts(hit.content);

      // Count concept occurrences
      concepts.forEach(c => {
        const normalized = c.toLowerCase().trim();
        conceptCounts[normalized] = (conceptCounts[normalized] || 0) + 1;
      });

      updates.push({
        objectID: hit.objectID,
        concepts: concepts,
        // Update _tags for Recommend
        _tags: [
          ...(hit.themes || []),
          ...concepts.map(c => c.toLowerCase()),
        ].filter((v, i, a) => a.indexOf(v) === i), // dedupe
      });

      // Rate limiting
      await sleep(CONFIG.delayMs);

    } catch (e) {
      console.error(`Error processing ${hit.objectID}:`, e.message);
    }

    // Batch save every N records
    if (updates.length >= CONFIG.batchSize) {
      console.log(`Saving batch of ${updates.length} records...`);
      await client.partialUpdateObjects({
        indexName: CONFIG.indexName,
        objects: updates,
        createIfNotExists: false,
      });
      updates.length = 0;
    }
  }

  // Save remaining
  if (updates.length > 0) {
    console.log(`Saving final batch of ${updates.length} records...`);
    await client.partialUpdateObjects({
      indexName: CONFIG.indexName,
      objects: updates,
      createIfNotExists: false,
    });
  }

  // Print top concepts
  console.log('\n--- Top 50 Concepts ---');
  const sorted = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  sorted.forEach(([concept, count], i) => {
    console.log(`${i + 1}. ${concept} (${count})`);
  });

  // Update index settings to make concepts searchable/facetable
  console.log('\nUpdating index settings...');
  await client.setSettings({
    indexName: CONFIG.indexName,
    indexSettings: {
      searchableAttributes: ['content', 'title', 'chapter', 'themes', 'concepts'],
      attributesForFaceting: [
        'section',
        'chapter',
        'subsection',
        'contentType',
        'themes',
        'concepts',
        'filterOnly(documentId)',
        'filterOnly(page)'
      ],
    },
  });

  console.log('\nDone!');
}

main().catch(console.error);
