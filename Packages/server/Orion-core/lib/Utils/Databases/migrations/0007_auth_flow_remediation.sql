-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Authentication flow remediation
--
--   1. consumed_refresh_tokens.consumed_at — the instant a refresh token was
--      retired. Reuse detection previously treated ANY replay of a retired
--      token as theft and tore down the whole session family. That is the right
--      call for a genuine replay and the wrong one for the two benign cases
--      that produce the identical signal: a client retrying a rotation whose
--      response it never received, and two in-flight requests racing the same
--      rotation. A timestamp lets the two be told apart by age.
--
--   2. users second-factor backoff — a per-ACCOUNT ceiling on second-factor
--      guessing, mirroring the existing failed_login_* columns. The device
--      authorization and step-up TOTP paths had no ceiling at all: the shared
--      chargeFailedAttempt() ceiling lives on the challenge-record tables, and
--      a TOTP submission creates no challenge record, so a caller could guess a
--      6-digit code without limit — and could reset any per-flow counter simply
--      by restarting the flow. This counter survives flow restarts.
--
--      Deliberately NOT a lockout: the emailed one-time code stays available
--      when TOTP is throttled, so the account owner always retains a path in.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Rotation age for reuse detection ────────────────────────────────────

ALTER TABLE consumed_refresh_tokens
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN consumed_refresh_tokens.consumed_at IS
    'When this token was retired. A replay within the rotation grace window is treated as a benign retry; beyond it, as reuse.';

-- ─── 2. Per-account second-factor backoff ───────────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS second_factor_failed_count  INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS second_factor_window_start  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS second_factor_locked_until  TIMESTAMPTZ;

COMMENT ON COLUMN users.second_factor_locked_until IS
    'Second-factor (TOTP) submissions are refused until this instant. The emailed one-time code remains available throughout, so this can never lock an owner out.';
