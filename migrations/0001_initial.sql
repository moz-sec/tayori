PRAGMA foreign_keys = ON;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX folders_unique_sibling_name
ON folders(COALESCE(parent_id, ''), lower(name));

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'rss' CHECK (kind = 'rss'),
  normalized_url TEXT NOT NULL UNIQUE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  title_is_custom INTEGER NOT NULL DEFAULT 0 CHECK (title_is_custom IN (0, 1)),
  site_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes >= 5),
  etag TEXT,
  last_modified TEXT,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  next_fetch_at INTEGER NOT NULL DEFAULT (unixepoch()),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at INTEGER,
  generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX sources_by_status_next_fetch ON sources(status, next_fetch_at);
CREATE INDEX sources_by_folder ON sources(folder_id);

CREATE TABLE item_keys (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  key_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  UNIQUE(source_id, key_hash)
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY REFERENCES item_keys(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  summary_text TEXT,
  published_at INTEGER,
  content_hash TEXT,
  read_at INTEGER,
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  read_later INTEGER NOT NULL DEFAULT 0 CHECK (read_later IN (0, 1)),
  first_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX articles_by_seen ON articles(first_seen_at DESC, id DESC);
CREATE INDEX articles_by_read_seen ON articles(read_at, first_seen_at DESC);
CREATE INDEX articles_by_expiry ON articles(expires_at);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE board_articles (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (board_id, article_id)
);

CREATE INDEX board_articles_by_article ON board_articles(article_id);

CREATE TABLE fetch_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'running', 'done', 'failed')),
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX fetch_jobs_by_status_lease ON fetch_jobs(status, lease_until);
CREATE INDEX fetch_jobs_by_source_generation ON fetch_jobs(source_id, generation);
CREATE UNIQUE INDEX fetch_jobs_one_active_per_source
ON fetch_jobs(source_id) WHERE status IN ('pending', 'sent', 'running');

CREATE TABLE daily_usage (
  day_utc TEXT PRIMARY KEY,
  reserved_queue_ops INTEGER NOT NULL DEFAULT 0,
  new_articles INTEGER NOT NULL DEFAULT 0,
  observed_rows_read INTEGER NOT NULL DEFAULT 0,
  observed_rows_written INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
