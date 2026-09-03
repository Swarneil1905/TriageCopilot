-- TriageCopilot: adds Google sign-in and a real free-tier plus paid-subscription
-- model for the AI triage agent. See the auth-billing prompt for full reasoning.
--
-- password_hash becomes nullable: a Google-only account never has one.
-- google_id is Google's stable "sub" claim, not the email; that is the right
-- key for "is this the same Google account," since an email match alone
-- doesn't verify ownership at the point a password account was originally
-- created (see the account-linking guardrail in routes/auth.ts's Google
-- callback). Stripe fields stay nullable until a user ever starts a checkout.
--
-- Same idempotency convention as 0001_init.sql and 0002_auth_and_demo.sql:
-- safe to re-run on every deploy.

alter table users alter column password_hash drop not null;
alter table users add column if not exists google_id text unique;
alter table users add column if not exists ai_requests_used integer not null default 0;
alter table users add column if not exists stripe_customer_id text unique;
alter table users add column if not exists stripe_subscription_id text unique;
alter table users add column if not exists subscription_status text;

create index if not exists users_stripe_customer_id_idx on users (stripe_customer_id);
