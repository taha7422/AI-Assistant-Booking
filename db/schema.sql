CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (business_id, name),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  service_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  created_via TEXT NOT NULL DEFAULT 'form' CHECK (created_via IN ('chat','form')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (business_id, user_id) REFERENCES users(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id)
);

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    business_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'booked');

CREATE INDEX IF NOT EXISTS appointments_user_start_idx ON appointments(business_id, user_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(business_id, starts_at) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS services_active_idx ON services(business_id, name) WHERE active = true;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat' CHECK (char_length(title) BETWEEN 1 AND 120),
  pending_booking JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, user_id) REFERENCES users(business_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  session_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, session_id) REFERENCES chat_sessions(business_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  session_id UUID NOT NULL,
  request_json JSONB NOT NULL,
  response_json JSONB,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, session_id) REFERENCES chat_sessions(business_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx ON chat_sessions(business_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx ON chat_messages(business_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS ai_logs_session_created_idx ON ai_logs(business_id, session_id, created_at DESC);
