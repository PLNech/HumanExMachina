/**
 * Agent Machina - RAG Chat Client for Human Machine
 * Rich UI with Markdown, Algolia Recommend, and smart suggestions
 */

// Configuration
const CONFIG = {
  baseUrl: 'https://agent-studio.eu.algolia.com',
  applicationId: 'latency',
  apiKey: 'c5a80e18b6a631c35917c31e5d56fd86',
  agentId: '3669b83e-4138-4db0-8b9f-f78c9e88d053',
  indexName: 'machina_v3',
};

// DOM Elements
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const themeToggle = document.getElementById('theme-toggle');
const suggestionsList = document.getElementById('suggestions-list');
const welcomeSuggestions = document.getElementById('welcome-suggestions');
const suggestionsRefresh = document.getElementById('suggestions-refresh');
const resetBtn = document.getElementById('reset-btn');

// State
let conversationHistory = [];
let usedQueries = new Set();
let currentSuggestions = [];
let lastHits = [];

// Initialize Algolia Insights
if (typeof aa !== 'undefined') {
  aa('init', {
    appId: CONFIG.applicationId,
    apiKey: CONFIG.apiKey,
    useCookie: true,
  });
  const userToken = localStorage.getItem('userToken') || 'anon-' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('userToken', userToken);
  aa('setUserToken', userToken);
}

// Configure marked for safe rendering
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

// ============ THEME MANAGEMENT ============
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeToggle.querySelector('.theme-icon').textContent = theme === 'light' ? '🌙' : '☀️';
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'light' ? 'dark' : 'light');
});

// ============ SUGGESTIONS SYSTEM ============
const SUGGESTIONS = {
  intro: "De quoi parle ce livre ?",
  exploratory: [
    "Comment mieux gerer mon temps au quotidien ?",
    "Comment prendre de meilleures decisions ?",
    "Comment trouver l'equilibre entre vie pro et perso ?",
  ],
  openers: [
    "C'est quoi l'honnetete positive ?",
    "Pourquoi dit-on qu'il faut savoir dire non ?",
    "Comment fonctionne la machine humaine ?",
    "Qu'est-ce que les phases de travail ?",
    "Pourquoi les routines sont-elles importantes ?",
    "Comment gerer la pression au travail ?",
    "Que signifie decidere etymologiquement ?",
    "Comment provoquer sa chance ?",
    "Pourquoi faut-il desynchroniser les echanges ?",
    "Comment identifier ses faiblesses pour progresser ?",
  ],
};

function getRandomItem(arr, exclude = []) {
  const available = arr.filter(x => !exclude.includes(x));
  if (available.length === 0) return arr[Math.floor(Math.random() * arr.length)];
  return available[Math.floor(Math.random() * available.length)];
}

function generateSuggestions() {
  const used = Array.from(usedQueries);
  currentSuggestions = [
    SUGGESTIONS.intro,
    getRandomItem(SUGGESTIONS.exploratory, used),
    getRandomItem(SUGGESTIONS.openers, used),
  ];
  return currentSuggestions;
}

function renderSuggestionButton(text, container) {
  const btn = document.createElement('button');
  btn.className = 'suggestion' + (usedQueries.has(text) ? ' used' : '');
  btn.textContent = text;
  btn.onclick = () => sendMessage(text);
  container.appendChild(btn);
  return btn;
}

function updateSuggestions() {
  const suggestions = generateSuggestions();

  // Update main suggestions
  suggestionsList.innerHTML = '';
  suggestions.forEach(s => renderSuggestionButton(s, suggestionsList));

  // Update welcome suggestions if visible
  if (welcomeSuggestions) {
    welcomeSuggestions.innerHTML = '';
    suggestions.forEach(s => renderSuggestionButton(s, welcomeSuggestions));
  }
}

suggestionsRefresh.addEventListener('click', updateSuggestions);

// ============ HIT RENDERING ============
function getSectionClass(section) {
  if (!section) return 'introduction';
  const lower = section.toLowerCase();
  if (lower === 'comprendre') return 'comprendre';
  if (lower === 'agir') return 'agir';
  return 'introduction';
}

function getTypeLabel(type) {
  const labels = {
    'summary': 'Resume',
    'practice': 'Pratique',
    'chapter_intro': 'Intro',
    'content': 'Contenu',
    'bibliography': 'Biblio',
  };
  return labels[type] || 'Contenu';
}

