# RSS Reader — Project Init

> Reference doc for iterating on this project. Covers architecture, stack, data model, API surface, and deployment.

## Overview

A self-hosted RSS/Atom feed reader for aggregating news, finance, and tech articles. Supports feed management, full-text article extraction, OPML import/export, keyboard navigation, and background feed fetching. Designed for Docker deployment on a home server with Tailscale access.

---

## Tech Stack

| Layer          | Technology                                  |
|----------------|---------------------------------------------|
| Runtime        | Node.js 22 LTS                              |
| Framework      | Express 5.x                                 |
| Database       | SQLite via `sql.js` (in-memory, persisted)  |
| Auth           | `bcryptjs` + `express-session`              |
| RSS Parsing    | `rss-parser`                                |
| Article Extract| `@extractus/article-extractor` (ESM, dynamic import) |
| Scheduling     | `node-cron` (feed fetch every 15 min)       |
| File Upload    | `multer` (OPML import)                      |
| Security       | `express-rate-limit` (5 req/15 min on auth) |
| Frontend       | Vanilla JS + Bootstrap 5.3 (no framework)   |
| Hosting        | Docker + docker-compose (port 3001)         |

---

## File Structure

```
rss-reader/
├── app.js                  # Express server — auth, feeds, articles, stats APIs
├── database.js             # sql.js wrapper (mimics better-sqlite3 API), schema init
├── feed-fetcher.js         # RSS/Atom parsing, cron scheduler, auto-cleanup
├── article-extractor.js    # Full-text extraction wrapper (dynamic ESM import)
├── opml.js                 # OPML import/export (regex-based XML parsing)
├── package.json            # Dependencies & scripts
├── Dockerfile              # Node 22 Alpine, port 3001
├── docker-compose.yml      # Service config with named volume
├── .dockerignore           # Excludes node_modules, *.db, .git
├── .gitignore              # Excludes node_modules/, *.db
├── README.md               # User-facing docs
├── static/
│   ├── css/style.css       # All styles — dark/light theme, sidebar layout (~10 KB)
│   └── js/app.js           # Frontend logic — feeds, articles, reading pane (~19 KB)
└── templates/
    ├── index.html          # Main app shell — sidebar + article list + reading pane (~7 KB)
    └── login.html          # Login/register page (~6 KB)
```

---

## Database Schema

SQLite database persisted to `DB_PATH` (default: `./rss_reader.db`).
The `database.js` wrapper auto-saves to disk every 3 seconds after writes.

### `users`
| Column     | Type    | Notes                    |
|------------|---------|--------------------------|
| id         | INTEGER | PK, autoincrement        |
| username   | TEXT    | Unique, not null         |
| password   | TEXT    | bcrypt hash              |
| created_at | TEXT    | ISO datetime             |

- **Max 2 users** enforced in app code (`MAX_USERS = 2`)

### `feeds`
| Column       | Type    | Notes                          |
|--------------|---------|--------------------------------|
| id           | INTEGER | PK, autoincrement              |
| user_id      | INTEGER | FK to users                    |
| url          | TEXT    | Feed URL                       |
| title        | TEXT    | Feed title (fetched from RSS)  |
| site_url     | TEXT    | Link to the site               |
| category     | TEXT    | User-assigned (default: 'Uncategorized') |
| favicon      | TEXT    | Site favicon URL               |
| last_fetched | TEXT    | Last successful fetch time     |
| error        | TEXT    | Last fetch error (null if ok)  |
| created_at   | TEXT    | Auto-set                       |

- **Unique:** `(user_id, url)` — prevents duplicate feeds per user

### `articles`
| Column       | Type    | Notes                              |
|--------------|---------|------------------------------------|
| id           | INTEGER | PK, autoincrement                  |
| feed_id      | INTEGER | FK to feeds                        |
| user_id      | INTEGER | FK to users (denormalized for speed) |
| guid         | TEXT    | Unique article identifier from RSS |
| title        | TEXT    | Article title                      |
| url          | TEXT    | Article link                       |
| author       | TEXT    | Author name                        |
| summary      | TEXT    | RSS description/snippet            |
| content      | TEXT    | Full article content (extracted on read) |
| published_at | TEXT    | Article publish date               |
| fetched_at   | TEXT    | When we fetched it                 |
| is_read      | INTEGER | 0/1                                |
| is_starred   | INTEGER | 0/1                                |

- **Unique:** `(feed_id, guid)` — prevents duplicate articles per feed

### Indexes
- `idx_articles_user_read`: (user_id, is_read, published_at)
- `idx_articles_user_starred`: (user_id, is_starred)
- `idx_articles_feed`: (feed_id, published_at)
- `idx_feeds_user`: (user_id)

---

## API Routes

All routes below `/api/` require authentication (cookie session).

### Auth (public)

| Method | Path                  | Description                    |
|--------|-----------------------|--------------------------------|
| GET    | `/login`              | Serve login page               |
| POST   | `/auth/register`      | Create account + seed default feeds (rate-limited) |
| POST   | `/auth/login`         | Login (rate-limited)           |
| POST   | `/auth/logout`        | Destroy session                |
| POST   | `/auth/change-password` | Change password (requires current) |
| GET    | `/auth/status`        | Check auth + setup state       |

### Feeds

| Method | Path                    | Description                             |
|--------|-------------------------|-----------------------------------------|
| GET    | `/api/feeds`            | List feeds with unread counts           |
| POST   | `/api/feeds`            | Add feed `{url, category?}`, auto-fetches |
| PUT    | `/api/feeds/:id`        | Update feed `{title?, category?}`       |
| DELETE | `/api/feeds/:id`        | Remove feed + all its articles          |
| POST   | `/api/feeds/:id/refresh`| Force refresh single feed               |
| POST   | `/api/feeds/refresh-all`| Refresh all feeds                       |
| POST   | `/api/feeds/import`     | Import OPML file (multipart upload)     |
| GET    | `/api/feeds/export`     | Export all feeds as OPML                |

