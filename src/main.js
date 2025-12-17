/**
 * Agent Machina - InstantSearch + Chat Widget with Tools
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
import { chat } from 'instantsearch.js/es/widgets';
import 'instantsearch.css/themes/satellite-min.css';
import './styles.css';

// ============ CONFIG ============
const CONFIG = {
  applicationId: import.meta.env.VITE_ALGOLIA_APP_ID || 'latency',
  searchKey: import.meta.env.VITE_ALGOLIA_SEARCH_KEY || 'c5a80e18b6a631c35917c31e5d56fd86',
  agentId: import.meta.env.VITE_ALGOLIA_AGENT_ID || '3669b83e-4138-4db0-8b9f-f78c9e88d053',
  indexName: 'machina_v3',
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

// ============ TOOLS FOR AGENT ============
const tools = {
  // Filter by attribute
  setFilter: {
    template: {
      layout: (data, { html }) => html`
        <div class="tool-action">
          ✅ Filtré par <strong>${data.toolCall.input.attribute}</strong>: ${data.toolCall.input.value}
        </div>
      `,
    },
    onToolCall: ({ input, addToolResult }) => {
      const { attribute, value } = input;
      search.helper.toggleFacetRefinement(attribute, value).search();
      addToolResult({ output: { success: true, filtered: `${attribute}:${value}` } });
    },
  },

  // Clear all filters
  clearFilters: {
    template: {
      layout: (_, { html }) => html`
        <div class="tool-action">🧹 Filtres effacés</div>
      `,
    },
    onToolCall: ({ addToolResult }) => {
      search.helper.clearRefinements().search();
      addToolResult({ output: { success: true } });
    },
  },

  // Set search query
  setQuery: {
    template: {
      layout: (data, { html }) => html`
        <div class="tool-action">
          🔍 Recherche: <strong>"${data.toolCall.input.query}"</strong>
        </div>
      `,
    },
    onToolCall: ({ input, addToolResult }) => {
      search.helper.setQuery(input.query).search();
      addToolResult({ output: { success: true, query: input.query } });
    },
  },

  // Add to favorites
  addFavorite: {
    template: {
      layout: (data, { html }) => html`
        <div class="tool-action">⭐ Ajouté aux favoris</div>
      `,
    },
    onToolCall: ({ input, addToolResult }) => {
      const hit = currentHits[input.objectID];
      if (hit) {
        toggleFavorite(input.objectID, hit);
        addToolResult({ output: { success: true } });
      } else {
        addToolResult({ output: { success: false, error: 'Hit not found' } });
      }
    },
  },

  // Suggest queries as clickable buttons
  suggestQueries: {
    template: {
      layout: (data, { html }) => {
        const queries = data.toolCall.input.queries || [];
        return html`
          <div class="tool-suggestions">
            <div class="suggestions-label">💡 Suggestions de recherche:</div>
            <div class="suggestions-list">
              ${queries.map(q => html`
                <button class="suggestion-btn" onclick=${() => {
                  search.helper.setQuery(q).search();
                  const searchInput = document.querySelector('.ais-SearchBox-input');
                  if (searchInput) searchInput.value = q;
                }}>
                  ${q}
                </button>
              `)}
            </div>
          </div>
        `;
      },
    },
    onToolCall: ({ input, addToolResult }) => {
      addToolResult({ output: { success: true, suggested: input.queries } });
    },
  },
};

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
              ${title ? html`<div class="hit-title">${title}</div>` : ''}
              <div class="hit-subtitle">${hit.chapterDisplay || hit.chapter || '0. Préambule'}</div>
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

  // Chat widget with tools
  chat({
    container: '#chat',
    agentId: CONFIG.agentId,
    tools,
    placeholder: 'Posez votre question...',
    launcher: false, // Disable floating launcher
    floatingButton: false,
    templates: {
      messages: {
        loading: (_, { html }) => html`
          <div class="typing">
            <span></span><span></span><span></span>
          </div>
        `,
      },
    },
  }),
]);

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
  document.getElementById('modal-section').textContent = hit.section || 'Intro';
  document.getElementById('modal-section').className = `hit-section ${getSectionClass(hit.section)}`;
  document.getElementById('modal-chapter').textContent = hit.chapterDisplay || hit.chapter || '0. Préambule';
  document.getElementById('modal-page').textContent = `p.${hit.page || '?'}`;
  document.getElementById('modal-body').innerHTML = hit.content || '';

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

  console.log('askAboutQuote:', action);
  console.log('Context:', context ? 'yes' : 'no');

  // Close modal first
  window.closeModal();

  // Scroll chat panel into view
  const chatPanel = document.querySelector('.chat-panel');
  if (chatPanel) {
    chatPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Find chat textarea
  const chatInput = document.querySelector('#chat textarea') ||
                    document.querySelector('#chat input');

  if (chatInput) {
    // Focus and scroll into view
    chatInput.focus();
    chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Set value with native setter
    const isTextarea = chatInput.tagName.toLowerCase() === 'textarea';
    const prototype = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(chatInput, fullPrompt);
    } else {
      chatInput.value = fullPrompt;
    }

    // Trigger input event for React state sync
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));

    console.log('Value set, length:', chatInput.value.length);

    // Submit after short delay
    setTimeout(() => {
      const submitBtn = document.querySelector('#chat button[type="submit"]') ||
                        document.querySelector('#chat form button') ||
                        document.querySelector('#chat button[aria-label*="send" i]') ||
                        document.querySelector('#chat button');

      console.log('Submit btn:', submitBtn);

      if (submitBtn) {
        submitBtn.click();
      }
    }, 200);
  } else {
    console.error('No chat input found!');
  }
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

// Intercept chat form submission to inject context
// Note: askAboutQuote already injects context, so this only adds for manual submissions
const setupChatContextInjection = () => {
  const chatContainer = document.querySelector('#chat');
  if (!chatContainer) return;

  // Observe for chat input form
  const observer = new MutationObserver(() => {
    const form = chatContainer.querySelector('form');
    if (form && !form.dataset.contextInjected) {
      form.dataset.contextInjected = 'true';

      form.addEventListener('submit', (e) => {
        const input = form.querySelector('textarea') || form.querySelector('input');
        if (input && input.value.trim()) {
          // Skip if already has context (from askAboutQuote)
          if (input.value.startsWith('[Extrait') || input.value.startsWith('[Filtres') || input.value.startsWith('[Favoris')) {
            return;
          }
          const context = buildContextString();
          if (context) {
            // Prepend context to the message
            const isTextarea = input.tagName.toLowerCase() === 'textarea';
            const prototype = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

            const newValue = context + input.value;
            if (nativeSetter) {
              nativeSetter.call(input, newValue);
            } else {
              input.value = newValue;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, true); // capture phase to run before widget handler
    }
  });

  observer.observe(chatContainer, { childList: true, subtree: true });
};

// Initialize context injection after search starts
search.on('render', () => {
  setupChatContextInjection();
});

window.closeModal = () => {
  document.getElementById('modal').classList.remove('active');
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.closeModal();
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

// ============ START ============
search.start();
initTheme();

// Update favorites UI after search renders
search.on('render', () => {
  setTimeout(updateFavoritesUI, 10);
});