function renderHit(hit, index) {
  const page = hit.page || '?';
  const chapter = hit.chapter || 'Preambule';
  const section = hit.section || 'Introduction';
  const subsection = hit.subsection || '';
  const contentType = hit.contentType || 'content';
  const themes = hit.themes || [];

  // Get content with highlighting
  let snippet = hit._snippetResult?.content?.value ||
                hit._highlightResult?.content?.value ||
                hit.content || '';
  if (snippet.length > 180) snippet = snippet.slice(0, 180) + '...';

  const fullContent = hit.content || '';
  const sectionClass = getSectionClass(section);
  const objectID = hit.objectID || `hit-${index}`;

  return `
    <div class="hit" data-object-id="${objectID}" onclick="toggleHit(this)">
      <div class="hit-main">
        <div class="hit-header">
          <span class="hit-section ${sectionClass}">${section}</span>
          <span class="hit-chapter">${chapter}</span>
          <div class="hit-meta">
            <span class="hit-type">${getTypeLabel(contentType)}</span>
            <span class="hit-page">p.${page}</span>
          </div>
        </div>
        ${subsection ? `<div class="hit-subsection">${subsection}</div>` : ''}
        <div class="hit-content">${snippet}</div>
        ${themes.length > 0 ? `
          <div class="hit-themes">
            ${themes.slice(0, 4).map(t => `<span class="hit-theme">${t}</span>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="hit-expanded">${fullContent}</div>
    </div>
  `;
}

function renderSources(hits) {
  if (!hits || hits.length === 0) return '';

  lastHits = hits;
  const hitsHtml = hits.map((hit, i) => renderHit(hit, i)).join('');

  return `
    <div class="sources-section">
      <div class="sources-header">
        <div class="sources-title">
          Sources consultees
          <span class="sources-count">${hits.length}</span>
        </div>
        ${hits.length > 2 ? `<button class="sources-toggle" onclick="toggleSources(this)">Voir tout</button>` : ''}
      </div>
      <div class="hits-grid ${hits.length > 2 ? 'collapsed' : ''}">${hitsHtml}</div>
    </div>
  `;
}

// Global functions for onclick handlers
window.toggleHit = function(hitEl) {
  hitEl.classList.toggle('expanded');

  // Track click event
  if (typeof aa !== 'undefined') {
    const objectID = hitEl.dataset.objectId;
    aa('clickedObjectIDs', {
      index: CONFIG.indexName,
      eventName: 'Source Expanded',
      objectIDs: [objectID],
    });
  }
};

window.toggleSources = function(btn) {
  const grid = btn.closest('.sources-section').querySelector('.hits-grid');
  grid.classList.toggle('collapsed');
  btn.textContent = grid.classList.contains('collapsed') ? 'Voir tout' : 'Reduire';
};

// ============ RELATED CONTENT (RECOMMEND) ============
async function fetchRelatedContent(hits) {
  if (!hits || hits.length === 0) return [];

  try {
    // Use Algolia search to find related content based on themes
    const themes = [...new Set(hits.flatMap(h => h.themes || []))].slice(0, 3);
    if (themes.length === 0) return [];

    const response = await fetch(`https://${CONFIG.applicationId}-dsn.algolia.net/1/indexes/${CONFIG.indexName}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': CONFIG.applicationId,
        'X-Algolia-API-Key': CONFIG.apiKey,
      },
      body: JSON.stringify({
        query: '',
        filters: themes.map(t => `themes:"${t}"`).join(' OR '),
        hitsPerPage: 5,
        attributesToRetrieve: ['objectID', 'chapter', 'page', 'themes'],
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    // Filter out hits already shown
    const existingIds = new Set(hits.map(h => h.objectID));
    return data.hits.filter(h => !existingIds.has(h.objectID)).slice(0, 3);
  } catch (e) {
    console.error('Related content error:', e);
    return [];
  }
}

function renderRelated(related) {
  if (!related || related.length === 0) return '';

  const chips = related.map(r => {
    const label = `${r.chapter} (p.${r.page})`;
    return `<button class="related-chip" onclick="askAboutChunk('${r.objectID}')">${label}</button>`;
  }).join('');

  return `
    <div class="related-section">
      <div class="related-title">Contenus lies</div>
      <div class="related-chips">${chips}</div>
    </div>
  `;
}

window.askAboutChunk = async function(objectID) {
  // Fetch the chunk content and ask about it
  try {
    const response = await fetch(`https://${CONFIG.applicationId}-dsn.algolia.net/1/indexes/${CONFIG.indexName}/${objectID}`, {
      headers: {
        'X-Algolia-Application-Id': CONFIG.applicationId,
        'X-Algolia-API-Key': CONFIG.apiKey,
      },
    });

    if (response.ok) {
      const hit = await response.json();
      const question = `Parle-moi de "${hit.chapter}" concernant: ${hit.themes?.slice(0, 2).join(', ') || 'ce sujet'}`;
      sendMessage(question);
    }
  } catch (e) {
    console.error('Fetch chunk error:', e);
  }
};

// ============ MESSAGE RENDERING ============
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  // Fallback: basic formatting
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function addMessage(content, role, hits = null, related = null) {
  const welcome = chat.querySelector('.welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (role === 'assistant') {
    const sourcesHtml = renderSources(hits);
    const relatedHtml = renderRelated(related);
    const contentHtml = renderMarkdown(content);
    msg.innerHTML = sourcesHtml + `<div class="response-text">${contentHtml}</div>` + relatedHtml;
  } else if (role === 'error') {
    msg.textContent = content;
  } else {
    msg.textContent = content;
  }

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
  return msg;
}

function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'message assistant typing';
  typing.id = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chat.appendChild(typing);
  chat.scrollTop = chat.scrollHeight;
}

