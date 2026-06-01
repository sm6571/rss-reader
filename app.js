const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getDb, initDatabase } = require('./database');
const { fetchFeed, fetchAllFeeds, startScheduler } = require('./feed-fetcher');
const { parseOPML, generateOPML } = require('./opml');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production' }
}));
app.use(express.static(path.join(__dirname, 'static')));

// ── Auth helpers ──
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
}

const MAX_USERS = 2;
function userCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
}

// ── Auth routes ──
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.post('/auth/register', authLimiter, (req, res) => {
  if (userCount() >= MAX_USERS) return res.status(403).json({ error: `Registration closed — max ${MAX_USERS} accounts allowed` });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username.trim(), hash);
  req.session.userId = result.lastInsertRowid;
  req.session.username = username.trim();
  res.json({ status: 'ok' });
});

app.post('/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ status: 'ok' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ status: 'ok' });
});

app.post('/auth/change-password', authLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  res.json({ status: 'ok' });
});

app.get('/auth/status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.userId),
    username: req.session?.username || null,
    needsSetup: userCount() < MAX_USERS
  });
});

// ── All routes below require auth ──
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// ── Feeds API ──
app.get('/api/feeds', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const feeds = db.prepare(`
    SELECT f.*, 
      (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) as unread_count
    FROM feeds f WHERE f.user_id = ? ORDER BY f.category, f.title
  `).all(uid);
  res.json(feeds);
});

app.post('/api/feeds', async (req, res) => {
  const { url, category } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const db = getDb();
  const uid = req.session.userId;

  // Check duplicate
  const existing = db.prepare('SELECT id FROM feeds WHERE user_id = ? AND url = ?').get(uid, url);
  if (existing) return res.status(409).json({ error: 'Feed already exists' });

  // Insert feed
  const result = db.prepare('INSERT INTO feeds (user_id, url, category) VALUES (?, ?, ?)')
    .run(uid, url.trim(), (category || 'Uncategorized').trim());

  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(result.lastInsertRowid);

  // Fetch articles immediately
  const fetchResult = await fetchFeed(feed);

  const updated = db.prepare('SELECT *, (SELECT COUNT(*) FROM articles a WHERE a.feed_id = feeds.id AND a.is_read = 0) as unread_count FROM feeds WHERE id = ?')
    .get(result.lastInsertRowid);

  res.json({ status: 'ok', feed: updated, ...fetchResult });
});

app.put('/api/feeds/:id', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { title, category } = req.body;
  db.prepare('UPDATE feeds SET title = COALESCE(?, title), category = COALESCE(?, category) WHERE id = ? AND user_id = ?')
    .run(title || null, category || null, req.params.id, uid);
  res.json({ status: 'ok' });
});

app.delete('/api/feeds/:id', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  db.prepare('DELETE FROM articles WHERE feed_id = ? AND user_id = ?').run(req.params.id, uid);
  db.prepare('DELETE FROM feeds WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  res.json({ status: 'ok' });
});

app.post('/api/feeds/:id/refresh', async (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  const result = await fetchFeed(feed);
  res.json(result);
});

app.post('/api/feeds/refresh-all', async (req, res) => {
  const newCount = await fetchAllFeeds();
  res.json({ status: 'ok', newArticles: newCount });
});

