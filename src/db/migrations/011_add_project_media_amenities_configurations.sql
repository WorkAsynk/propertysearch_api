ALTER TABLE projects
  ADD COLUMN amenities JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN configurations JSONB NOT NULL DEFAULT '[]';

-- Images/videos attached to a builder project - mirrors property_media.
CREATE TABLE project_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    media_type      media_type NOT NULL DEFAULT 'image',
    url             VARCHAR(500) NOT NULL,
    display_order   SMALLINT NOT NULL DEFAULT 0,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_media_project_id ON project_media(project_id);
