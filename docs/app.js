/**
 * Agent Machina - Two-Panel InstantSearch + Chat UI
 * Modular architecture with QS, Recommend, and Chat
 */

// ============ CONFIG ============
const CONFIG = {
  applicationId: '__ALGOLIA_APP_ID__',
  searchKey: '__ALGOLIA_SEARCH_KEY__',
  agentId: '__ALGOLIA_AGENT_ID__',
  indexName: 'machina_v3',
  agentUrl: 'https://agent-studio.eu.algolia.com',
};

// Local dev fallback
if (CONFIG.applicationId.startsWith('__')) {
  CONFIG.applicationId = 'latency';
  CONFIG.searchKey = 'c5a80e18b6a631c35917c31e5d56fd86';
  CONFIG.agentId = '3669b83e-4138-4db0-8b9f-f78c9e88d053';
}

// ============ THEME MODULE ============
const ThemeModule = {
  toggle: document.getElementById('theme-toggle'),

  init() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.set(saved || (prefersDark ? 'dark' : 'light'));
    this.toggle.addEventListener('click', () => this.flip());
  },

  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    this.toggle.textContent = theme === 'light' ? '🌙' : '☀️';
  },

  flip() {
    const current = document.documentElement.getAttribute('data-theme');
    this.set(current === 'light' ? 'dark' : 'light');
  }
};

// ============ SEARCH MODULE ============
const SearchModule = {
  client: null,
  instance: null,
  currentHits: {},

  init() {
    // Use lite client from CDN
    const { liteClient } = window['algoliasearch/lite'];
    this.client = liteClient(CONFIG.applicationId, CONFIG.searchKey);
    this.instance = instantsearch({
      indexName: CONFIG.indexName,
      searchClient: this.client,
      insights: true,
    });

    this.addWidgets();
    this.instance.on('render', () => this.onRender());
    this.instance.start();
  },

  addWidgets() {
    this.instance.addWidgets([
      instantsearch.widgets.searchBox({
        container: '#searchbox',
        placeholder: 'Rechercher dans le livre...',
        showReset: true,
        showSubmit: false,
      }),

      instantsearch.widgets.stats({
        container: '#stats',
        templates: {
          text: ({ nbHits }) => `${nbHits} extraits`,
        },
      }),

      instantsearch.widgets.clearRefinements({
        container: '#clear',
        templates: { resetLabel: 'Effacer filtres' },
      }),

      instantsearch.widgets.refinementList({
        container: '#section-facet',
        attribute: 'section',
        sortBy: ['name:asc'],
      }),

      instantsearch.widgets.refinementList({
        container: '#chapter-facet',
        attribute: 'chapter',
        limit: 10,
        showMore: true,
        showMoreLimit: 20,
      }),

      instantsearch.widgets.refinementList({
        container: '#themes-facet',
        attribute: 'themes',
        limit: 8,
        showMore: true,
        showMoreLimit: 30,
        searchable: true,
        searchablePlaceholder: 'Chercher un thème...',
      }),

      instantsearch.widgets.refinementList({
        container: '#concepts-facet',
        attribute: 'concepts',
        limit: 10,
        showMore: true,
        showMoreLimit: 50,
        searchable: true,
        searchablePlaceholder: 'Chercher un concept...',
      }),

      instantsearch.widgets.refinementList({
        container: '#type-facet',
        attribute: 'contentType',
      }),

      instantsearch.widgets.hits({
        container: '#hits',
        templates: {
          item: (hit, { html, components }) => html`
            <div class="hit-card" data-object-id="${hit.objectID}">
              <div class="hit-header">
                <span class="hit-section ${this.getSectionClass(hit.section)}">${hit.section || 'Intro'}</span>
                <span class="hit-chapter">${hit.chapterDisplay || hit.chapter || '0. Préambule'}</span>
                <span class="hit-page">p.${hit.page || '?'}</span>
                <button class="star-btn" data-object-id="${hit.objectID}" onclick="event.stopPropagation(); FavoritesModule.toggle('${hit.objectID}')">☆</button>
              </div>
              <div class="hit-main" onclick="ModalModule.open('${hit.objectID}')">
                <div class="hit-content">
                  ${components.Highlight({ hit, attribute: 'content' })}
                </div>
                ${hit.concepts?.length ? html`
                  <div class="hit-themes">
                    ${hit.concepts.slice(0, 4).map(t => html`<span class="hit-theme">${t}</span>`)}
                  </div>
                ` : ''}
              </div>
            </div>
          `,
          empty: (_, { html }) => html`
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
              <p>Aucun résultat trouvé.</p>
              <p style="font-size: 0.85rem;">Essayez d'autres termes ou filtres.</p>
            </div>
          `,
        },
      }),

      instantsearch.widgets.pagination({
        container: '#pagination',
        padding: 2,
      }),
    ]);
  },

  getSectionClass(section) {
    if (!section) return '';
    const lower = section.toLowerCase();
    if (lower === 'comprendre') return 'comprendre';
    if (lower === 'agir') return 'agir';
    return '';
  },

  onRender() {
    const hits = this.instance.renderState[CONFIG.indexName]?.hits?.hits || [];
    this.currentHits = {};
    hits.forEach(h => { this.currentHits[h.objectID] = h; });
    // Update favorites UI after render
    setTimeout(() => FavoritesModule.updateUI(), 10);
  },

  getHit(objectID) {
    return this.currentHits[objectID];
  },

  clearAndSearch() {
    this.instance.helper.setQuery('').search();
  }
};

