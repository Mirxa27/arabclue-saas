export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { hydratePlatformEnvFromDatabase } = await import("@/lib/platform/env");
    await hydratePlatformEnvFromDatabase();
  }
}
