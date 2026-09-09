CREATE TABLE IF NOT EXISTS budget_state (
 id integer PRIMARY KEY CHECK (id = 1),
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO budget_state (id, document) VALUES (1, '{"categories":[],"templates":[],"paychecks":[]}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS command_receipts (
 key text PRIMARY KEY,
 fingerprint text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Keep the aggregate shape enforced even though records are stored in JSONB.
-- Conditional constraints make rerunning this migration safe on an existing DB.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'budget_state'::regclass AND conname = 'budget_document_shape') THEN
  ALTER TABLE budget_state ADD CONSTRAINT budget_document_shape CHECK (
   jsonb_typeof(document) = 'object'
   AND document ?& ARRAY['categories', 'templates', 'paychecks']
   AND jsonb_typeof(document->'categories') = 'array'
   AND jsonb_typeof(document->'templates') = 'array'
   AND jsonb_typeof(document->'paychecks') = 'array'
  );
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'command_receipts'::regclass AND conname = 'receipt_response_shape') THEN
  ALTER TABLE command_receipts ADD CONSTRAINT receipt_response_shape CHECK (jsonb_typeof(response) = 'object');
 END IF;
END $$;
