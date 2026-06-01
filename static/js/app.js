/* ── State ── */
let feeds = [];
let articles = [];
let currentFilter = { type: 'all' };
let currentArticle = null;
let showUnreadOnly = false;
let searchQuery = '';
let currentPage = 1;
let totalArticles = 0;
let searchTimer = null;

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  loadFeeds();
  loadArticles();
  setupKeyboardShortcuts();
  fetch('/auth/status').then(r => r.json()).then(s => {
    if (s.username) document.getElementById('footerUser').textContent = s.username;
  });
  setupMobileMenu();
});

/* ── Theme ── */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.setAttribute('data-bs-theme', next);
  localStorage.setItem('rss-theme', next);
}

/* ── Sidebar ── */
async function loadFeeds() {
  try {
    const res = await fetch('/api/feeds');
    feeds = await res.json();
    renderSidebar();
  } catch (err) { console.error('Failed to load feeds:', err); }
}

function renderSidebar() {
  const container = document.getElementById('feedList');
  const totalUnread = feeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);
  document.getElementById('totalUnread').textContent = totalUnread || '';
  if (totalUnread === 0) document.getElementById('totalUnread').style.display = 'none';
  else document.getElementById('totalUnread').style.display = '';

  // Group by category
  const categories = {};
  feeds.forEach(f => {
    const cat = f.category || 'Uncategorized';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(f);
  });

  // Update datalist for add feed modal
  const datalist = document.getElementById('categoryList');
  datalist.innerHTML = '';
  Object.keys(categories).forEach(c => {
    datalist.innerHTML += `<option value="${escapeHtml(c)}">`;
  });

  let html = '';
  for (const [cat, catFeeds] of Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0]))) {
    const catUnread = catFeeds.reduce((sum, f) => sum + (f.unread_count || 0), 0);
    html += `<div class="nav-category">${escapeHtml(cat)}${catUnread > 0 ? ` (${catUnread})` : ''}</div>`;
    for (const f of catFeeds) {
      const active = currentFilter.type === 'feed' && currentFilter.id == f.id ? ' active' : '';
      const errorIcon = f.error ? ' <span class="feed-error" title="' + escapeHtml(f.error) + '">⚠</span>' : '';
      html += `<div class="nav-item feed-item${active}" data-filter="feed" data-id="${f.id}" onclick="setFilter('feed', ${f.id})">
        <span class="nav-icon">📄</span>
        <span class="nav-label">${escapeHtml(f.title || f.url)}${errorIcon}</span>
        ${f.unread_count > 0 ? `<span class="badge">${f.unread_count}</span>` : ''}
      </div>`;
    }
  }

  if (feeds.length === 0) {
    html = '<div class="text-center text-muted small py-3">No feeds yet.<br>Click + to add one.</div>';
  }

  container.innerHTML = html;

  // Update active states
  document.querySelectorAll('.nav-item[data-filter]').forEach(el => {
    el.classList.toggle('active',
      (el.dataset.filter === currentFilter.type) &&
      (!el.dataset.id || el.dataset.id == currentFilter.id)
    );
  });
}

/* ── Filter & Navigation ── */
function setFilter(type, id) {
  currentFilter = { type, id };
  currentPage = 1;
  searchQuery = '';
  document.getElementById('searchBox').value = '';

  // Update toolbar title
  let title = 'All Articles';
  if (type === 'starred') title = '⭐ Starred';
  else if (type === 'feed') {
    const feed = feeds.find(f => f.id === id);
    title = feed ? (feed.title || feed.url) : 'Feed';
  } else if (type === 'category') {
    title = id;
  }
  document.getElementById('toolbarTitle').textContent = title;

  renderSidebar();
  loadArticles();
  closeReadingPane();
}

