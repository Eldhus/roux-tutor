-- name: count :one
-- @column count : I64
SELECT coalesce((SELECT count FROM likes WHERE id = 1), 0) AS count;

-- One more, the new count back.
-- name: like :one
INSERT INTO likes (id, count) VALUES (1, 1)
ON CONFLICT (id) DO UPDATE SET count = count + 1
RETURNING count;
