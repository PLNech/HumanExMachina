/**
 * Agent Machina - InstantSearch + Custom Chat Panel
 */

import { liteClient as algoliasearch } from 'algoliasearch/lite';
import instantsearch from 'instantsearch.js';
import {
  searchBox,
  hits,
  refinementList,
  pagination,
  stats,
  clearRefinements,
  configure,
} from 'instantsearch.js/es/widgets';
import 'instantsearch.css/themes/satellite-min.css';
import './styles.css';

// ============ CONFIG ============
const CONFIG = {
  applicationId: import.meta.env.VITE_ALGOLIA_APP_ID || 'latency',
  searchKey: import.meta.env.VITE_ALGOLIA_SEARCH_KEY || 'c5a80e18b6a631c35917c31e5d56fd86',
  agentId: import.meta.env.VITE_ALGOLIA_AGENT_ID || '3669b83e-4138-4db0-8b9f-f78c9e88d053',
  indexName: 'machina_v3',
  agentEndpoint: 'https://latency.algolia.net/agent-studio/1/agents',
};

// ============ SEARCH CLIENT ============
const searchClient = algoliasearch(CONFIG.applicationId, CONFIG.searchKey);

// ============ INSTANTSEARCH ============
const search = instantsearch({
  indexName: CONFIG.indexName,
  searchClient,
  insights: false, // Disabled to avoid console errors
  future: {
    preserveSharedStateOnUnmount: true,
  },
});

// ============ FAVORITES ============
const favorites = new Map();
const loadFavorites = () => {
  const saved = localStorage.getItem('machina_favorites');
  if (saved) {
    try {
      JSON.parse(saved).forEach(hit => favorites.set(hit.objectID, hit));
    } catch (e) {}
  }
};
const saveFavorites = () => {
  localStorage.setItem('machina_favorites', JSON.stringify([...favorites.values()]));
};
const toggleFavorite = (objectID, hit) => {
  if (favorites.has(objectID)) {
    favorites.delete(objectID);
  } else if (hit) {
    favorites.set(objectID, {
      objectID: hit.objectID,
      chapter: hit.chapter,
      chapterDisplay: hit.chapterDisplay,
      page: hit.page,
      section: hit.section,
      content: hit.content?.slice(0, 200),
      concepts: hit.concepts?.slice(0, 3),
    });
  }
  saveFavorites();
  updateFavoritesUI();
};
const updateFavoritesUI = () => {
  document.querySelectorAll('.star-btn').forEach(btn => {
    const id = btn.dataset.objectId;
    const isFav = favorites.has(id);
    btn.classList.toggle('active', isFav);
    btn.textContent = isFav ? '★' : '☆';
  });
  const count = favorites.size;
  const countEl = document.getElementById('fav-count');
  if (countEl) countEl.textContent = count > 0 ? `(${count})` : '';
};
window.toggleFavorite = toggleFavorite;
loadFavorites();

// ============ HELPERS ============
const getSectionClass = (section) => {
  if (!section) return '';
  const lower = section.toLowerCase();
  if (lower === 'comprendre') return 'comprendre';
  if (lower === 'agir') return 'agir';
  return '';
};

// Store current hits for modal
let currentHits = {};