/* ── Articles ── */
async function loadArticles() {
  const params = new URLSearchParams();
  params.set('page', currentPage);
  params.set('limit', 50);

  if (currentFilter.type === 'feed') params.set('feed_id', currentFilter.id);
  if (currentFilter.type === 'category') params.set('category', currentFilter.id);
  if (currentFilter.type === 'starred') params.set('is_starred', 1);
  if (showUnreadOnly) params.set('is_read', 0);
  if (searchQuery) params.set('search', searchQuery);

  try {
    const res = await fetch('/api/articles?' + params);
    const data = await res.json();
    articles = data.articles;
    totalArticles = data.total;
    renderArticles();
  } catch (err) { console.error('Failed to load articles:', err); }
}

function renderArticles() {
  const container = document.getElementById('articleList');
  const emptyState = document.getElementById('emptyState');

  if (articles.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = 'flex';
    if (feeds.length === 0) {
      emptyState.querySelector('h3').textContent = 'No articles yet';
      emptyState.querySelector('p').textContent = 'Add your first feed to get started';
    } else if (showUnreadOnly) {
      emptyState.querySelector('h3').textContent = 'All caught up!';
      emptyState.querySelector('p').textContent = 'No unread articles';
    } else if (searchQuery) {
      emptyState.querySelector('h3').textContent = 'No results';
      emptyState.querySelector('p').textContent = 'Try a different search term';
    } else {
      emptyState.querySelector('h3').textContent = 'No articles';
      emptyState.querySelector('p').textContent = 'Waiting for feeds to refresh';
    }
    return;
  }

  emptyState.style.display = 'none';
  let html = '';
  for (const a of articles) {
    const readClass = a.is_read ? 'read' : 'unread';
    const activeClass = currentArticle && currentArticle.id === a.id ? ' active' : '';
    const starClass = a.is_starred ? 'starred' : '';
    html += `<div class="article-item ${readClass}${activeClass}" data-id="${a.id}" onclick="selectArticle(${a.id})">
      <span class="article-star ${starClass}" onclick="event.stopPropagation(); toggleStar(${a.id})">${a.is_starred ? '★' : '☆'}</span>
      <div class="article-info">
        <div class="article-title">${escapeHtml(a.title)}</div>
        <div class="article-meta">
          <span class="feed-name">${escapeHtml(a.feed_title || '')}</span>
          <span>·</span>
          <span>${timeAgo(a.published_at)}</span>
          ${a.author ? `<span>· ${escapeHtml(a.author)}</span>` : ''}
        </div>
        ${a.summary ? `<div class="article-summary">${escapeHtml(stripHtml(a.summary))}</div>` : ''}
      </div>
    </div>`;
  }

  // Load more button
  if (articles.length < totalArticles) {
    html += `<div class="text-center py-3"><button class="btn-icon" onclick="loadMore()">Load more (${totalArticles - articles.length} remaining)</button></div>`;
  }

  container.innerHTML = html;
}

async function loadMore() {
  currentPage++;
  const params = new URLSearchParams();
  params.set('page', currentPage);
  params.set('limit', 50);
  if (currentFilter.type === 'feed') params.set('feed_id', currentFilter.id);
  if (currentFilter.type === 'category') params.set('category', currentFilter.id);
  if (currentFilter.type === 'starred') params.set('is_starred', 1);
  if (showUnreadOnly) params.set('is_read', 0);
  if (searchQuery) params.set('search', searchQuery);

  const res = await fetch('/api/articles?' + params);
  const data = await res.json();
  articles = articles.concat(data.articles);
  totalArticles = data.total;
  renderArticles();
}

