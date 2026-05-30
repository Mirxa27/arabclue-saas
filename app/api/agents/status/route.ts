/**
 * arabclue — Agent Status API (GET + PATCH)
 *
 * GET  /api/agents/status   → list all agents with persona + status for the merchant
 * PATCH /api/agents/status  → toggle/enable/disable/configure an agent
 *
 * Persisted to `public.ai_employees` table. Falls back to in-memory defaults
 * when the table doesn't exist yet (graceful migration path).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { DEFAULT_PERSONAS, getPersona, type AgentPersona, type PersonaRole } from "@/lib/agents/personas";
import { createDefaultAgentState } from "@/lib/agents/store";

export const dynamic = "force-dynamic";

function shapePersona(p: AgentPersona) {
  return {
    name: p.nameEn,
    arabicName: p.name,
    age: p.age,
    role: p.role,
    avatar: p.avatar,
    tone: p.register,
    expertise: p.expertise,
    traits: p.traits,
    backstory: p.culturalContext
  };
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const supabase = getServerSupabase();
    const { data: merchant } = await supabase
      .from("merchants")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (!merchant) {
      return NextResponse.json({ error: "no merchant" }, { status: 404 });
    }

    const { data: rows, error } = await supabase
      .from("ai_employees")
      .select("*")
      .eq("merchant_id", merchant.id);

    if (error) {
      const defaults = createDefaultAgentState();
      const enriched = Object.entries(defaults.agents).map(([role, config]) => {
        const persona = getPersona(role as PersonaRole);
        return {
          role,
          enabled: config.enabled,
          status: config.status,
          persona: shapePersona(persona),
          overrides: null,
          lastError: null
        };
      });
      return NextResponse.json({ agents: enriched });
    }

    const enriched = (rows ?? []).map((row: Record<string, unknown>) => {
      const role = (row.persona_role as PersonaRole) ?? (row.role_id as PersonaRole);
      const persona = getPersona(role);
      const shaped = shapePersona(persona);
      return {
        role,
        enabled: row.enabled ?? row.status === "active",
        status: row.status,
        persona: {
          ...shaped,
          name: (row.display_name as string | null) ?? shaped.name,
          avatar: (row.avatar as string | null) ?? shaped.avatar,
          tone: (row.tone as string | null) ?? shaped.tone
        },
        overrides: row.config ?? {},
        lastError: (row.last_error as string | null) ?? null,
        updatedAt: row.updated_at ?? null
      };
    });

    return NextResponse.json({ agents: enriched });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/agents/status" });
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
const PatchBodySchema = z.object({
  role: z.enum(["social", "voice", "seo", "sales", "support", "analyst"]),
  enabled: z.boolean().optional(),
  status: z.enum(["idle", "active", "paused", "error", "configuring"]).optional(),
  overrides: z
    .object({
      display_name: z.string().min(1).max(64).optional(),
      avatar: z.string().min(1).max(64).optional(),
      tone: z.enum(["professional", "friendly", "formal", "playful"]).optional(),
      knowledge: z.string().max(2000).optional(),
      language: z.enum(["khaliji", "msa", "english"]).optional()
    })
    .optional()
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const supabase = getServerSupabase();
    const { data: merchant } = await supabase
      .from("merchants")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (!merchant) {
      return NextResponse.json({ error: "no merchant" }, { status: 404 });
    }

    const body = PatchBodySchema.parse(await req.json());
    const { role, enabled, status, overrides } = body;

    const patch: Record<string, unknown> = {
      merchant_id: merchant.id,
      persona_role: role,
      enabled: enabled ?? true,
      status: status ?? (enabled === false ? "paused" : "active"),
      updated_at: new Date().toISOString()
    };
    if (overrides?.display_name) patch.display_name = overrides.display_name;
    if (overrides?.avatar) patch.avatar = overrides.avatar;
    if (overrides?.tone) patch.tone = overrides.tone;
    if (overrides?.knowledge) patch.knowledge = overrides.knowledge;
    if (overrides?.language) patch.language = overrides.language;

    const { data, error } = await supabase
      .from("ai_employees")
      .upsert(patch, { onConflict: "merchant_id,persona_role" })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "db write failed", detail: error.message }, { status: 500 });
    }

    const persona = getPersona(role as PersonaRole);
    const shaped = shapePersona(persona);
    return NextResponse.json({
      ok: true,
      agent: {
        role,
        enabled: data.enabled,
        status: data.status,
        persona: {
          ...shaped,
          name: (data.display_name as string | null) ?? shaped.name,
          avatar: (data.avatar as string | null) ?? shaped.avatar,
          tone: (data.tone as string | null) ?? shaped.tone
        },
        overrides: data.config ?? {},
        lastError: (data.last_error as string | null) ?? null,
        updatedAt: data.updated_at ?? null
      }
    });
  } catch (err) {
    return handleRouteError(err, { route: "PATCH /api/agents/status" });
  }
}
