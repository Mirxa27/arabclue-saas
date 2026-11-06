/**
 * arabclue — Agent Store
 *
 * Centralised state machine for agent toggles, persona selection,
 * and merchant-level configuration. Persisted in Supabase `agent_settings` (one row per
 * merchant + persona) through /api/agents/status.
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
  /** A toggle the server refused: back to `enabled` (with its status) and the reason, in one step. */
  | { type: "TOGGLE_FAILED"; role: PersonaRole; enabled: boolean; error: string }
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

/** Shape of one agent in the GET /api/agents/status response (fields the store needs). */
export interface AgentStatusApiEntry {
  role: string;
  enabled: boolean;
  status?: string | null;
  lastError?: string | null;
  overrides?: Record<string, unknown> | null;
  updatedAt?: string | null;
}

const KNOWN_STATUSES: readonly AgentStatus[] = ["idle", "active", "paused", "error", "configuring"];

function stringOverrides(value: Record<string, unknown>): AgentConfig["overrides"] {
  const out: Record<string, string> = {};
  for (const key of ["display_name", "avatar", "tone", "knowledge", "language"] as const) {
    const v = value[key];
    if (typeof v === "string" && v.length > 0) out[key] = v;
  }
  return out;
}

/**
 * Merge API rows over the default state. A merchant who never toggled an agent has no
 * rows, and must still see every agent (switched off) so the first toggle is possible.
 * Unknown roles are ignored.
 */
export function hydrateAgentState(entries: readonly AgentStatusApiEntry[]): AgentStoreState {
  const state = createDefaultAgentState();
  for (const entry of entries) {
    const role = entry.role as PersonaRole;
    if (!(role in state.agents)) continue;
    state.agents[role] = {
      role,
      enabled: Boolean(entry.enabled),
      status: KNOWN_STATUSES.includes(entry.status as AgentStatus) ? (entry.status as AgentStatus) : "idle",
      lastError: entry.lastError ?? undefined,
      overrides: entry.overrides ? stringOverrides(entry.overrides) : undefined,
      updatedAt: entry.updatedAt ?? undefined
    };
  }
  return state;
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

    case "TOGGLE_FAILED":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.role]: {
            ...state.agents[action.role],
            enabled: action.enabled,
            status: action.enabled ? "active" : "idle",
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
// Failed toggles (PATCH /api/agents/status)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shown when switching an agent on is refused by the plan gate (402). The API's message is
 * English only, so the card gets fixed bilingual copy instead.
 */
export const AGENT_PLAN_REQUIRED_MESSAGE =
  "باقتك الحالية لا تشمل هذا الوكيل أو أن اشتراكك غير مفعّل — اختر باقة من صفحة الفوترة · " +
  "Your plan does not include this agent or your subscription is not active — choose a plan on the Billing page.";

/** The message to show for a failed PATCH /api/agents/status response. */
export function agentToggleErrorMessage(status: number, body: unknown): string {
  if (status === 402) return AGENT_PLAN_REQUIRED_MESSAGE;
  const b = body && typeof body === "object" ? (body as { error?: unknown; detail?: unknown }) : null;
  if (typeof b?.error === "string" && b.error.trim()) return b.error;
  if (typeof b?.detail === "string" && b.detail.trim()) return b.detail;
  return `HTTP ${status}`;
}

/**
 * The single action for a refused toggle: revert to the state before the attempt and keep the
 * reason visible. (Dispatching SET_ERROR and then ENABLE/DISABLE lost the error — both reducers
 * clear lastError — so a 402 plan gate flipped the card back without a word.)
 */
export function agentToggleFailed(role: PersonaRole, attemptedEnabled: boolean, error: string): AgentAction {
  return { type: "TOGGLE_FAILED", role, enabled: !attemptedEnabled, error };
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