// ============ WIDGETS ============
search.addWidgets([
  configure({
    hitsPerPage: 12,
  }),

  searchBox({
    container: '#searchbox',
    placeholder: 'Rechercher dans le livre...',
    showReset: true,
    showSubmit: false,
  }),

  stats({
    container: '#stats',
    templates: {
      text: ({ nbHits }) => `${nbHits} extraits`,
    },
  }),

  clearRefinements({
    container: '#clear',
    templates: {
      resetLabel: 'Effacer filtres',
    },
  }),

  refinementList({
    container: '#section-facet',
    attribute: 'section',
    sortBy: ['name:asc'],
  }),

  refinementList({
    container: '#chapter-facet',
    attribute: 'chapter',
    limit: 10,
    showMore: true,
    showMoreLimit: 20,
  }),

  refinementList({
    container: '#concepts-facet',
    attribute: 'concepts',
    limit: 10,
    showMore: true,
    showMoreLimit: 50,
    searchable: true,
    searchablePlaceholder: 'Chercher un concept...',
  }),

  refinementList({
    container: '#type-facet',
    attribute: 'contentType',
  }),

  hits({
    container: '#hits',
    templates: {
      item: (hit, { html, components }) => {
        currentHits[hit.objectID] = hit;
        const isFav = favorites.has(hit.objectID);
        const title = hit.shortTitle || hit.title;
        return html`
          <div class="hit-card" data-object-id="${hit.objectID}" data-hit='${JSON.stringify({ objectID: hit.objectID })}'>
            <div class="hit-header">
              <div class="hit-meta">
                <span class="hit-section ${getSectionClass(hit.section)}">${hit.section || 'Intro'}</span>
                <span class="hit-page">p.${hit.page || '?'}</span>
              </div>
              <button class="star-btn ${isFav ? 'active' : ''}" data-object-id="${hit.objectID}" data-action="favorite">
                ${isFav ? '★' : '☆'}
              </button>
            </div>
            <div class="hit-main" data-action="open">
              ${hit.shortTitle ? html`<div class="hit-title">${hit.shortTitle}</div>` : ''}
              ${!hit.shortTitle ? html`<div class="hit-subtitle">${hit.chapterDisplay || hit.chapter || '0. Préambule'}</div>` : ''}
              <div class="hit-content">
                ${components.Highlight({ hit, attribute: 'content' })}
              </div>
              ${hit.concepts?.length ? html`
                <div class="hit-concepts">
                  ${hit.concepts.slice(0, 5).map(t => html`<span class="hit-concept">${t}</span>`)}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      },
      empty: (_, { html }) => html`
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <p>Aucun résultat trouvé.</p>
        </div>
      `,
    },
  }),

  pagination({
    container: '#pagination',
    padding: 2,
  }),
]);

// ============ CUSTOM CHAT PANEL ============
const chatState = {
  messages: [],
  isLoading: false,
  conversationId: crypto.randomUUID(),
};

// Simple markdown to HTML (bold, italic, links, code)
const renderMarkdown = (text) => {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>');
};

// Render chat messages
const renderChat = () => {
  const container = document.getElementById('chat');
  if (!container) return;

  const messagesHtml = chatState.messages.map((msg, i) => {
    const isUser = msg.role === 'user';
    const content = isUser ? msg.content : renderMarkdown(msg.content);
    return `
      <div class="chat-message ${isUser ? 'user' : 'assistant'}">
        <div class="message-content">${content}</div>
      </div>
    `;
  }).join('');

  const loadingHtml = chatState.isLoading ? `
    <div class="chat-message assistant">
      <div class="message-content">
        <div class="typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="chat-messages">
      ${messagesHtml}
      ${loadingHtml}
    </div>
    <form class="chat-form" onsubmit="return handleChatSubmit(event)">
      <input type="text" class="chat-input" placeholder="Posez votre question..." autocomplete="off" />
      <button type="submit" class="chat-submit" ${chatState.isLoading ? 'disabled' : ''}>
        ${chatState.isLoading ? '...' : '➤'}
      </button>
    </form>
  `;

  // Scroll to bottom
  const messagesEl = container.querySelector('.chat-messages');
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
};

