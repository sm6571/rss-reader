const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'rss_reader.db');

let db;
let SQL;

function wrapDb(rawDb) {
  function saveToFile() {
    const data = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  let dirty = false;
  let saveTimer = null;
  function markDirty() {
    dirty = true;
    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        if (dirty) { saveToFile(); dirty = false; }
        saveTimer = null;
      }, 3000);
    }
  }

  return {
    exec(sql) { rawDb.run(sql); markDirty(); },
    prepare(sql) {
      return {
        run(...params) {
          rawDb.run(sql, params);
          markDirty();
          const lastId = rawDb.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
          const changes = rawDb.getRowsModified();
          return { lastInsertRowid: lastId, changes };
        },
        get(...params) {
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            rows.push(row);
          }
          stmt.free();
          return rows;
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        rawDb.run('BEGIN');
        try {
          const result = fn(...args);
          rawDb.run('COMMIT');
          markDirty();
          return result;
        } catch (e) {
          rawDb.run('ROLLBACK');
          throw e;
        }
      };
    },
    save() { saveToFile(); },
    close() { saveToFile(); rawDb.close(); }
  };
}

async function initDatabase() {
  SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  db = wrapDb(rawDb);
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT DEFAULT '',
      site_url TEXT DEFAULT '',
      category TEXT DEFAULT 'Uncategorized',
      favicon TEXT DEFAULT '',
      last_fetched TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, url)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      title TEXT DEFAULT '',
      url TEXT DEFAULT '',
      author TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      content TEXT DEFAULT '',
      published_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      is_read INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      UNIQUE(feed_id, guid)
    );

    CREATE INDEX IF NOT EXISTS idx_articles_user_read ON articles(user_id, is_read, published_at);
    CREATE INDEX IF NOT EXISTS idx_articles_user_starred ON articles(user_id, is_starred);
    CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles(feed_id, published_at);
    CREATE INDEX IF NOT EXISTS idx_feeds_user ON feeds(user_id);
  `);

  db.save();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

module.exports = { getDb, initDatabase };
