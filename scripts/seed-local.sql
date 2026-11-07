-- Local UI fixtures. Stable IDs preserve edits when seeded again.
INSERT INTO folders (id, name, sort_order) VALUES
  ('demo-cloud', 'Cloud（サンプル）', 0),
  ('demo-security', 'Security（サンプル）', 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO folders (id, name, parent_id, sort_order) VALUES
  ('demo-workers', 'Workers', 'demo-cloud', 0)
ON CONFLICT(id) DO NOTHING;

-- Paused sources allow UI checks without a running collector or external fetches.
INSERT INTO sources (id, normalized_url, folder_id, title, site_url, status) VALUES
  ('demo-cloudflare', 'https://tayori.invalid/tayori-demo/cloudflare.xml', 'demo-workers', 'Cloudflare（サンプル）', 'https://tayori.invalid/', 'paused'),
  ('demo-cncf', 'https://tayori.invalid/tayori-demo/cncf.xml', 'demo-cloud', 'CNCF（サンプル）', 'https://tayori.invalid/', 'paused'),
  ('demo-security-feed', 'https://tayori.invalid/tayori-demo/security.xml', 'demo-security', 'Security（サンプル）', 'https://tayori.invalid/', 'paused'),
  ('demo-unclassified', 'https://tayori.invalid/tayori-demo/updates.xml', NULL, '更新情報（サンプル）', 'https://tayori.invalid/', 'paused')
ON CONFLICT(id) DO UPDATE SET
  normalized_url = CASE
    WHEN sources.normalized_url = replace(excluded.normalized_url, 'tayori.invalid', 'example.com')
    THEN excluded.normalized_url ELSE sources.normalized_url END,
  site_url = CASE WHEN sources.site_url = 'https://example.com/'
    THEN excluded.site_url ELSE sources.site_url END;

INSERT INTO item_keys (id, source_id, key_hash, first_seen_at) VALUES
  ('demo-article-1', 'demo-cloudflare', 'demo-key-1', unixepoch() - 600),
  ('demo-article-2', 'demo-cloudflare', 'demo-key-2', unixepoch() - 3600),
  ('demo-article-3', 'demo-cncf', 'demo-key-3', unixepoch() - 7200),
  ('demo-article-4', 'demo-security-feed', 'demo-key-4', unixepoch() - 10800),
  ('demo-article-5', 'demo-unclassified', 'demo-key-5', unixepoch() - 14400),
  ('demo-article-6', 'demo-security-feed', 'demo-key-6', unixepoch() - 18000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO articles (id, title, url, author, summary_text, published_at, read_at, starred, read_later, first_seen_at, expires_at) VALUES
  ('demo-article-1', 'Workersで始めるアプリ開発（サンプル）', 'https://tayori.invalid/tayori-demo/1', 'Tayori Demo', 'ローカルD1に保存した記事です。既読への変更や保存、フォルダ別の絞り込みを試せます。', unixepoch() - 600, NULL, 0, 0, unixepoch() - 600, unixepoch() + 604800),
  ('demo-article-2', 'A longer article title for checking line wrapping in the reader（サンプル）', 'https://tayori.invalid/tayori-demo/2', NULL, 'This is sample content for checking English text, long titles, and responsive article cards.', unixepoch() - 3600, NULL, 1, 0, unixepoch() - 3600, unixepoch() + 604800),
  ('demo-article-3', 'クラウドネイティブ技術の更新情報（サンプル）', 'https://tayori.invalid/tayori-demo/3', 'Tayori Demo', 'あとで読むに保存した記事です。サイドバーから保存状態ごとの表示を確認できます。', unixepoch() - 7200, NULL, 0, 1, unixepoch() - 7200, unixepoch() + 604800),
  ('demo-article-4', 'セキュリティニュースを読む（サンプル）', 'https://tayori.invalid/tayori-demo/4', NULL, '既読の記事です。未読一覧では非表示になり、すべての記事では表示されます。', unixepoch() - 10800, unixepoch() - 300, 0, 0, unixepoch() - 10800, unixepoch() + 604800),
  ('demo-article-5', '未分類の購読先から届いた記事（サンプル）', 'https://tayori.invalid/tayori-demo/5', NULL, NULL, unixepoch() - 14400, NULL, 0, 0, unixepoch() - 14400, unixepoch() + 604800),
  ('demo-article-6', 'お気に入りとあとで読むに保存した記事（サンプル）', 'https://tayori.invalid/tayori-demo/6', 'Tayori Demo', '両方の保存状態が有効な記事です。ボタンを押すと変更内容がローカルDBに保存されます。', unixepoch() - 18000, NULL, 1, 1, unixepoch() - 18000, unixepoch() + 604800)
ON CONFLICT(id) DO UPDATE SET
  url = CASE WHEN articles.url = replace(excluded.url, 'tayori.invalid', 'example.com')
    THEN excluded.url ELSE articles.url END,
  expires_at = unixepoch() + 604800;