// Handle tool calls from agent
const handleToolCall = (toolCall) => {
  const { name, input } = toolCall;

  switch (name) {
    case 'setFilter':
      search.helper.toggleFacetRefinement(input.attribute, input.value).search();
      return {
        success: true,
        filtered: `${input.attribute}:${input.value}`,
        toolDisplay: `🔍 *Filtré: ${input.value}*`
      };

    case 'clearFilters':
      search.helper.clearRefinements().search();
      return { success: true, toolDisplay: '🧹 *Filtres effacés*' };

    case 'setQuery':
      search.helper.setQuery(input.query).search();
      const searchInput = document.querySelector('.ais-SearchBox-input');
      if (searchInput) searchInput.value = input.query;
      return {
        success: true,
        query: input.query,
        toolDisplay: `🔍 *Recherche: "${input.query}"*`
      };

    case 'addFavorite':
      const hit = currentHits[input.objectID];
      if (hit) {
        toggleFavorite(input.objectID, hit);
        return { success: true, toolDisplay: '⭐ *Ajouté aux favoris*' };
      }
      return { success: false, error: 'Hit not found' };

    case 'suggestQueries':
      // Display suggestions in chat
      const suggestions = input.queries?.join(', ') || '';
      return {
        success: true,
        suggested: input.queries,
        toolDisplay: `💡 *Suggestions: ${suggestions}*`
      };

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
};

// Convert messages to AI SDK v5 format
const toAISdkV5Messages = (messages) => {
  return messages.map(m => ({
    role: m.role,
    parts: [{ type: 'text', text: m.content }],
  }));
};

// Send message to Agent Studio API
const sendMessage = async (userMessage) => {
  chatState.isLoading = true;
  chatState.messages.push({ role: 'user', content: userMessage });
  renderChat();

  try {
    const response = await fetch(
      `${CONFIG.agentEndpoint}/${CONFIG.agentId}/completions?compatibilityMode=ai-sdk-5`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-algolia-api-key': CONFIG.searchKey,
          'x-algolia-application-id': CONFIG.applicationId,
        },
        body: JSON.stringify({
          id: chatState.conversationId,
          messages: toAISdkV5Messages(chatState.messages),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Handle SSE streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessage = '';
    let buffer = '';
    let lastRenderTime = 0;
    const RENDER_THROTTLE = 50; // ms between renders

    // Add placeholder message for streaming
    chatState.messages.push({ role: 'assistant', content: '' });
    const msgIndex = chatState.messages.length - 1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          // Handle different SSE event types (API uses 'delta' field)
          if (event.type === 'text-delta' && event.delta) {
            assistantMessage += event.delta;
            chatState.messages[msgIndex].content = assistantMessage;

            // Throttled render for smooth streaming
            const now = Date.now();
            if (now - lastRenderTime > RENDER_THROTTLE) {
              renderChat();
              lastRenderTime = now;
            }
          } else if (event.type === 'tool-call' && event.toolName) {
            // Handle tool call and show in UI
            const result = handleToolCall({ name: event.toolName, input: event.args || {} });
            console.log('Tool call:', event.toolName, result);
            // Show tool action in chat
            if (result.toolDisplay) {
              assistantMessage = result.toolDisplay + '\n\n' + assistantMessage;
              chatState.messages[msgIndex].content = assistantMessage;
              renderChat();
            }
          } else if (event.type === 'finish') {
            // Stream finished
            break;
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    // Ensure final content is set
    if (assistantMessage) {
      chatState.messages[msgIndex].content = assistantMessage;
    } else {
      // No response received, remove placeholder
      chatState.messages.splice(msgIndex, 1);
    }

  } catch (error) {
    console.error('Chat error:', error);
    chatState.messages.push({
      role: 'assistant',
      content: 'Désolé, une erreur est survenue. Réessayez.'
    });
  } finally {
    chatState.isLoading = false;
    renderChat();
  }
};

// Extract keywords from user question and sync search
const syncSearchFromQuestion = (question) => {
  // Skip if question is too short or is context-only
  if (!question || question.length < 10) return;
  if (question.startsWith('[Extrait') || question.startsWith('[Filtres')) return;

  // French stopwords to filter out
  const stopwords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'mais', 'donc',
    'car', 'ni', 'que', 'qui', 'quoi', 'dont', 'où', 'ce', 'cette', 'ces', 'mon',
    'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre',
    'vos', 'leur', 'leurs', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils',
    'elles', 'me', 'te', 'se', 'lui', 'en', 'dans', 'sur', 'sous', 'avec', 'sans',
    'pour', 'par', 'chez', 'vers', 'entre', 'être', 'avoir', 'fait', 'faire',
    'est', 'sont', 'a', 'ai', 'as', 'au', 'aux', 'plus', 'moins', 'très', 'bien',
    'tout', 'tous', 'toute', 'toutes', 'autre', 'autres', 'même', 'aussi', 'si',
    'ne', 'pas', 'jamais', 'rien', 'personne', 'comment', 'pourquoi', 'quand',
    'comme', 'peut', 'peux', 'peuvent', 'dois', 'doit', 'faut', 'veux', 'veut',
    'cherche', 'parle', 'dit', 'explique', 'raconte', 'décrit', 'moi', 'toi'
  ]);

  // Extract words, filter stopwords, keep meaningful terms
  const words = question
    .toLowerCase()
    .replace(/[«»""''„‚\[\](){}]/g, ' ')
    .replace(/[.,;:!?…]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .slice(0, 4); // Max 4 keywords

  if (words.length > 0) {
    const query = words.join(' ');
    search.helper.setQuery(query).search();
    const searchInput = document.querySelector('.ais-SearchBox-input');
    if (searchInput) searchInput.value = query;
  }
};

// Handle form submission
window.handleChatSubmit = (e) => {
  e.preventDefault();
  const input = e.target.querySelector('.chat-input');
  const message = input?.value.trim();

  if (message && !chatState.isLoading) {
    input.value = '';
    // Sync search with question keywords
    syncSearchFromQuestion(message);
    sendMessage(message);
  }

  return false;
};

// Clear chat
window.clearChat = () => {
  chatState.messages = [];
  chatState.conversationId = crypto.randomUUID();
  renderChat();
  window.clearQuote?.();
};

// Initialize chat UI
const initChat = () => {
  renderChat();
};

// ============ CONTENT PROCESSING ============

// French concept variations: canonical → regex pattern for verb/noun forms
const CONCEPT_VARIATIONS = {
  'prise de recul': /\b(pris(?:e|es)?|prendre|prend(?:s|re)?)\s+(?:du|de|le|la)?\s*recul/gi,
  'acceptation de soi': /\b(accept(?:ation|er|e|ons|ez|ent)|s'accept(?:er|e|ons|ez|ent))\s*(?:de\s+soi)?/gi,
  'connaissance de soi': /\b(connaiss(?:ance|ances)|(?:se\s+)?conna[îi]tre|conna[îi](?:s|t|ssons|ssez|ssent))\s*(?:soi(?:-même)?)?/gi,
  'gestion du temps': /\b(g[ée]r(?:er|e|ons|ez|ent)|gestion)\s+(?:du|de|le|son|mon|notre|leur)?\s*temps/gi,
  'prise de décision': /\b(pris(?:e|es)?|prendre|prend(?:s|re)?)\s+(?:une|des|la|les)?\s*d[ée]cision(?:s)?/gi,
  'passage à l\'action': /\b(pass(?:age|er|e|ons|ez|ent))\s+[àa]\s+l'action/gi,
  'savoir dire non': /\b(savoir|sait|savons|savez|savent)?\s*dir(?:e|ons|ez|ent)?\s+non/gi,
  'amélioration continue': /\b(am[ée]lior(?:ation|er|e|ons|ez|ent))\s*(?:continu(?:e|elle)?)?/gi,
  'développement personnel': /\b(d[ée]velopp(?:ement|er|e|ons|ez|ent))\s*(?:personnel|perso)?/gi,
  'équilibre vie pro/perso': /\b([ée]quilibr(?:e|er|ons|ez|ent))\s*(?:vie|entre)?\s*(?:pro(?:fessionnelle?)?|perso(?:nnelle?)?|travail)/gi,
  'planification': /\b(planifi(?:cation|er|e|ons|ez|ent)|planifi[ée](?:s|e)?)/gi,
  'priorisation': /\b(prioris(?:ation|er|e|ons|ez|ent)|priorit[ée](?:s)?)/gi,
  'auto-observation': /\b(auto[- ]?observ(?:ation|er|e|ons|ez|ent)|s'observ(?:er|e|ons|ez|ent))/gi,
  'remise en question': /\b(remis(?:e|es)?|remettre|remet(?:s|tons|tez|tent)?)\s+en\s+question/gi,
};

// Highlight concepts in content as clickable links
const highlightConcepts = (content, concepts) => {
  if (!content || !concepts?.length) return content;

  let result = content;
  // Sort by length descending to match longer phrases first
  const sorted = [...concepts].sort((a, b) => b.length - a.length);

  for (const concept of sorted) {
    const canonical = concept.toLowerCase();

    // Check if we have a variation pattern for this concept
    if (CONCEPT_VARIATIONS[canonical]) {
      result = result.replace(CONCEPT_VARIATIONS[canonical], (match) =>
        `<span class="concept-link" data-concept="${concept}" onclick="window.filterByConcept('${concept}')">${match}</span>`
      );
    } else {
      // Fallback to exact match
      const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b(${escaped})\\b`, 'gi');
      result = result.replace(regex, `<span class="concept-link" data-concept="$1" onclick="window.filterByConcept('$1')">$1</span>`);
    }
  }
  return result;
};

// Add breathing to content with smart paragraph detection
const addBreathing = (content) => {
  if (!content) return content;

  // Split into sentences (period followed by space and capital letter)
  let result = content;

  // Detect paragraph breaks: period + space + capital letter after a long sentence
  // Also handle: quotes ending, then new sentence
  result = result.replace(/\.(\s+)([A-ZÀ-ÖØ-Ý])/g, (match, space, letter) => {
    return `.</p><p>${letter}`;
  });

  // Wrap in paragraph tags if we added any
  if (result.includes('</p>')) {
    result = `<p>${result}</p>`;
  }

  return result;
};

// Filter by concept from highlighted link
window.filterByConcept = (concept) => {
  search.helper.toggleFacetRefinement('concepts', concept).search();
  window.closeModal();
};

// ============ MODAL ============
window.currentHits = currentHits;

// Track current quote for chat context
let currentQuote = null;

window.openModal = (objectID) => {
  const hit = currentHits[objectID];
  if (!hit) return;

  document.querySelectorAll('.hit-card').forEach(el => el.classList.remove('selected'));
  document.querySelector(`[data-object-id="${objectID}"]`)?.classList.add('selected');

  const modal = document.getElementById('modal');

  // Title: show shortTitle if exists, otherwise chapter shows as subtitle
  const hasShortTitle = !!hit.shortTitle;
  document.getElementById('modal-title').textContent = hit.shortTitle || '';
  document.getElementById('modal-title').style.display = hasShortTitle ? 'block' : 'none';

  // Metadata - show chapter as subtitle only if no shortTitle
  document.getElementById('modal-section').textContent = hit.section || 'Intro';
  document.getElementById('modal-section').className = `hit-section ${getSectionClass(hit.section)}`;
  const chapterEl = document.getElementById('modal-chapter');
  chapterEl.textContent = hit.chapterDisplay || hit.chapter || '0. Préambule';
  chapterEl.style.display = hasShortTitle ? 'none' : 'block';
  document.getElementById('modal-page').textContent = `p.${hit.page || '?'}`;

  // Process content: add breathing, then highlight concepts
  let processedContent = addBreathing(hit.content || '');
  processedContent = highlightConcepts(processedContent, hit.concepts);
  document.getElementById('modal-body').innerHTML = processedContent;

  // Store current quote for chat context
  currentQuote = {
    section: hit.section,
    chapter: hit.chapterDisplay || hit.chapter,
    page: hit.page,
    content: hit.content,
    concepts: hit.concepts,
  };

  // Update quote indicator in chat
  updateQuoteIndicator();

  modal.classList.add('active');

  // Show chat panel and focus input
  setTimeout(() => {
    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) {
      chatPanel.classList.add('visible');
      chatPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const chatInput = document.querySelector('#chat textarea') || document.querySelector('#chat input');
    if (chatInput) chatInput.focus();
  }, 100);
};

// Update quote indicator in chat panel
const updateQuoteIndicator = () => {
  let indicator = document.getElementById('quote-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'quote-indicator';
    indicator.className = 'quote-indicator';
    const chatPanel = document.querySelector('.chat-panel');
    chatPanel?.insertBefore(indicator, chatPanel.firstChild);
  }

  if (currentQuote) {
    indicator.innerHTML = `
      <div class="quote-badge">
        <span class="quote-icon">📖</span>
        <span class="quote-ref">${currentQuote.chapter} p.${currentQuote.page}</span>
        <button class="quote-clear" onclick="clearQuote()">×</button>
      </div>
    `;
    indicator.style.display = 'flex';
  } else {
    indicator.style.display = 'none';
  }
};

window.clearQuote = () => {
  currentQuote = null;
  updateQuoteIndicator();
};

// Export for tools
window.getCurrentQuote = () => currentQuote;

// Prompt templates for modal actions
const promptTemplates = {
  explain: "Explique-moi ce passage en détail. Quel est le message clé et comment ça s'applique concrètement?",
  next: "Après ce passage, que devrais-je explorer ensuite dans le livre pour approfondir ma compréhension personnelle?",
  apply: "Comment puis-je appliquer cette idée dans ma vie quotidienne? Donne-moi des actions concrètes.",
};

// Ask about the current quote
window.askAboutQuote = (action) => {
  const prompt = promptTemplates[action];
  if (!prompt) return;

  // Build context from current quote
  const context = buildContextString();
  const fullPrompt = context + prompt;

  // Sync search with quote concepts or content
  if (currentQuote?.concepts?.length) {
    const query = currentQuote.concepts.slice(0, 2).join(' ');
    search.helper.setQuery(query).search();
    const searchInput = document.querySelector('.ais-SearchBox-input');
    if (searchInput) searchInput.value = query;
  }

  // Close modal first
  window.closeModal();

  // On mobile, switch to chat tab
  if (window.innerWidth <= 900) {
    const chatTab = document.querySelector('.mobile-tab[data-tab="chat"]');
    chatTab?.click();
  } else {
    // Desktop: scroll chat into view
    const chatPanel = document.querySelector('.chat-panel');
    chatPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Send directly to our custom chat
  sendMessage(fullPrompt);
};

// Build context string from current state
const buildContextString = () => {
  const parts = [];

  // Add current quote if present (snippetized, italic)
  if (currentQuote) {
    const snippet = currentQuote.content?.slice(0, 120).trim() + '...';
    parts.push(`[Extrait - ${currentQuote.chapter} p.${currentQuote.page}]: _"${snippet}"_`);
  }

  // Add active filters
  const state = search.helper?.state;
  if (state?.disjunctiveFacetsRefinements) {
    const filters = [];
    Object.entries(state.disjunctiveFacetsRefinements).forEach(([attr, values]) => {
      if (values?.length) filters.push(`${attr}: ${values.join(', ')}`);
    });
    if (filters.length) parts.push(`[Filtres: ${filters.join('; ')}]`);
  }

  // Add favorites summary if any
  if (favorites.size > 0) {
    const favSummary = [...favorites.values()].slice(0, 3).map(f =>
      `${f.chapter} p.${f.page}`
    ).join(', ');
    parts.push(`[Favoris: ${favSummary}${favorites.size > 3 ? '...' : ''}]`);
  }

  return parts.length ? parts.join('\n') + '\n\n' : '';
};


window.closeModal = () => {
  document.getElementById('modal').classList.remove('active');
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.closeModal();
  // Ctrl+K or Cmd+K focuses search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const searchInput = document.querySelector('.ais-SearchBox-input');
    searchInput?.focus();
    searchInput?.select();
  }
});

// ============ THEME ============
const initTheme = () => {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
};

const setTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.textContent = theme === 'light' ? '🌙' : '☀️';
};

window.toggleTheme = () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'light' ? 'dark' : 'light');
};

// ============ FAVORITES MODAL ============
window.openFavoritesModal = () => {
  const modal = document.getElementById('favorites-modal');
  const list = document.getElementById('favorites-list');

  const favs = [...favorites.values()];
  if (favs.length === 0) {
    list.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Aucun favori.</p>';
  } else {
    list.innerHTML = favs.map(f => `
      <div class="fav-item" data-object-id="${f.objectID}">
        <div class="fav-content">
          <div class="fav-header">
            <span class="hit-section ${getSectionClass(f.section)}">${f.section || 'Intro'}</span>
            <strong>${f.chapterDisplay || f.chapter}</strong>
            <span class="hit-page">p.${f.page}</span>
          </div>
          <p class="fav-snippet">${f.content || ''}...</p>
        </div>
        <button class="star-btn active" onclick="toggleFavorite('${f.objectID}')">★</button>
      </div>
    `).join('');
  }

  modal.classList.add('active');
};

window.closeFavoritesModal = () => {
  document.getElementById('favorites-modal').classList.remove('active');
};

// ============ EVENT DELEGATION ============
document.querySelector('#hits').addEventListener('click', (e) => {
  const target = e.target;

  // Handle favorite button clicks
  if (target.closest('[data-action="favorite"]')) {
    e.stopPropagation();
    const btn = target.closest('[data-action="favorite"]');
    const objectId = btn.dataset.objectId;
    const hit = currentHits[objectId];
    toggleFavorite(objectId, hit);
    return;
  }

  // Handle card clicks to open modal
  if (target.closest('[data-action="open"]')) {
    const card = target.closest('.hit-card');
    const objectId = card?.dataset.objectId;
    if (objectId) {
      window.openModal(objectId);
    }
  }
});

// ============ SELECTION CONTEXT MENU ============
const createSelectionMenu = () => {
  const menu = document.createElement('div');
  menu.id = 'selection-menu';
  menu.className = 'selection-menu';
  menu.innerHTML = `
    <button class="selection-btn" data-action="explain">
      <span class="selection-quote">"</span>
      <span class="selection-label">Explain</span>
    </button>
  `;
  menu.style.display = 'none';
  document.body.appendChild(menu);
  return menu;
};

const selectionMenu = createSelectionMenu();

// Position menu near selection
const positionMenu = (rect) => {
  const menuRect = selectionMenu.getBoundingClientRect();
  let x = rect.right + 8;
  let y = rect.top - 4;

  // Keep in viewport
  if (x + menuRect.width > window.innerWidth - 16) {
    x = rect.left - menuRect.width - 8;
  }
  if (y < 8) y = rect.bottom + 4;

  selectionMenu.style.left = `${x}px`;
  selectionMenu.style.top = `${y}px`;
};

// Show menu on text selection in modal
document.addEventListener('mouseup', (e) => {
  const modalBody = document.getElementById('modal-body');
  if (!modalBody?.contains(e.target) && e.target !== modalBody) {
    selectionMenu.style.display = 'none';
    return;
  }

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (text && text.length > 3 && text.length < 500) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    selectionMenu.dataset.selectedText = text;
    selectionMenu.style.display = 'flex';
    positionMenu(rect);
  } else {
    selectionMenu.style.display = 'none';
  }
});

// Hide on click elsewhere
document.addEventListener('mousedown', (e) => {
  if (!selectionMenu.contains(e.target)) {
    selectionMenu.style.display = 'none';
  }
});

// Handle menu button click
selectionMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const selectedText = selectionMenu.dataset.selectedText;

  if (action === 'explain' && selectedText) {
    const prompt = `Explique "${selectedText}" dans ce contexte.`;
    sendToChat(prompt);
    selectionMenu.style.display = 'none';
    window.getSelection()?.removeAllRanges();
  }
});

// Send prompt to chat (using our custom chat system)
const sendToChat = (prompt) => {
  const context = buildContextString();
  const fullPrompt = context + prompt;
  syncSearchFromQuestion(prompt);
  sendMessage(fullPrompt);
};

// ============ RESIZE HANDLE ============
const initResizeHandle = () => {
  const handle = document.getElementById('resize-handle');
  const app = document.querySelector('.app');
  if (!handle || !app) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  // Load saved width
  const savedWidth = localStorage.getItem('chat_width');
  if (savedWidth) {
    app.style.setProperty('--chat-width', savedWidth);
  }

  const startResize = (e) => {
    isResizing = true;
    startX = e.clientX || e.touches?.[0]?.clientX;
    const chatPanel = document.querySelector('.chat-panel');
    startWidth = chatPanel?.offsetWidth || 400;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const doResize = (e) => {
    if (!isResizing) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const diff = startX - clientX;
    const newWidth = Math.min(Math.max(startWidth + diff, 250), 700);
    app.style.setProperty('--chat-width', `${newWidth}px`);
  };

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Save width
    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) {
      localStorage.setItem('chat_width', `${chatPanel.offsetWidth}px`);
    }
  };

  handle.addEventListener('mousedown', startResize);
  handle.addEventListener('touchstart', startResize, { passive: false });
  document.addEventListener('mousemove', doResize);
  document.addEventListener('touchmove', doResize, { passive: false });
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('touchend', stopResize);
};

// ============ MOBILE TABS ============
const initMobileTabs = () => {
  const tabs = document.querySelectorAll('.mobile-tab');
  const results = document.querySelector('.results');
  const chat = document.querySelector('.chat-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Toggle panels
      if (target === 'results') {
        results?.classList.remove('hidden');
        chat?.classList.remove('active');
      } else {
        results?.classList.add('hidden');
        chat?.classList.add('active');
        // Focus chat input
        setTimeout(() => {
          document.querySelector('.chat-input')?.focus();
        }, 100);
      }
    });
  });
};

// Switch to chat tab on mobile when sending message
const switchToChatMobile = () => {
  if (window.innerWidth <= 900) {
    const chatTab = document.querySelector('.mobile-tab[data-tab="chat"]');
    chatTab?.click();
  }
};

// ============ START ============
search.start();
initTheme();
initChat();
initMobileTabs();
initResizeHandle();

// Update favorites UI after search renders
search.on('render', () => {
  setTimeout(updateFavoritesUI, 10);
});
