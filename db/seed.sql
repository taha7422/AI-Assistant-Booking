INSERT INTO businesses (name, slug, timezone)
VALUES ('AI Assistant Booking', 'default', 'Europe/London')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO services (business_id, name, duration_minutes)
SELECT b.id, sample.name, 30
FROM businesses AS b
CROSS JOIN (VALUES ('Consultation'), ('Check-up'), ('Follow-up')) AS sample(name)
WHERE b.slug = 'default'
ON CONFLICT (business_id, name) DO NOTHING;