// ============ MODAL MODULE ============
const ModalModule = {
  overlay: document.getElementById('modal'),
  section: document.getElementById('modal-section'),
  chapter: document.getElementById('modal-chapter'),
  page: document.getElementById('modal-page'),
  body: document.getElementById('modal-body'),
  related: document.getElementById('modal-related'),
  selectedHit: null,

  init() {
    document.getElementById('modal-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  },

  async open(objectID) {
    const hit = SearchModule.getHit(objectID);
    if (!hit) return;

    this.selectedHit = hit;

    // Highlight selected card
    document.querySelectorAll('.hit-card').forEach(el => el.classList.remove('selected'));
    document.querySelector(`[data-object-id="${objectID}"]`)?.classList.add('selected');

    // Populate modal
    this.section.textContent = hit.section || 'Intro';
    this.section.className = `hit-section ${SearchModule.getSectionClass(hit.section)}`;
    this.chapter.textContent = hit.chapterDisplay || hit.chapter || '0. Préambule';
    this.page.textContent = `p.${hit.page || '?'}`;
    this.body.innerHTML = hit.content || '';

    // Load related via Recommend or fallback
    await this.loadRelated(hit);

    this.overlay.classList.add('active');
  },

  close() {
    this.overlay.classList.remove('active');
  },

  async loadRelated(hit) {
    this.related.innerHTML = '<span style="color: var(--text-muted);">Chargement...</span>';

    try {
      // Search by concepts/themes
      const tags = [...(hit.concepts || []), ...(hit.themes || [])].slice(0, 3);
      if (tags.length === 0) {
        this.related.innerHTML = '<span style="color: var(--text-muted);">-</span>';
        return;
      }

      const { results } = await SearchModule.client.search([{
        indexName: CONFIG.indexName,
        query: '',
        filters: tags.map(t => `concepts:"${t}" OR themes:"${t}"`).join(' OR '),
        hitsPerPage: 5,
        attributesToRetrieve: ['objectID', 'chapter', 'page', 'section'],
      }]);

      const related = results[0].hits.filter(h => h.objectID !== hit.objectID).slice(0, 4);
      this.renderRelated(related, hit.objectID);

    } catch (e) {
      console.error('Related error:', e);
      this.related.innerHTML = '<span style="color: var(--text-muted);">-</span>';
    }
  },

  renderRelated(hits, excludeId) {
    const filtered = hits.filter(h => h.objectID !== excludeId).slice(0, 4);
    if (filtered.length === 0) {
      this.related.innerHTML = '<span style="color: var(--text-muted);">-</span>';
      return;
    }

    this.related.innerHTML = filtered.map(r => `
      <button class="related-chip" onclick="ModalModule.jumpTo('${r.objectID}')">
        ${r.chapterDisplay || r.chapter || 'Extrait'} (p.${r.page || '?'})
      </button>
    `).join('');
  },

  jumpTo(objectID) {
    this.close();
    SearchModule.clearAndSearch();
    setTimeout(() => {
      const el = document.querySelector(`[data-object-id="${objectID}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
      }
    }, 300);
  }
};

// ============ QUERY SUGGESTIONS MODULE ============
const QSModule = {
  container: document.getElementById('chat-suggestions'),

  // Content questions about the book
  contentSuggestions: [
    "De quoi parle ce livre ?",
    "Comment gérer mon temps ?",
    "C'est quoi l'honnêteté positive ?",
    "Quelles sont les phases de travail ?",
    "Comment dire non ?",
    "C'est quoi les effets cumulés ?",
    "Comment mieux planifier ?",
    "Qu'est-ce que la connaissance de soi ?",
    "Comment accepter la critique ?",
    "Qu'est-ce que la vision long terme ?",
  ],

  // Feature discovery prompts (context-aware)
  featurePrompts: [
    "Résume mes favoris en 3 points clés",
    "Explique ces résultats simplement",
    "Suggère un plan d'action basé sur mes favoris",
    "Quels concepts relient mes favoris ?",
    "Comment appliquer ça en tant que PM ?",
    "Trouve les contradictions dans mes favoris",
    "Crée un quiz sur mes favoris",
    "Quel chapitre explorer ensuite ?",
    "Compare ces extraits entre eux",
    "Donne-moi un défi basé sur ces concepts",
  ],

  contentIndex: 0,
  featureIndex: 0,
  showingFeatures: false,

  init() {
    this.render();
  },

  render() {
    const pool = this.showingFeatures ? this.featurePrompts : this.contentSuggestions;
    const idx = this.showingFeatures ? this.featureIndex : this.contentIndex;

    const toShow = [];
    for (let i = 0; i < 3; i++) {
      toShow.push(pool[(idx + i) % pool.length]);
    }

    const modeLabel = this.showingFeatures ? '📚' : '✨';
    const modeTitle = this.showingFeatures ? 'Questions livre' : 'Actions contextuelles';

    this.container.innerHTML = toShow.map(s => `
      <button class="suggestion-chip" onclick="QSModule.use('${s.replace(/'/g, "\\'")}')">${s}</button>
    `).join('') + `
      <button class="suggestion-chip" onclick="QSModule.refresh()" title="Autres suggestions">🔄</button>
      <button class="suggestion-chip mode-toggle" onclick="QSModule.toggleMode()" title="${modeTitle}">${modeLabel}</button>
    `;
  },

  refresh() {
    if (this.showingFeatures) {
      this.featureIndex = (this.featureIndex + 3) % this.featurePrompts.length;
    } else {
      this.contentIndex = (this.contentIndex + 3) % this.contentSuggestions.length;
    }
    this.render();
  },

  toggleMode() {
    this.showingFeatures = !this.showingFeatures;
    this.render();
  },

  use(question) {
    ChatModule.setInput(question);
    ChatModule.send();
  }
};

// ============ CHAT MODULE ============
const ChatModule = {
  messages: document.getElementById('chat-messages'),
  input: document.getElementById('chat-input'),
  sendBtn: document.getElementById('chat-send'),
  history: [],

  init() {
    this.sendBtn.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send();
    });
    this.input.focus();
  },

  setInput(text) {
    this.input.value = text;
  },

  addMessage(content, role) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;

    if (role === 'assistant') {
      msg.innerHTML = marked.parse(content);
    } else {
      msg.textContent = content;
    }

    this.messages.appendChild(msg);
    this.messages.scrollTop = this.messages.scrollHeight;
  },

  showTyping() {
    const typing = document.createElement('div');
    typing.className = 'message assistant typing';
    typing.id = 'typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    this.messages.appendChild(typing);
    this.messages.scrollTop = this.messages.scrollHeight;
  },

  hideTyping() {
    document.getElementById('typing')?.remove();
  },

  async send() {
    const question = this.input.value.trim();
    if (!question) return;

    this.addMessage(question, 'user');
    this.input.value = '';
    this.sendBtn.disabled = true;
    this.showTyping();

    // Build context-enriched message for agent
    const context = FavoritesModule.formatContextForAgent();
    const enrichedQuestion = context + question;

    this.history.push({ role: 'user', content: enrichedQuestion });

    try {
      const url = `${CONFIG.agentUrl}/1/agents/${CONFIG.agentId}/completions?compatibilityMode=ai-sdk-4&stream=false`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Algolia-Application-Id': CONFIG.applicationId,
          'X-Algolia-API-Key': CONFIG.searchKey,
        },
        body: JSON.stringify({
          messages: this.history.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();
      this.hideTyping();

      let answer = data.content || '';
      if (data.parts?.length) {
        answer = data.parts.filter(p => p.type === 'text').map(p => p.text).join('');
      }
      if (!answer) answer = data.message || 'Pas de réponse.';

      this.history.push({ role: 'assistant', content: answer });
      this.addMessage(answer, 'assistant');

      // Refresh QS after response
      QSModule.refresh();

    } catch (e) {
      this.hideTyping();
      this.addMessage(`Erreur: ${e.message}`, 'assistant');
    } finally {
      this.sendBtn.disabled = false;
      this.input.focus();
    }
  },

  reset() {
    this.history = [];
    this.messages.innerHTML = `
      <div class="message assistant">
        <p>Bonjour ! Je suis votre compagnon pour explorer <strong>Human Machine</strong>.</p>
        <p>Parcourez les extraits à gauche ou posez-moi une question.</p>
      </div>
    `;
  },

  askAboutSelected() {
    if (!ModalModule.selectedHit) return;
    const hit = ModalModule.selectedHit;
    const topics = [...(hit.concepts || []), ...(hit.themes || [])].slice(0, 2).join(', ');
    const q = `Parle-moi de "${hit.chapter}" concernant: ${topics || 'ce sujet'}`;
    this.setInput(q);
    this.input.focus();
  }
};

// ============ FAVORITES MODULE ============
const FavoritesModule = {
  favorites: new Map(), // objectID -> hit data
  pendingRemovals: new Set(), // Track removals until modal closes

  init() {
    // Load from localStorage
    const saved = localStorage.getItem('machina_favorites');
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        arr.forEach(hit => this.favorites.set(hit.objectID, hit));
      } catch (e) {}
    }
  },

  save() {
    localStorage.setItem('machina_favorites', JSON.stringify([...this.favorites.values()]));
  },

  toggle(objectID) {
    if (this.favorites.has(objectID)) {
      this.favorites.delete(objectID);
    } else {
      const hit = SearchModule.getHit(objectID) || ModalModule.selectedHit;
      if (hit) {
        this.favorites.set(objectID, {
          objectID: hit.objectID,
          chapter: hit.chapter,
          chapterDisplay: hit.chapterDisplay,
          page: hit.page,
          section: hit.section,
          content: hit.content?.slice(0, 200),
          concepts: hit.concepts?.slice(0, 3),
        });
      }
    }
    this.save();
    this.updateUI();
  },

  isFavorite(objectID) {
    return this.favorites.has(objectID);
  },

  getAll() {
    return [...this.favorites.values()];
  },

  updateUI() {
    // Update all star buttons
    document.querySelectorAll('.star-btn').forEach(btn => {
      const id = btn.dataset.objectId;
      btn.classList.toggle('active', this.isFavorite(id));
      btn.textContent = this.isFavorite(id) ? '★' : '☆';
    });
    // Update header count
    const count = this.favorites.size;
    document.getElementById('fav-count').textContent = count > 0 ? `(${count})` : '';
  },

  openModal() {
    this.pendingRemovals.clear();
    const modal = document.getElementById('favorites-modal');
    const list = document.getElementById('favorites-list');

    const favs = this.getAll();
    if (favs.length === 0) {
      list.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Aucun favori. Cliquez ☆ sur un extrait pour l\'ajouter.</p>';
    } else {
      list.innerHTML = favs.map(f => `
        <div class="fav-item" data-object-id="${f.objectID}">
          <div class="fav-content">
            <div class="fav-header">
              <span class="hit-section ${SearchModule.getSectionClass(f.section)}">${f.section || 'Intro'}</span>
              <strong>${f.chapterDisplay || f.chapter}</strong>
              <span class="hit-page">p.${f.page}</span>
            </div>
            <p class="fav-snippet">${f.content || ''}...</p>
            ${f.concepts?.length ? `<div class="hit-themes">${f.concepts.map(c => `<span class="hit-theme">${c}</span>`).join('')}</div>` : ''}
          </div>
          <button class="star-btn active" onclick="FavoritesModule.toggleInModal('${f.objectID}')">★</button>
        </div>
      `).join('');
    }

    modal.classList.add('active');
  },

  toggleInModal(objectID) {
    const item = document.querySelector(`.fav-item[data-object-id="${objectID}"]`);
    const btn = item?.querySelector('.star-btn');

    if (this.pendingRemovals.has(objectID)) {
      // Undo removal
      this.pendingRemovals.delete(objectID);
      item?.classList.remove('pending-removal');
      if (btn) { btn.textContent = '★'; btn.classList.add('active'); }
    } else {
      // Mark for removal (soft delete until modal closes)
      this.pendingRemovals.add(objectID);
      item?.classList.add('pending-removal');
      if (btn) { btn.textContent = '↩'; btn.classList.remove('active'); }
    }
  },

  closeModal() {
    // Apply pending removals
    this.pendingRemovals.forEach(id => this.favorites.delete(id));
    this.pendingRemovals.clear();
    this.save();
    this.updateUI();
    document.getElementById('favorites-modal').classList.remove('active');
  },

  // Build compressed context for agent
  buildContext() {
    const ctx = {
      query: SearchModule.instance.helper?.state?.query || '',
      filters: {},
      favorites: [],
    };

    // Get active refinements
    const state = SearchModule.instance.helper?.state;
    if (state?.disjunctiveFacetsRefinements) {
      Object.entries(state.disjunctiveFacetsRefinements).forEach(([attr, values]) => {
        if (values?.length) ctx.filters[attr] = values;
      });
    }

    // Compress favorites
    ctx.favorites = this.getAll().map(f => ({
      ch: f.chapterDisplay || f.chapter,
      p: f.page,
      snip: f.content?.slice(0, 100),
      tags: f.concepts?.join(', '),
    }));

    return ctx;
  },

  formatContextForAgent() {
    const ctx = this.buildContext();
    const parts = [];

    if (ctx.query) parts.push(`Recherche: "${ctx.query}"`);

    const filterParts = Object.entries(ctx.filters).map(([k, v]) => `${k}: ${v.join(', ')}`);
    if (filterParts.length) parts.push(`Filtres: ${filterParts.join('; ')}`);

    if (ctx.favorites.length) {
      parts.push(`Favoris (${ctx.favorites.length}):`);
      ctx.favorites.forEach((f, i) => {
        parts.push(`  ${i+1}. [${f.ch}, p.${f.p}] "${f.snip}..." (${f.tags || '-'})`);
      });
    }

    return parts.length ? `[CONTEXTE UTILISATEUR]\n${parts.join('\n')}\n[/CONTEXTE]\n\n` : '';
  }
};

// ============ WORD CLOUD MODULE ============
const WordCloudModule = {
  container: document.getElementById('word-cloud'),

  init() {
    // Render after search renders
    SearchModule.instance.on('render', () => this.render());
  },

  render() {
    const facets = SearchModule.instance.renderState[CONFIG.indexName]?.refinementList?.concepts?.items || [];
    if (facets.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    const maxCount = Math.max(...facets.map(f => f.count));
    const tags = facets.slice(0, 20).map(f => {
      const ratio = f.count / maxCount;
      let size = 1;
      if (ratio > 0.8) size = 5;
      else if (ratio > 0.6) size = 4;
      else if (ratio > 0.4) size = 3;
      else if (ratio > 0.2) size = 2;

      return `<span class="word-tag size-${size}" onclick="WordCloudModule.filter('${f.value.replace(/'/g, "\\'")}')">${f.value}</span>`;
    });

    this.container.innerHTML = tags.join('');
  },

  filter(concept) {
    SearchModule.instance.helper.toggleFacetRefinement('concepts', concept).search();
  }
};

// ============ APP INIT ============
document.addEventListener('DOMContentLoaded', () => {
  ThemeModule.init();
  FavoritesModule.init();
  SearchModule.init();
  ModalModule.init();
  QSModule.init();
  ChatModule.init();
  WordCloudModule.init();
});

// Global exports for onclick handlers
window.ModalModule = ModalModule;
window.QSModule = QSModule;
window.ChatModule = ChatModule;
window.WordCloudModule = WordCloudModule;
window.FavoritesModule = FavoritesModule;
