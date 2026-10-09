-- The tutor's database. STRICT, as roux-db requires: a column holds the
-- type it declares.
CREATE TABLE signature (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 280),
  signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now'))
) STRICT;

-- One row, the likes on Lesson 8's page.
CREATE TABLE likes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  count INTEGER NOT NULL
) STRICT;
