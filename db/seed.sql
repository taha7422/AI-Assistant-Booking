INSERT INTO services (name, duration_minutes) VALUES
  ('Consultation', 30), ('Follow-up', 20), ('Extended session', 60)
ON CONFLICT (name) DO NOTHING;
