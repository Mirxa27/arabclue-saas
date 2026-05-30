export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { configHealthSummary, getPlatformConfigGroups } from "@/lib/admin/env-status";
import { getAllPlatformSettings, updatePlatformSetting } from "@/lib/admin/platform-settings";
import { savePlatformSecrets } from "@/lib/admin/platform-secrets";
import { MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";
import { handleRouteError } from "@/lib/api/route-handler";
import { hydratePlatformEnvFromDatabase, invalidatePlatformEnvCache } from "@/lib/platform/env";

export async function GET() {
  try {
    await requirePlatformAdminApi();
    await hydratePlatformEnvFromDatabase();
    const groups = getPlatformConfigGroups();
    const settings = await getAllPlatformSettings();
    return NextResponse.json({
      groups,
      health: configHealthSummary(groups),
      settings,
      managedKeys: MANAGED_SECRET_KEYS
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

const PatchSchema = z.object({
  agents: z
    .object({
      social: z
        .object({
          enabled: z.boolean(),
          cronMinutes: z.number().int().min(5).max(1440),
          maxPostsPerRun: z.number().int().min(1).max(200)
        })
        .partial()
        .optional(),
      voice: z
        .object({
          enabled: z.boolean(),
          defaultDialect: z.enum(["khaliji", "msa", "english"])
        })
        .partial()
        .optional(),
      seo: z
        .object({
          enabled: z.boolean(),
          model: z.string().min(1),
          residency: z.enum(["global", "ksa", "eu"])
        })
        .partial()
        .optional()
    })
    .optional(),
  features: z
    .object({
      billing: z.boolean().optional(),
      zatca: z.boolean().optional(),
      wathq: z.boolean().optional(),
      socialOAuth: z.boolean().optional()
    })
    .optional(),
  secrets: z.record(z.string().min(1), z.union([z.string(), z.null()])).optional()
});

export async function PATCH(req: NextRequest) {
  try {
    await requirePlatformAdminApi();
    const body = PatchSchema.parse(await req.json());
    const current = await getAllPlatformSettings();

    if (body.agents) {
      await updatePlatformSetting("agents", {
        ...current.agents,
        social: { ...current.agents.social, ...body.agents.social },
        voice: { ...current.agents.voice, ...body.agents.voice },
        seo: { ...current.agents.seo, ...body.agents.seo }
      });
    }
    if (body.features) {
      await updatePlatformSetting("features", { ...current.features, ...body.features });
    }

    let secretsResult: { updated: string[]; skipped: string[] } | undefined;
    if (body.secrets && Object.keys(body.secrets).length > 0) {
      secretsResult = await savePlatformSecrets(body.secrets);
      invalidatePlatformEnvCache();
      await hydratePlatformEnvFromDatabase();
    }

    const groups = getPlatformConfigGroups();
    return NextResponse.json({
      ok: true,
      settings: await getAllPlatformSettings(),
      secrets: secretsResult,
      groups,
      health: configHealthSummary(groups)
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
