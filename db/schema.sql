CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist
  (tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'confirmed');
CREATE INDEX IF NOT EXISTS appointments_user_start_idx ON appointments(user_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(starts_at) WHERE status = 'confirmed';