### Articles

| Method | Path                       | Description                                    |
|--------|----------------------------|------------------------------------------------|
| GET    | `/api/articles`            | List articles (query: feed_id, category, is_read, is_starred, search, page, limit) |
| GET    | `/api/articles/:id`        | Get article + extract full content if needed   |
| PUT    | `/api/articles/:id/read`   | Mark read                                      |
| PUT    | `/api/articles/:id/unread` | Mark unread                                    |
| PUT    | `/api/articles/:id/star`   | Toggle star                                    |
| POST   | `/api/articles/mark-read`  | Bulk mark read `{feed_id?}` or `{category?}` or all |

### Stats

| Method | Path          | Description                                    |
|--------|---------------|------------------------------------------------|
| GET    | `/api/stats`  | Total feeds, unread count, starred, total articles |

---

## Default Seed Feeds

On new user registration, these feeds are automatically added:

| Category   | Feed                                        |
|------------|---------------------------------------------|
| Trading    | Seeking Alpha Market Currents               |
| Trading    | CNBC Top News                               |
| Trading    | Bloomberg Markets                           |
| Trading    | CNBC Investing                              |
| Tech       | Hacker News (via hnrss.org)                 |
| Tech       | TechCrunch                                  |
| Tech       | The Verge                                   |
| Podcasts   | All-In Podcast                              |
| Podcasts   | Lex Fridman Podcast                         |

Articles are fetched in the background immediately after registration.

---

## Full-Text Article Extraction

When a user opens an article (`GET /api/articles/:id`):
1. If `content` is empty or < 200 chars, extracts full text from the article URL
2. Uses `@extractus/article-extractor` (ESM module, loaded via dynamic import)
3. Extracted content is **cached in the DB** — only fetches once per article
4. Falls back to RSS summary if extraction fails
5. User-Agent set to Chrome to avoid blocks

---

## Background Schedulers

| Schedule         | Action                                          |
|------------------|-------------------------------------------------|
| Every 15 minutes | Fetch all feeds, insert new articles (dedup by guid) |
| Daily at 3 AM    | Delete read, non-starred articles older than 30 days |

Managed by `node-cron` in `feed-fetcher.js`, started on server boot.

---

## Frontend Architecture

### Layout (3-panel)
1. **Sidebar (left, 280px)** — Feed list grouped by category with unread count badges, "All Articles" + "Starred" nav items, add feed button, theme toggle, settings, logout
2. **Article List (center)** — Toolbar (search, unread filter, mark all read, refresh) + scrollable article items with star toggle
3. **Reading Pane (right, 50%)** — Opens on article click, shows extracted full content, star/read toggles, "Open original" link

### Keyboard Shortcuts
| Key   | Action                |
|-------|-----------------------|
| `j`   | Next article          |
| `k`   | Previous article      |
| `s`   | Star / unstar         |
| `r`   | Toggle read / unread  |
| `o`   | Open original link    |
| `Esc` | Close reading pane    |

### CDN Dependencies
| Library   | Version | Purpose                            |
|-----------|---------|------------------------------------|
| Bootstrap | 5.3.3   | Layout, modals, dark/light theme   |

### Theme
- **Dark theme** (default) — navy palette (`--bg-primary: #0f1729`, `--accent: #f59e0b`)
- **Light theme** — clean white (`--bg-primary: #f0f2f5`, `--accent: #d97706`)
- Toggle via 🌓 button, persists to `localStorage` key `rss-theme`
- Sidebar collapses to hamburger menu on mobile (≤768px)

### Client-Side State
- `feeds[]` — loaded via `GET /api/feeds`
- `articles[]` — loaded via `GET /api/articles` with current filter params
- `currentFilter` — `{ type: 'all'|'feed'|'starred'|'category', id? }`
- `currentArticle` — currently selected article (full object)
- `showUnreadOnly` — unread filter toggle
- Pagination via `currentPage` + "Load more" button

---

## Environment Variables

| Variable         | Required    | Default              | Description                |
|------------------|-------------|----------------------|----------------------------|
| `PORT`           | No          | `3001`               | Server listen port         |
| `NODE_ENV`       | No          | —                    | `production` for secure cookies |
| `SESSION_SECRET` | Yes (prod)  | Random 32-byte hex   | Express session secret     |
| `DB_PATH`        | No          | `./rss_reader.db`    | Path to SQLite file        |

---

## Docker Deployment

```yaml
services:
  rss-reader:
    build: .
    container_name: rss-reader
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - rss-data:/app/data
    environment:
      - NODE_ENV=local
      - SESSION_SECRET=<random-string>
      - DB_PATH=/app/data/rss_reader.db
```

Port 3001 avoids conflict with trading-journal on 5000.

---

## Known Limitations / Improvement Ideas

- [ ] **Reddit RSS blocked** — Reddit returns 403 for all server-side RSS requests. Would need a proxy or different data source.
- [ ] **Podcast feeds are text-only** — no audio player, just episode listings.
- [ ] **Session store is in-memory** — sessions lost on restart.
- [ ] **No favicon fetching** — `favicon` field exists but not populated.
- [ ] **No CSRF protection** — consider adding for production use.
- [ ] **No test suite** — add unit tests for OPML parser and integration tests for API.
- [ ] **Article extraction can be slow** — first read of an article may take 2-3 seconds. Could pre-extract on fetch.
- [ ] **No notification system** — could add desktop/push notifications for new articles.
- [ ] **No read-time estimate** — could calculate from content length.
- [ ] **Single instance only** — SQLite doesn't support horizontal scaling.