// OPML import
app.post('/api/feeds/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const content = req.file.buffer.toString('utf-8');
    const feeds = parseOPML(content);
    if (feeds.length === 0) return res.status(400).json({ error: 'No feeds found in OPML' });

    const db = getDb();
    const uid = req.session.userId;
    let imported = 0, skipped = 0;

    for (const f of feeds) {
      const existing = db.prepare('SELECT id FROM feeds WHERE user_id = ? AND url = ?').get(uid, f.url);
      if (existing) { skipped++; continue; }
      db.prepare('INSERT INTO feeds (user_id, url, title, site_url, category) VALUES (?, ?, ?, ?, ?)')
        .run(uid, f.url, f.title, f.siteUrl, f.category || 'Uncategorized');
      imported++;
    }

    // Fetch all new feeds
    if (imported > 0) fetchAllFeeds(); // fire and forget

    res.json({ status: 'ok', imported, skipped, total: feeds.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OPML export
app.get('/api/feeds/export', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const feeds = db.prepare('SELECT * FROM feeds WHERE user_id = ? ORDER BY category, title').all(uid);
  const opml = generateOPML(feeds);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="feeds.opml"');
  res.send(opml);
});

// ── Articles API ──
app.get('/api/articles', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { feed_id, category, is_read, is_starred, search, page = 1, limit = 50 } = req.query;

  let where = 'a.user_id = ?';
  const params = [uid];

  if (feed_id) { where += ' AND a.feed_id = ?'; params.push(feed_id); }
  if (category) { where += ' AND f.category = ?'; params.push(category); }
  if (is_read !== undefined) { where += ' AND a.is_read = ?'; params.push(Number(is_read)); }
  if (is_starred !== undefined && is_starred !== '') { where += ' AND a.is_starred = ?'; params.push(Number(is_starred)); }
  if (search) { where += ' AND (a.title LIKE ? OR a.summary LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const lim = Math.min(parseInt(limit) || 50, 200);
  const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;
  params.push(lim, off);

  const articles = db.prepare(`
    SELECT a.id, a.feed_id, a.guid, a.title, a.url, a.author, a.summary,
           a.published_at, a.is_read, a.is_starred,
           f.title as feed_title, f.favicon as feed_favicon, f.category as feed_category
    FROM articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE ${where}
    ORDER BY a.published_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const countParams = params.slice(0, -2);
  const total = db.prepare(`
    SELECT COUNT(*) as count FROM articles a JOIN feeds f ON a.feed_id = f.id WHERE ${where}
  `).get(...countParams).count;

  res.json({ articles, total, page: parseInt(page) || 1, limit: lim });
});

app.get('/api/articles/:id', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const article = db.prepare(`
    SELECT a.*, f.title as feed_title, f.favicon as feed_favicon
    FROM articles a JOIN feeds f ON a.feed_id = f.id
    WHERE a.id = ? AND a.user_id = ?
  `).get(req.params.id, uid);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  // Auto-mark as read
  if (!article.is_read) {
    db.prepare('UPDATE articles SET is_read = 1 WHERE id = ?').run(article.id);
    article.is_read = 1;
  }
  res.json(article);
});

app.put('/api/articles/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE articles SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ status: 'ok' });
});

app.put('/api/articles/:id/unread', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE articles SET is_read = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ status: 'ok' });
});

app.put('/api/articles/:id/star', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const article = db.prepare('SELECT is_starred FROM articles WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!article) return res.status(404).json({ error: 'Not found' });
  const newVal = article.is_starred ? 0 : 1;
  db.prepare('UPDATE articles SET is_starred = ? WHERE id = ? AND user_id = ?').run(newVal, req.params.id, uid);
  res.json({ status: 'ok', is_starred: newVal });
});

app.post('/api/articles/mark-read', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { feed_id, category } = req.body;

  if (feed_id) {
    db.prepare('UPDATE articles SET is_read = 1 WHERE feed_id = ? AND user_id = ? AND is_read = 0').run(feed_id, uid);
  } else if (category) {
    db.prepare(`
      UPDATE articles SET is_read = 1
      WHERE user_id = ? AND is_read = 0
      AND feed_id IN (SELECT id FROM feeds WHERE user_id = ? AND category = ?)
    `).run(uid, uid, category);
  } else {
    db.prepare('UPDATE articles SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(uid);
  }
  res.json({ status: 'ok' });
});

// ── Stats ──
app.get('/api/stats', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM feeds WHERE user_id = ?) as total_feeds,
      (SELECT COUNT(*) FROM articles WHERE user_id = ? AND is_read = 0) as unread_count,
      (SELECT COUNT(*) FROM articles WHERE user_id = ? AND is_starred = 1) as starred_count,
      (SELECT COUNT(*) FROM articles WHERE user_id = ?) as total_articles
  `).get(uid, uid, uid, uid);
  res.json(stats);
});

const PORT = process.env.PORT || 3001;

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  RSS Reader running at http://localhost:${PORT}\n`);
    startScheduler(15);
    console.log('');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
