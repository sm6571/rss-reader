# RSS Reader

A self-hosted RSS/Atom feed reader built with Node.js, Express, and SQLite.

## Quick Start

```bash
cd rss-reader
npm install
npm start
```

Open **http://localhost:3001** in your browser.

## Docker

```bash
docker compose up -d --build
```

## Features

- **Feed Management** — Add RSS/Atom feeds organized by category
- **Clean Reading** — Ad-free reading experience with inline article view
- **Read/Unread Tracking** — Mark articles read, bulk "mark all read"
- **Starred Articles** — Save articles to read later
- **Search** — Full-text search across all articles
- **Keyboard Shortcuts** — `j/k` navigate, `s` star, `r` toggle read, `o` open original
- **OPML Import/Export** — Standard format to import/export your feeds
- **Background Fetching** — New articles fetched every 15 minutes
- **Auto Cleanup** — Old read articles removed after 30 days
- **Dark/Light Theme** — Toggle with 🌓 button
- **Multi-user** — Up to 2 accounts with bcrypt auth

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` | Next article |
| `k` | Previous article |
| `s` | Star / unstar |
| `r` | Toggle read / unread |
| `o` | Open original link |
| `Esc` | Close reading pane |

## OPML Import

Export your feeds from any RSS reader (Feedly, Inoreader, etc.) as OPML, then import via Settings → Import OPML.

## Data

All data stored locally in `rss_reader.db` (SQLite). No cloud, no tracking.