/* ── Select / Read Article ── */
async function selectArticle(id) {
  try {
    const res = await fetch(`/api/articles/${id}`);
    const article = await res.json();
    currentArticle = article;

    // Update list item
    const item = document.querySelector(`.article-item[data-id="${id}"]`);
    if (item) { item.classList.remove('unread'); item.classList.add('read', 'active'); }
    document.querySelectorAll('.article-item.active').forEach(el => {
      if (el.dataset.id != id) el.classList.remove('active');
    });

    // Update article in local array
    const idx = articles.findIndex(a => a.id === id);
    if (idx >= 0) articles[idx].is_read = 1;

    // Update unread counts
    const feed = feeds.find(f => f.id === article.feed_id);
    if (feed && feed.unread_count > 0) {
      feed.unread_count--;
      renderSidebar();
    }

    // Show reading pane
    const pane = document.getElementById('readingPane');
    const body = document.getElementById('readingBody');
    document.getElementById('rpOpenBtn').href = article.url;
    document.getElementById('rpStarBtn').textContent = article.is_starred ? '★' : '☆';
    document.getElementById('rpStarBtn').classList.toggle('active', article.is_starred);
    document.getElementById('rpReadBtn').textContent = article.is_read ? 'Mark unread' : 'Mark read';

    body.innerHTML = `
      <h1>${escapeHtml(article.title)}</h1>
      <div class="reading-meta">
        <strong>${escapeHtml(article.feed_title || '')}</strong>
        ${article.author ? ` · ${escapeHtml(article.author)}` : ''}
        · ${formatDate(article.published_at)}
        ${article.url ? ` · <a href="${escapeHtml(article.url)}" target="_blank">Open original ↗</a>` : ''}
      </div>
      <div class="reading-content">${article.content || article.summary || '<p class="text-muted">No content available</p>'}</div>
    `;

    pane.classList.add('open');
  } catch (err) { console.error('Failed to load article:', err); }
}

function closeReadingPane() {
  document.getElementById('readingPane').classList.remove('open');
  currentArticle = null;
  document.querySelectorAll('.article-item.active').forEach(el => el.classList.remove('active'));
}

/* ── Star / Read toggles ── */
async function toggleStar(id) {
  const res = await fetch(`/api/articles/${id}/star`, { method: 'PUT' });
  const data = await res.json();
  const idx = articles.findIndex(a => a.id === id);
  if (idx >= 0) articles[idx].is_starred = data.is_starred;
  if (currentArticle && currentArticle.id === id) {
    currentArticle.is_starred = data.is_starred;
    document.getElementById('rpStarBtn').textContent = data.is_starred ? '★' : '☆';
  }
  renderArticles();
}

function toggleStarCurrent() {
  if (currentArticle) toggleStar(currentArticle.id);
}

async function toggleReadCurrent() {
  if (!currentArticle) return;
  const endpoint = currentArticle.is_read ? 'unread' : 'read';
  await fetch(`/api/articles/${currentArticle.id}/${endpoint}`, { method: 'PUT' });
  currentArticle.is_read = currentArticle.is_read ? 0 : 1;
  const idx = articles.findIndex(a => a.id === currentArticle.id);
  if (idx >= 0) articles[idx].is_read = currentArticle.is_read;
  document.getElementById('rpReadBtn').textContent = currentArticle.is_read ? 'Mark unread' : 'Mark read';
  loadFeeds(); // refresh unread counts
  renderArticles();
}

async function markCurrentRead() {
  const body = {};
  if (currentFilter.type === 'feed') body.feed_id = currentFilter.id;
  else if (currentFilter.type === 'category') body.category = currentFilter.id;

  await fetch('/api/articles/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  loadFeeds();
  loadArticles();
}

/* ── Toolbar actions ── */
function toggleUnreadFilter() {
  showUnreadOnly = !showUnreadOnly;
  document.getElementById('filterUnreadBtn').classList.toggle('active', showUnreadOnly);
  currentPage = 1;
  loadArticles();
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = document.getElementById('searchBox').value.trim();
    currentPage = 1;
    loadArticles();
  }, 300);
}

async function refreshFeeds() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await fetch('/api/feeds/refresh-all', { method: 'POST' });
    await loadFeeds();
    await loadArticles();
  } catch (err) { console.error('Refresh failed:', err); }
  btn.disabled = false;
  btn.textContent = '🔄';
}

/* ── Add Feed ── */
function openAddFeedModal() {
  document.getElementById('feedUrl').value = '';
  document.getElementById('feedCategory').value = '';
  document.getElementById('addFeedAlert').style.display = 'none';
  new bootstrap.Modal(document.getElementById('addFeedModal')).show();
  setTimeout(() => document.getElementById('feedUrl').focus(), 300);
}

