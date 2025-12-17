#!/usr/bin/env node
/**
 * Add short French titles to each segment using LLM
 * Uses Agent Studio OpenAI-compatible endpoint
 */

import 'dotenv/config';
import { algoliasearch } from 'algoliasearch';

const {
  ALGOLIA_APP_ID = 'latency',
  ALGOLIA_ADMIN_KEY,
  ALGOLIA_INDEX = 'machina_v3',
  LLM_API_KEY,
} = process.env;

if (!ALGOLIA_ADMIN_KEY || !LLM_API_KEY) {
  console.error('Missing ALGOLIA_ADMIN_KEY or LLM_API_KEY');
  process.exit(1);
}

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY);

// Book context for the LLM
const BOOK_CONTEXT = `
LIVRE: "Human Ex Machina" de Jean de La Rochebrochard

STRUCTURE:
- COMPRENDRE (p.35-92): S'accepter, L'humain plus humain, L'humain comme personne
- AGIR (p.95-218): Maîtriser le temps, Règles en entreprise, Utiliser sa machine

THÈMES CLÉS:
• Équilibre vie pro/perso comme fondement du succès
• Maîtrise du temps via périmètres et phases (productive, interactive, inductive)
• Honnêteté positive et communication explicite
• Progression par petits pas et transformation progressive
• Auto-observation et prise de recul
• Décision = trancher (du latin decidere)
• La "machine humaine" = organisation solide + vie personnelle épanouie

STYLE JEAN:
- Direct, pragmatique, ancré dans le concret
- Utilise étymologie et philosophie pour éclairer
- Propose des cadres d'action clairs
`;

const SYSTEM_PROMPT = `Tu es un assistant expert du livre "Human Ex Machina".

${BOOK_CONTEXT}

TÂCHE: Génère un TITRE COURT (3-6 mots) en français pour chaque extrait.

RÈGLES:
- Le titre doit capturer l'ESSENCE du passage
- Style direct et percutant, inspiré de Jean
- Pas de ponctuation finale
- Commence souvent par un verbe à l'infinitif ou un nom
- Évite les titres génériques ("Le temps", "La vie")
- Préfère les titres actionnables ou évocateurs

EXEMPLES DE BONS TITRES:
- "Définir ses périmètres de temps"
- "L'art de dire non"
- "Transformer la pression en énergie"
- "Équilibrer sans sacrifier"
- "Maîtriser son agenda quotidien"
- "La force des petits pas"
`;

async function generateTitle(content, chapter, section, page) {
  const response = await fetch('https://openai.api.enablers.algolia.net/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen3-coder-30b-fp16',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Chapitre: ${chapter}
Section: ${section}
Page: ${page}

EXTRAIT:
"${content.slice(0, 800)}"

Génère UN titre court (3-6 mots) pour cet extrait. Réponds UNIQUEMENT avec le titre, rien d'autre.`
        }
      ],
      temperature: 0.7,
      max_tokens: 30,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const title = data.choices?.[0]?.message?.content?.trim();

  // Clean up: remove quotes, periods, extra whitespace
  return title?.replace(/^["«]|["»]$/g, '').replace(/\.$/, '').trim();
}

async function processRecords() {
  console.log('📖 Fetching records from index...');

  // Use searchSingleIndex with pagination
  const records = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX,
      searchParams: {
        query: '',
        hitsPerPage: 100,
        page,
        attributesToRetrieve: ['objectID', 'content', 'chapter', 'section', 'page', 'shortTitle'],
      },
    });
    records.push(...res.hits);
    page++;
    hasMore = page < res.nbPages;
    console.log(`  Fetched page ${page}/${res.nbPages} (${records.length} records)`);
  }

  console.log(`Found ${records.length} records total`);

  // Filter records without shortTitle
  const toProcess = records.filter(r => !r.shortTitle && r.content);
  console.log(`${toProcess.length} records need titles`);

  if (toProcess.length === 0) {
    console.log('✅ All records already have titles');
    return;
  }

  const updates = [];
  const batchSize = 5; // Process 5 at a time to avoid rate limits

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (record) => {
        try {
          const title = await generateTitle(
            record.content,
            record.chapter || 'Préambule',
            record.section || 'Introduction',
            record.page || '?'
          );

          console.log(`  [${record.page}] "${title}"`);

          return {
            objectID: record.objectID,
            shortTitle: title,
          };
        } catch (err) {
          console.error(`  Error for ${record.objectID}:`, err.message);
          return null;
        }
      })
    );

    updates.push(...results.filter(Boolean));

    // Progress
    const progress = Math.min(i + batchSize, toProcess.length);
    console.log(`\n📝 Progress: ${progress}/${toProcess.length} (${Math.round(progress/toProcess.length*100)}%)\n`);

    // Small delay between batches
    if (i + batchSize < toProcess.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (updates.length > 0) {
    console.log(`\n💾 Saving ${updates.length} titles to Algolia...`);
    await client.partialUpdateObjects({
      indexName: ALGOLIA_INDEX,
      objects: updates,
      createIfNotExists: false,
    });
    console.log('✅ Done!');
  }
}

// Run
processRecords().catch(console.error);
