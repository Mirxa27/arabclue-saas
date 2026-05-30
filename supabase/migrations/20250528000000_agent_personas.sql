-- Migration: Agent Personas & Employee Configuration
-- Description: Adds persona support and ai_employees config to supabase
-- Created: 2025-05-28

--------------------------------------------------------------------
-- 1. ai_employees table — employee/agent configuration
--------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  persona_role  text NOT NULL CHECK (persona_role IN ('social', 'voice', 'seo', 'sales', 'support', 'analyst')),
  enabled       boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'paused', 'error', 'configuring')),
  last_error    text,
  display_name  text,
  avatar        text,
  tone          text CHECK (tone IS NULL OR tone IN ('professional', 'friendly', 'formal', 'playful')),
  knowledge     text,
  language      text CHECK (language IS NULL OR language IN ('khaliji', 'msa', 'english')),
  config        jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One config per merchant per role
  UNIQUE (merchant_id, persona_role)
);

-- Index for fast lookup by merchant
CREATE INDEX IF NOT EXISTS idx_ai_employees_merchant ON public.ai_employees(merchant_id);
-- Index for listing enabled agents
CREATE INDEX IF NOT EXISTS idx_ai_employees_enabled ON public.ai_employees(merchant_id, enabled) WHERE enabled = true;

-- Enable RLS
ALTER TABLE public.ai_employees ENABLE ROW LEVEL SECURITY;

-- Merchants can only access their own ai_employees
CREATE POLICY "merchant_ai_employees_access" ON public.ai_employees
  FOR ALL
  USING (auth.uid() = merchant_id)
  WITH CHECK (auth.uid() = merchant_id);

--------------------------------------------------------------------
-- 2. oauth_connections table — track platform OAuth connections
--------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('salla', 'linkedin', 'meta', 'tiktok', 'x')),
  access_token    text NOT NULL,
  refresh_token   text,
  token_expires_at timestamptz,
  scopes          text[],
  platform_user_id text,
  platform_handle  text,
  is_active       boolean NOT NULL DEFAULT true,
  last_synced_at  timestamptz,
  error_message   text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One active connection per merchant per platform
  UNIQUE (merchant_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_merchant ON public.oauth_connections(merchant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_connections_platform ON public.oauth_connections(platform, is_active) WHERE is_active = true;

ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merchant_oauth_connections_access" ON public.oauth_connections
  FOR ALL
  USING (auth.uid() = merchant_id)
  WITH CHECK (auth.uid() = merchant_id);

--------------------------------------------------------------------
-- 3. agent_activity_log — audit trail for agent actions
--------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  persona_role  text NOT NULL,
  action        text NOT NULL, -- e.g., 'post_created', 'call_answered', 'seo_audit', 'reply_sent'
  summary       text,
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_log_merchant ON public.agent_activity_log(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_role ON public.agent_activity_log(persona_role, created_at DESC);

ALTER TABLE public.agent_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merchant_agent_activity_access" ON public.agent_activity_log
  FOR ALL
  USING (auth.uid() = merchant_id)
  WITH CHECK (auth.uid() = merchant_id);

--------------------------------------------------------------------
-- 4. Updated trigger for updated_at
--------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to ai_employees if trigger doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_ai_employees'
  ) THEN
    CREATE TRIGGER set_updated_at_ai_employees
      BEFORE UPDATE ON public.ai_employees
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Apply to oauth_connections if trigger doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_oauth_connections'
  ) THEN
    CREATE TRIGGER set_updated_at_oauth_connections
      BEFORE UPDATE ON public.oauth_connections
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

--------------------------------------------------------------------
-- 5. Seed default personas for demo merchants (idempotent)
--------------------------------------------------------------------

-- This is a utility function that the API will call. The migration just creates
-- the schema; seeding happens at runtime via the agent config API.