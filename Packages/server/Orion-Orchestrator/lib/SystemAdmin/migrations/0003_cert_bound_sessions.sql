-- Certificate-bound admin sessions — RFC 8705 §3.
--
-- The admin bearer token is the most valuable credential in the system: it
-- grants system-admin control of the whole cluster, and orionctl persists it to
-- a config file on an operator's workstation. A file is exactly the sort of
-- thing that gets copied into a backup, synced to a laptop, or read by anything
-- else running as that user — and until now, whoever held it could use it from
-- anywhere.
--
-- Binding the session to the client certificate that established the mTLS
-- connection makes the token useless on its own: presenting it requires the
-- private key the certificate attests to, which never leaves the client. This
-- is the same shape as the DPoP binding on the user-facing plane, using the
-- mechanism appropriate to a mutually-authenticated TLS channel.
--
-- NULL means an unbound session, which is what every session created before
-- mTLS was enabled looks like. The service refuses those once binding is
-- required, so they cannot be used to sidestep the control.
ALTER TABLE orch_admin_sessions
    ADD COLUMN IF NOT EXISTS cert_thumbprint TEXT;

COMMENT ON COLUMN orch_admin_sessions.cert_thumbprint IS
    'RFC 8705 x5t#S256 — base64url SHA-256 of the DER client certificate this session is bound to. NULL = unbound (pre-mTLS session).';
