import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterSkillContext, AdapterSkillSnapshot } from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readInstalledSkillTargets,
  readPaperclipRuntimeSkillEntries,
  removeMaintainerOnlySkillSymlinks,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const LETTA_PROJECT_SKILLS_DIRNAME = ".skills";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveLettaSkillsHome(config: Record<string, unknown>) {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asString(env.HOME);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return path.join(home, ".letta", "skills");
}

export function resolveLettaProjectSkillsDir(cwd: string) {
  return path.join(cwd, LETTA_PROJECT_SKILLS_DIRNAME);
}

async function buildLettaSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveLettaSkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);
  return buildPersistentSkillSnapshot({
    adapterType: "letta_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.letta/skills",
    missingDetail: "Configured but not currently linked into the Letta global skills directory.",
    externalConflictDetail: "Skill name is occupied by an external Letta skill installation.",
    externalDetail: "Installed outside Paperclip management.",
  });
}

export async function listLettaSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildLettaSkillSnapshot(ctx.config);
}

export async function syncLettaSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const desiredSet = new Set([
    ...desiredSkills,
    ...availableEntries.filter((entry) => entry.required).map((entry) => entry.key),
  ]);
  const skillsHome = resolveLettaSkillsHome(ctx.config);
  await fs.mkdir(skillsHome, { recursive: true });
  const installed = await readInstalledSkillTargets(skillsHome);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) continue;
    const target = path.join(skillsHome, available.runtimeName);
    await ensurePaperclipSkillSymlink(available.source, target);
  }

  for (const [name, installedEntry] of installed.entries()) {
    const available = availableByRuntimeName.get(name);
    if (!available) continue;
    if (desiredSet.has(available.key)) continue;
    if (installedEntry.targetPath !== available.source) continue;
    await fs.unlink(path.join(skillsHome, name)).catch(() => {});
  }

  return buildLettaSkillSnapshot(ctx.config);
}

type EnsureLettaProjectSkillsInjectedOptions = {
  skillsDir?: string;
  skillsEntries?: Array<{ key: string; runtimeName: string; source: string }>;
  desiredSkillNames?: string[];
};

export async function ensureLettaProjectSkillsInjected(
  onLog: AdapterExecutionContext["onLog"],
  options: EnsureLettaProjectSkillsInjectedOptions,
) {
  const allSkillsEntries = options.skillsEntries ?? await readPaperclipRuntimeSkillEntries({}, __moduleDir);
  const desiredSkillNames = options.desiredSkillNames ?? allSkillsEntries.map((entry) => entry.key);
  const desiredSet = new Set(desiredSkillNames);
  const skillsEntries = allSkillsEntries.filter((entry) => desiredSet.has(entry.key));
  if (skillsEntries.length === 0) return;

  const skillsDir = options.skillsDir;
  if (!skillsDir) return;

  await fs.mkdir(skillsDir, { recursive: true });
  for (const entry of skillsEntries) {
    const target = path.join(skillsDir, entry.runtimeName);
    try {
      const result = await ensurePaperclipSkillSymlink(entry.source, target);
      if (result === "skipped") continue;
      await onLog(
        "stdout",
        `[paperclip] ${result === "repaired" ? "Repaired" : "Injected"} Letta skill "${entry.runtimeName}" into ${skillsDir}
`,
      );
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Failed to inject Letta skill "${entry.key}" into ${skillsDir}: ${err instanceof Error ? err.message : String(err)}
`,
      );
    }
  }

  const desiredRuntimeNames = skillsEntries.map((entry) => entry.runtimeName);
  const removed = await removeMaintainerOnlySkillSymlinks(skillsDir, desiredRuntimeNames);
  for (const name of removed) {
    await onLog(
      "stdout",
      `[paperclip] Removed stale Letta skill "${name}" from ${skillsDir}
`,
    );
  }
}
