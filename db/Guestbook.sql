-- The newest signatures first.
-- name: recent :many(50)
SELECT name, message, signed_at FROM signature ORDER BY id DESC;

-- name: sign :exec
-- @param name : Str
-- @param message : Str
INSERT INTO signature (name, message) VALUES (:name, :message);
