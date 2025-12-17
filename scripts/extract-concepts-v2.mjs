#!/usr/bin/env node
/**
 * Extract concepts v2 - Constrained to canonical ontology
 * Uses few-shot examples for consistent output
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
  delayMs: 300,
};

// Canonical concepts derived from book themes + top extracted concepts
const CANONICAL_CONCEPTS = [
  // Temps & Organisation
  "gestion du temps",
  "planification",
  "priorisation",
  "routines et habitudes",
  "phases de travail",
  "productivité",
  "concentration",

  // Développement personnel
  "développement personnel",
  "connaissance de soi",
  "amélioration continue",
  "épanouissement",
  "évolution personnelle",
  "meilleure version de soi",

  // Communication
  "communication explicite",
  "honnêteté positive",
  "savoir dire non",
  "feedback constructif",
  "écoute active",

  // Décisions & Actions
  "prise de décision",
  "passage à l'action",
  "gestion des opportunités",
  "persévérance",
  "discipline personnelle",

  // Équilibre & Bien-être
  "équilibre vie pro/perso",
  "gestion du stress",
  "acceptation de soi",
  "résilience",
  "bonheur",

  // Mindset
  "ouverture d'esprit",
  "curiosité",
  "remise en question",
  "apprentissage continu",
  "confiance en soi",

  // Relations & Entreprise
  "travail collaboratif",
  "leadership",
  "gestion des interruptions",
  "réunions efficaces",
  "culture d'entreprise",

  // Introspection
  "forces et faiblesses",
  "auto-observation",
  "prise de recul",
  "vision long terme",

  // Méthodes
  "effets cumulés",
  "petits pas",
  "automatismes",
  "simplification",
];

const SYSTEM_PROMPT = `Tu es un expert en classification de contenu. Tu dois extraire 3-5 concepts clés d'un texte français sur le développement personnel/professionnel.

RÈGLES STRICTES:
1. Choisis UNIQUEMENT parmi cette liste de concepts canoniques:
${CANONICAL_CONCEPTS.map(c => `- ${c}`).join('\n')}

2. Si le texte parle d'un sujet NON couvert, tu peux ajouter MAX 1 nouveau concept (en minuscules, 2-3 mots max)
3. Retourne UNIQUEMENT un tableau JSON, rien d'autre
4. Minimum 3 concepts, maximum 5`;

const FEW_SHOT_EXAMPLES = [
  {
    text: "Apprendre à dire non est essentiel. La société valorise le oui, mais savoir refuser permet de protéger son temps et ses priorités.",
    concepts: ["savoir dire non", "gestion du temps", "priorisation"]
  },
  {
    text: "Chaque matin, je planifie mes trois tâches prioritaires. Cette routine simple a transformé ma productivité et réduit mon stress.",
    concepts: ["planification", "routines et habitudes", "productivité", "priorisation"]
  },
  {
    text: "L'honnêteté positive consiste à dire la vérité avec bienveillance. Ne pas mentir, mais formuler les choses de manière constructive.",
    concepts: ["honnêteté positive", "communication explicite", "feedback constructif"]
  },
  {
    text: "Acceptez vos faiblesses comme point de départ. La connaissance de soi permet d'identifier où progresser sans se juger.",
    concepts: ["acceptation de soi", "connaissance de soi", "forces et faiblesses", "amélioration continue"]
  }
];

async function extractConcepts(text) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add few-shot examples
  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: `Texte: "${ex.text}"` });
    messages.push({ role: 'assistant', content: JSON.stringify(ex.concepts) });
  }

  // Add actual request
  messages.push({ role: 'user', content: `Texte: "${text.slice(0, 800)}"` });

  const response = await fetch(CONFIG.llmEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.llmKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CONFIG.llmModel,
      messages,
      temperature: 0.1, // Lower for more consistency
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';

  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
    const concepts = JSON.parse(cleaned);

    // Normalize: lowercase, trim
    return concepts.map(c => c.toLowerCase().trim()).filter(c => c.length > 0);
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
        attributesToRetrieve: ['objectID', 'content', 'chapter', 'section'],
      }]
    });

    const hits = results[0].hits;
    if (hits.length === 0) break;

    allHits = allHits.concat(hits);
    page++;
    console.log(`Fetched page ${page}, total: ${allHits.length} records`);
  }

  console.log(`\nProcessing ${allHits.length} records with constrained concepts...`);

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

      concepts.forEach(c => {
        conceptCounts[c] = (conceptCounts[c] || 0) + 1;
      });

      // Build hierarchicalCategories from section > chapter
      const hierarchicalCategories = {};
      if (hit.section) {
        hierarchicalCategories.lvl0 = hit.section;
        if (hit.chapter) {
          hierarchicalCategories.lvl1 = `${hit.section} > ${hit.chapter}`;
        }
      }

      updates.push({
        objectID: hit.objectID,
        concepts,
        hierarchicalCategories,
        _tags: concepts, // For Recommend
      });

      await sleep(CONFIG.delayMs);

    } catch (e) {
      console.error(`Error processing ${hit.objectID}:`, e.message);
    }

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

  if (updates.length > 0) {
    console.log(`Saving final batch of ${updates.length} records...`);
    await client.partialUpdateObjects({
      indexName: CONFIG.indexName,
      objects: updates,
      createIfNotExists: false,
    });
  }

  // Print results
  console.log('\n--- Concept Distribution ---');
  const sorted = Object.entries(conceptCounts).sort((a, b) => b[1] - a[1]);

  const canonical = sorted.filter(([c]) => CANONICAL_CONCEPTS.includes(c));
  const novel = sorted.filter(([c]) => !CANONICAL_CONCEPTS.includes(c));

  console.log('\nCanonical concepts used:');
  canonical.forEach(([concept, count], i) => {
    console.log(`${i + 1}. ${concept} (${count})`);
  });

  console.log('\nNovel concepts added:');
  novel.forEach(([concept, count], i) => {
    console.log(`${i + 1}. ${concept} (${count})`);
  });

  console.log(`\nTotal: ${canonical.length} canonical + ${novel.length} novel = ${sorted.length} concepts`);

  // Update index settings for hierarchical faceting
  console.log('\nUpdating index settings...');
  await client.setSettings({
    indexName: CONFIG.indexName,
    indexSettings: {
      searchableAttributes: ['content', 'title', 'chapter', 'themes', 'concepts'],
      attributesForFaceting: [
        'searchable(section)',
        'searchable(chapter)',
        'searchable(subsection)',
        'searchable(contentType)',
        'searchable(themes)',
        'searchable(concepts)',
        'searchable(hierarchicalCategories.lvl0)',
        'searchable(hierarchicalCategories.lvl1)',
        'filterOnly(documentId)',
        'filterOnly(page)'
      ],
    },
  });

  console.log('\nDone!');
}

main().catch(console.error);
