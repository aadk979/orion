-- ─── OAuth PKCE support ──────────────────────────────────────────────────────
-- Stores the per-request PKCE code_verifier alongside the pending OAuth
-- request so the callback can complete the S256 proof-key exchange.

ALTER TABLE oauth_requests
    ADD COLUMN IF NOT EXISTS code_verifier TEXT;