async function addFeed() {
  const url = document.getElementById('feedUrl').value.trim();
  const category = document.getElementById('feedCategory').value.trim() || 'Uncategorized';
  const alert = document.getElementById('addFeedAlert');
  const btn = document.getElementById('addFeedBtn');
  alert.style.display = 'none';

  if (!url) { alert.textContent = 'URL is required'; alert.style.display = 'block'; return; }

  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    const res = await fetch('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, category })
    });
    const data = await res.json();
    if (!res.ok) { alert.textContent = data.error; alert.style.display = 'block'; return; }

    bootstrap.Modal.getInstance(document.getElementById('addFeedModal')).hide();
    await loadFeeds();
    await loadArticles();
  } catch (err) {
    alert.textContent = 'Connection error';
    alert.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Feed';
  }
}

/* ── Settings ── */
function openSettingsModal() {
  renderManageFeeds();
  document.getElementById('importResult').style.display = 'none';
  new bootstrap.Modal(document.getElementById('settingsModal')).show();
}

function renderManageFeeds() {
  const container = document.getElementById('manageFeedsList');
  if (feeds.length === 0) {
    container.innerHTML = '<div class="text-muted small text-center py-2">No feeds</div>';
    return;
  }
  let html = '';
  for (const f of feeds) {
    html += `<div class="d-flex align-items-center gap-2 py-1" style="font-size:0.85rem;">
      <span class="flex-grow-1 text-truncate">${escapeHtml(f.title || f.url)}</span>
      <span class="text-muted small">${escapeHtml(f.category)}</span>
      <button class="btn-icon" style="font-size:0.75rem;" onclick="deleteFeed(${f.id})" title="Remove feed">🗑️</button>
    </div>`;
  }
  container.innerHTML = html;
}

async function deleteFeed(id) {
  if (!confirm('Remove this feed and all its articles?')) return;
  await fetch(`/api/feeds/${id}`, { method: 'DELETE' });
  await loadFeeds();
  if (currentFilter.type === 'feed' && currentFilter.id === id) setFilter('all');
  else loadArticles();
  renderManageFeeds();
}

async function importOPML() {
  const fileInput = document.getElementById('opmlFile');
  if (!fileInput.files.length) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  try {
    const res = await fetch('/api/feeds/import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    const msg = `Imported ${data.imported} feeds (${data.skipped} already existed)`;
    document.getElementById('importResult').textContent = msg;
    document.getElementById('importResult').style.display = 'block';
    fileInput.value = '';
    await loadFeeds();
    renderManageFeeds();
  } catch (err) { alert('Import failed: ' + err.message); }
}

/* ── Keyboard Shortcuts ── */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'j': navigateArticle(1); break;
      case 'k': navigateArticle(-1); break;
      case 's': toggleStarCurrent(); break;
      case 'r': toggleReadCurrent(); break;
      case 'o':
        if (currentArticle?.url) window.open(currentArticle.url, '_blank');
        break;
      case 'Escape': closeReadingPane(); break;
    }
  });
}

function navigateArticle(direction) {
  if (articles.length === 0) return;
  const currentIdx = currentArticle ? articles.findIndex(a => a.id === currentArticle.id) : -1;
  const nextIdx = currentIdx + direction;
  if (nextIdx >= 0 && nextIdx < articles.length) {
    selectArticle(articles[nextIdx].id);
    // Scroll article into view
    const item = document.querySelector(`.article-item[data-id="${articles[nextIdx].id}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }
}

/* ── Mobile ── */
function setupMobileMenu() {
  const check = () => {
    const mobile = window.innerWidth <= 768;
    document.getElementById('menuBtn').style.display = mobile ? '' : 'none';
    document.getElementById('sidebarCloseBtn').style.display = mobile ? '' : 'none';
    if (!mobile) document.getElementById('sidebar').classList.remove('open');
  };
  check();
  window.addEventListener('resize', check);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

/* ── Helpers ── */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