function hideTyping() {
  const typing = document.getElementById('typing');
  if (typing) typing.remove();
}

// ============ SEND MESSAGE ============
async function sendMessage(userMessage) {
  if (!userMessage.trim()) return;

  // Mark query as used
  usedQueries.add(userMessage);
  updateSuggestions();

  addMessage(userMessage, 'user');
  input.value = '';
  sendBtn.disabled = true;
  showTyping();

  conversationHistory.push({ role: 'user', content: userMessage });

  try {
    const url = `${CONFIG.baseUrl}/1/agents/${CONFIG.agentId}/completions?compatibilityMode=ai-sdk-4&stream=false`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': CONFIG.applicationId,
        'X-Algolia-API-Key': CONFIG.apiKey,
      },
      body: JSON.stringify({
        messages: conversationHistory.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    hideTyping();

    // Extract response content
    let assistantContent = data.content || '';
    if (data.parts && Array.isArray(data.parts)) {
      assistantContent = data.parts.filter(p => p.type === 'text').map(p => p.text).join('');
    }
    if (!assistantContent) {
      assistantContent = data.message || data.answer || 'Pas de reponse recue';
    }

    // Extract hits
    const toolInvocation = data.tool_invocations?.find(t => t.tool_name?.includes('search'));
    const hits = toolInvocation?.result?.hits || [];

    // Fetch related content
    const related = await fetchRelatedContent(hits);

    conversationHistory.push({ role: 'assistant', content: assistantContent });
    addMessage(assistantContent, 'assistant', hits, related);

    // Track conversion
    if (typeof aa !== 'undefined' && hits.length > 0) {
      aa('convertedObjectIDs', {
        index: CONFIG.indexName,
        eventName: 'Query Answered',
        objectIDs: hits.map(h => h.objectID).filter(Boolean),
      });
    }

  } catch (error) {
    hideTyping();
    addMessage(`Erreur: ${error.message}`, 'error');
    console.error('RAG API error:', error);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============ EVENT LISTENERS ============
sendBtn.addEventListener('click', () => sendMessage(input.value));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

// ============ RESET CONVERSATION ============
function resetConversation() {
  conversationHistory = [];
  usedQueries.clear();
  lastHits = [];

  // Clear chat and restore welcome
  chat.innerHTML = `
    <div class="welcome">
      <h2>Explorez le livre avec moi</h2>
      <p>Je vous aide a naviguer les concepts de Human Machine.
         Vous n'avez pas encore le livre ? <a href="https://www.humanmachine.com/?ref=pln-machina" target="_blank">Procurez-vous votre copie</a> pour une experience complete.</p>
      <div class="welcome-suggestions">
        <div class="suggestions-list" id="welcome-suggestions"></div>
      </div>
    </div>
  `;

  // Re-init suggestions in welcome
  const newWelcomeSuggestions = document.getElementById('welcome-suggestions');
  const suggestions = generateSuggestions();
  suggestions.forEach(s => renderSuggestionButton(s, newWelcomeSuggestions));

  updateSuggestions();
  input.focus();
}

resetBtn.addEventListener('click', resetConversation);

// ============ INITIALIZE ============
initTheme();
updateSuggestions();
input.focus();
