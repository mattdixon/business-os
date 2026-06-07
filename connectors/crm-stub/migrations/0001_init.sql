-- @business-os/connector-crm-stub / 0001_init

CREATE TABLE crm_stub_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text,
  first_name   text,
  last_name    text,
  phone        text,
  company      text,
  custom       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_stub_contacts_email_uniq ON crm_stub_contacts (email) WHERE email IS NOT NULL;

CREATE TABLE crm_stub_tags (
  contact_id uuid NOT NULL REFERENCES crm_stub_contacts(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  PRIMARY KEY (contact_id, tag)
);

CREATE TABLE crm_stub_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES crm_stub_contacts(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_stub_notes_contact_idx ON crm_stub_notes (contact_id);

CREATE TABLE crm_stub_tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES crm_stub_contacts(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text,
  due_at     timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_stub_tasks_contact_idx ON crm_stub_tasks (contact_id);
