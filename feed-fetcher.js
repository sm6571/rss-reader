const RSSParser = require('rss-parser');
const cron = require('node-cron');
const { getDb } = require('./database');

const parser = new RSSParser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
  maxRedirects: 5
});

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const db = getDb();

    // Update feed metadata
    db.prepare(`
      UPDATE feeds SET title = ?, site_url = ?, last_fetched = datetime('now'), error = NULL WHERE id = ?
    `).run(parsed.title || feed.title || feed.url, parsed.link || '', feed.id);

    // Insert new articles
    const upsert = db.prepare(`
      INSERT INTO articles (feed_id, user_id, guid, title, url, author, summary, content, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id, guid) DO NOTHING
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const item of parsed.items || []) {
        const guid = item.guid || item.id || item.link || item.title;
        if (!guid) continue;

        const pubDate = item.pubDate || item.isoDate
          ? new Date(item.pubDate || item.isoDate).toISOString()
          : new Date().toISOString();

        const result = upsert.run(
          feed.id,
          feed.user_id,
          guid,
          (item.title || '').substring(0, 500),
          item.link || '',
          (item.creator || item.author || '').substring(0, 200),
          (item.contentSnippet || item.summary || '').substring(0, 1000),
          (item.content || item['content:encoded'] || '').substring(0, 50000),
          pubDate
        );
        if (result.changes > 0) newCount++;
      }
    });

    insertAll();
    return { success: true, newCount, title: parsed.title };
  } catch (err) {
    const db = getDb();
    db.prepare('UPDATE feeds SET error = ?, last_fetched = datetime(\'now\') WHERE id = ?')
      .run(err.message.substring(0, 500), feed.id);
    return { success: false, error: err.message };
  }
}

async function fetchAllFeeds() {
  const db = getDb();
  const feeds = db.prepare('SELECT * FROM feeds').all();
  let totalNew = 0;

  for (const feed of feeds) {
    const result = await fetchFeed(feed);
    if (result.success) totalNew += result.newCount;
  }

  return totalNew;
}

function cleanupOldArticles(daysToKeep = 30) {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM articles
    WHERE is_starred = 0 AND is_read = 1
    AND published_at < datetime('now', '-' || ? || ' days')
  `).run(daysToKeep);
  return result.changes;
}

function startScheduler(intervalMinutes = 15) {
  // Fetch feeds every N minutes
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    console.log(`[${new Date().toISOString()}] Fetching feeds...`);
    const newCount = await fetchAllFeeds();
    console.log(`[${new Date().toISOString()}] Done. ${newCount} new articles.`);
  });

  // Cleanup old articles daily at 3 AM
  cron.schedule('0 3 * * *', () => {
    const deleted = cleanupOldArticles(30);
    console.log(`[${new Date().toISOString()}] Cleanup: removed ${deleted} old articles.`);
  });

  console.log(`  Feed scheduler: every ${intervalMinutes} minutes`);
  console.log(`  Cleanup scheduler: daily at 3 AM (articles >30 days)`);
}

module.exports = { fetchFeed, fetchAllFeeds, cleanupOldArticles, startScheduler };
