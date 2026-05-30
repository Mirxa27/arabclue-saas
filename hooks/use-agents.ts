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
  type AgentStoreState,
  type AgentAction,
  resolveAgentPersona,
} from "@/lib/agents/store";

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const agents = data.agents as AgentEntry[];

      // Convert API response to store state
      const storeState: AgentStoreState = { agents: {} as AgentStoreState["agents"] };
      for (const entry of agents) {
        storeState.agents[entry.role] = {
          role: entry.role,
          enabled: entry.enabled,
          status: (entry.status as AgentStoreState["agents"][PersonaRole]["status"]) ?? "idle",
          lastError: entry.lastError ?? undefined,
          overrides: entry.overrides
            ? {
                display_name: entry.persona.name,
                avatar: entry.persona.avatar,
                tone: entry.persona.tone as never,
                language: undefined,
                knowledge: undefined,
                ...(entry.overrides as Record<string, string>),
              }
            : undefined,
          createdAt: undefined,
          updatedAt: entry.updatedAt,
        };
      }
      dispatch({ type: "HYDRATE", state: storeState });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Fall back to defaults (already in state)
    } finally {
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
        const errData = await res.json().catch(() => ({ detail: "unknown" }));
        throw new Error(errData.detail ?? `HTTP ${res.status}`);
      }
    },
    [],
  );

  const toggleAgent = useCallback(
    async (role: PersonaRole) => {
      const current = state.agents[role];
      const nextEnabled = !current.enabled;
      dispatch({ type: "TOGGLE", role });
      try {
        await patchAgent({ role, enabled: nextEnabled, status: nextEnabled ? "active" : "idle" });
      } catch (e) {
        // Revert on failure
        dispatch({ type: "SET_ERROR", role, error: e instanceof Error ? e.message : String(e) });
        dispatch({ type: nextEnabled ? "DISABLE" : "ENABLE", role });
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
        dispatch({ type: "SET_ERROR", role, error: e instanceof Error ? e.message : String(e) });
        dispatch({ type: "DISABLE", role });
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
        dispatch({ type: "SET_ERROR", role, error: e instanceof Error ? e.message : String(e) });
        dispatch({ type: "ENABLE", role });
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