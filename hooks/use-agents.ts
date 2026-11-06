/**
 * arabclue — useAgents hook
 *
 * Fetches agent statuses from /api/agents/status and provides toggle/configure
 * mutations. Falls back to local state when offline.
 */
"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { PersonaRole } from "@/lib/agents/personas";
import {
  createDefaultAgentState,
  agentReducer,
  agentToggleErrorMessage,
  agentToggleFailed,
  hydrateAgentState,
  type AgentStoreState,
  resolveAgentPersona,
} from "@/lib/agents/store";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AgentEntry {
  role: PersonaRole;
  enabled: boolean;
  status: string;
  persona: {
    name: string;
    age: number;
    role: string;
    avatar: string;
    tone: string;
    expertise: string[];
    traits: string[];
    backstory: string;
  };
  overrides: Record<string, unknown> | null;
  lastError: string | null;
  updatedAt?: string;
}

interface UseAgentsReturn {
  state: AgentStoreState;
  agents: AgentEntry[];
  loading: boolean;
  error: string | null;
  toggleAgent: (role: PersonaRole) => Promise<void>;
  enableAgent: (role: PersonaRole) => Promise<void>;
  disableAgent: (role: PersonaRole) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAgents(): UseAgentsReturn {
  const [state, dispatch] = useReducer(agentReducer, createDefaultAgentState());
  const [loading, setLoading] = useReducer((_: boolean, v: boolean) => v, true);
  const [error, setError] = useReducer(
    (_: string | null, v: string | null) => v,
    null,
  );

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/agents/status");
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { agents?: AgentEntry[] };

      // Merge API rows over the defaults: agents without a stored row stay visible
      // (switched off) so the merchant can turn them on.
      dispatch({ type: "HYDRATE", state: hydrateAgentState(data.agents ?? []) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Fall back to defaults (already in state)
    }
  }, []);

  useEffect(() => {
    fetchAgents().finally(() => setLoading(false));
  }, [fetchAgents]);

  const patchAgent = useCallback(
    async (body: Record<string, unknown>) => {
      setError(null);
      const res = await fetch("/api/agents/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        // 402 = plan gate: fixed bilingual copy (the API message is English only)
        throw new Error(agentToggleErrorMessage(res.status, errData));
      }
    },
    [],
  );

  // On failure, revert AND keep the reason in one action: a separate SET_ERROR followed by
  // DISABLE/ENABLE lost the error (both clear lastError), so refused toggles looked like no-ops.
  const toggleAgent = useCallback(
    async (role: PersonaRole) => {
      const current = state.agents[role];
      const nextEnabled = !current.enabled;
      dispatch({ type: "TOGGLE", role });
      try {
        await patchAgent({ role, enabled: nextEnabled, status: nextEnabled ? "active" : "idle" });
      } catch (e) {
        dispatch(agentToggleFailed(role, nextEnabled, errorText(e)));
      }
    },
    [state.agents, patchAgent],
  );

  const enableAgent = useCallback(
    async (role: PersonaRole) => {
      dispatch({ type: "ENABLE", role });
      try {
        await patchAgent({ role, enabled: true, status: "active" });
      } catch (e) {
        dispatch(agentToggleFailed(role, true, errorText(e)));
      }
    },
    [patchAgent],
  );

  const disableAgent = useCallback(
    async (role: PersonaRole) => {
      dispatch({ type: "DISABLE", role });
      try {
        await patchAgent({ role, enabled: false, status: "idle" });
      } catch (e) {
        dispatch(agentToggleFailed(role, false, errorText(e)));
      }
    },
    [patchAgent],
  );

  // Build enriched agent entries from state + persona definitions
  const agents: AgentEntry[] = Object.entries(state.agents).map(
    ([role, config]) => {
      const persona = resolveAgentPersona(role as PersonaRole, config);
      return {
        role: role as PersonaRole,
        enabled: config.enabled,
        status: config.status,
        persona: {
          name: config.overrides?.display_name ?? persona.nameEn,
          age: persona.age,
          role: persona.role,
          avatar: config.overrides?.avatar ?? persona.avatar,
          tone: config.overrides?.tone ?? persona.register,
          expertise: persona.expertise,
          traits: persona.traits,
          backstory: persona.culturalContext,
        },
        overrides: config.overrides ?? null,
        lastError: config.lastError ?? null,
        updatedAt: config.updatedAt,
      };
    },
  );

  return {
    state,
    agents,
    loading,
    error,
    toggleAgent,
    enableAgent,
    disableAgent,
    refresh: fetchAgents,
  };
}