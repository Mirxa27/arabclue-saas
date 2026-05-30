/**
 * arabclue — Agent Store
 *
 * Centralised state machine for agent toggles, persona selection,
 * and merchant-level configuration. Persisted via Supabase `ai_employees.config`.
 *
 * Data flow:
 *   config (DB) → store → UI toggle / agent pipeline → config (DB)
 */

import type { AgentPersona, PersonaRole } from "./personas";
import { getPersona, applyMerchantOverrides } from "./personas";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentStatus = "idle" | "active" | "paused" | "error" | "configuring";

export interface AgentConfig {
  /** The persona role key */
  role: PersonaRole;
  /** Whether the agent is enabled for this merchant */
  enabled: boolean;
  /** Runtime status */
  status: AgentStatus;
  /** Last-known error (non-empty = error state) */
  lastError?: string;
  /** Merchant overrides for the persona */
  overrides?: {
    display_name?: string;
    avatar?: string;
    tone?: string;
    knowledge?: string;
    language?: string;
  };
  /** When the agent was first enabled */
  createdAt?: string;
  /** When the agent config was last updated */
  updatedAt?: string;
}

export interface AgentStoreState {
  agents: Record<PersonaRole, AgentConfig>;
}

export type AgentAction =
  | { type: "TOGGLE"; role: PersonaRole }
  | { type: "ENABLE"; role: PersonaRole }
  | { type: "DISABLE"; role: PersonaRole }
  | { type: "PAUSE"; role: PersonaRole }
  | { type: "RESUME"; role: PersonaRole }
  | { type: "SET_ERROR"; role: PersonaRole; error: string }
  | { type: "CLEAR_ERROR"; role: PersonaRole }
  | { type: "UPDATE_OVERRIDES"; role: PersonaRole; overrides: AgentConfig["overrides"] }
  | { type: "HYDRATE"; state: AgentStoreState };

// ─────────────────────────────────────────────────────────────────────────────
// Default state — all agents off until configured
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultAgentState(): AgentStoreState {
  const roles: PersonaRole[] = ["social", "voice", "seo", "sales", "support", "analyst"];
  const agents = {} as Record<PersonaRole, AgentConfig>;

  for (const role of roles) {
    agents[role] = {
      role,
      enabled: false,
      status: "idle",
    };
  }

  return { agents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducer (immutable updates — suitable for useReducer / Zustand / etc.)
// ─────────────────────────────────────────────────────────────────────────────

export function agentReducer(state: AgentStoreState, action: AgentAction): AgentStoreState {
  switch (action.type) {
    case "HYDRATE":
      return { ...action.state };

    case "ENABLE":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            enabled: true,
            status: "active",
            lastError: undefined,
          },
        },
      };

    case "DISABLE":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            enabled: false,
            status: "idle",
            lastError: undefined,
          },
        },
      };

    case "TOGGLE":
      return state.agents[action.role].enabled
        ? agentReducer(state, { type: "DISABLE", role: action.role })
        : agentReducer(state, { type: "ENABLE", role: action.role });

    case "PAUSE":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            status: "paused",
          },
        },
      };

    case "RESUME":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            status: "active",
            lastError: undefined,
          },
        },
      };

    case "SET_ERROR":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            status: "error",
            lastError: action.error,
          },
        },
      };

    case "CLEAR_ERROR":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            status: state.agents[action.role].enabled ? "active" : "idle",
            lastError: undefined,
          },
        },
      };

    case "UPDATE_OVERRIDES":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            overrides: action.overrides,
          },
        },
      };

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve effective persona for a given role/merchant
// ─────────────────────────────────────────────────────────────────────────────

export function resolveAgentPersona(role: PersonaRole, config?: AgentConfig): AgentPersona {
  const base = getPersona(role);
  if (config?.overrides) {
    return applyMerchantOverrides(base, config.overrides);
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema for ai_employees.config JSONB column (used by server routes)
// ─────────────────────────────────────────────────────────────────────────────

export interface AiEmployeeConfig {
  /** Enabled agents keyed by role */
  agents: Record<PersonaRole, {
    enabled: boolean;
    status: AgentStatus;
    last_error?: string;
    overrides?: AgentConfig["overrides"];
    created_at?: string;
    updated_at?: string;
  }>;
}
