/**
 * The employee `config` the API accepts (SW-20): the persona fields the workspace and the
 * system prompt use — nothing else — each bounded, plus a total size cap. A `persona_id`
 * of a catalog persona for the role is filled from lib/employees/personas.ts on the server
 * (client-sent persona text for a catalog persona is ignored). The database backstop is
 * the ai_employees_config_size constraint (16 KiB); the runtime clamps every field again
 * when it builds a prompt.
 */
import { z } from "zod";
import { personasForRole } from "./personas";

export const EMPLOYEE_CONFIG_MAX_BYTES = 4096;

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n\0]/.test(v), "must be a single line");

export const EmployeeConfigSchema = z
  .object({
    persona_id: z.string().trim().regex(/^[a-z0-9-]{1,64}$/, "unknown persona").optional(),
    persona_name: line(64).optional(),
    persona_arabic_name: line(64).optional(),
    persona_age: z.number().int().min(16).max(99).optional(),
    persona_gender: z.enum(["female", "male", "neutral"]).optional(),
    persona_nationality: line(64).optional(),
    persona_city: line(64).optional(),
    persona_dialect: line(32).optional(),
    persona_voice: line(32).optional(),
    persona_background: z.string().trim().max(500).optional(),
    persona_signature: line(80).optional()
  })
  .strict()
  .refine((cfg) => Buffer.byteLength(JSON.stringify(cfg), "utf8") <= EMPLOYEE_CONFIG_MAX_BYTES, {
    message: `config is too large (at most ${EMPLOYEE_CONFIG_MAX_BYTES} bytes)`
  });

export type EmployeeConfig = z.infer<typeof EmployeeConfigSchema>;

/**
 * The config to store for `roleId`: a catalog persona (by `persona_id`) is expanded from the
 * catalog; custom persona fields are kept as validated. An unknown persona_id is dropped.
 */
export function resolveEmployeeConfig(roleId: string, cfg: EmployeeConfig | undefined): EmployeeConfig {
  if (!cfg) return {};
  const { persona_id: personaId, ...custom } = cfg;
  if (!personaId) return custom;
  // Only this role's catalog personas (lib/employees/personas.ts) are expanded.
  const known = personasForRole(roleId).find((p) => p.id === personaId);
  if (!known) return custom;
  return {
    persona_id: known.id,
    persona_name: known.name,
    persona_arabic_name: known.arabicName,
    persona_age: known.age,
    persona_gender: known.gender,
    persona_nationality: known.nationality,
    persona_city: known.city,
    persona_dialect: known.dialect,
    persona_voice: known.voice,
    persona_background: known.background.slice(0, 500),
    persona_signature: known.signature.slice(0, 80)
  };
}
