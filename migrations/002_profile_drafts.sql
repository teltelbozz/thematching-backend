CREATE TABLE IF NOT EXISTS public.profile_drafts (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  nickname text,
  age integer,
  gender text,
  occupation text,
  education text,
  university text,
  hometown text,
  residence text,
  personality text,
  income integer,
  atmosphere text,

  draft_photo_url text,
  draft_photo_pathname text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_drafts_updated_at ON public.profile_drafts(updated_at);