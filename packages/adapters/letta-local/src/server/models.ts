import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { DEFAULT_LETTA_LOCAL_MODEL } from "../index.js";

const DEFAULT_LETTA_BASE_URL = "https://api.letta.com";
const LETTA_SETTINGS_PATHS = ["settings.json", "settings.local.json"].map((name) =>
  path.join(os.homedir(), ".letta", name),
);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeBaseUrl(value: string | null): string {
  if (!value) return DEFAULT_LETTA_BASE_URL;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function readLettaSettingsEnv(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const settingsPath of LETTA_SETTINGS_PATHS) {
    try {
      const raw = await fs.readFile(settingsPath, "utf8");
      const parsed = asRecord(JSON.parse(raw));
      const env = asRecord(parsed?.env);
      if (!env) continue;
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string" && value.trim().length > 0) {
          merged[key] = value.trim();
        }
      }
    } catch {
      // Ignore missing or unreadable settings files.
    }
  }
  return merged;
}

async function resolveLettaAuth(): Promise<{ baseUrl: string; apiKey: string | null }> {
  const settingsEnv = await readLettaSettingsEnv();
  const baseUrl = normalizeBaseUrl(
    asString(process.env.LETTA_BASE_URL) ?? asString(settingsEnv.LETTA_BASE_URL),
  );
  const apiKey =
    asString(process.env.LETTA_API_KEY) ??
    asString(process.env.PAPERCLIP_API_KEY) ??
    asString(settingsEnv.LETTA_API_KEY) ??
    null;
  return { baseUrl, apiKey };
}

function toAdapterModel(raw: Record<string, unknown>): AdapterModel | null {
  if (raw.model_type && asString(raw.model_type) !== "llm") return null;
  const id =
    asString(raw.handle) ??
    asString(raw.name) ??
    asString(raw.model) ??
    asString(raw.id);
  if (!id) return null;
  const label =
    asString(raw.display_name) ??
    asString(raw.handle) ??
    asString(raw.name) ??
    id;
  return { id, label };
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }
  return deduped;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) => {
    if (a.id === DEFAULT_LETTA_LOCAL_MODEL) return -1;
    if (b.id === DEFAULT_LETTA_LOCAL_MODEL) return 1;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}

export function fallbackLettaModels(): AdapterModel[] {
  return [{ id: DEFAULT_LETTA_LOCAL_MODEL, label: DEFAULT_LETTA_LOCAL_MODEL }];
}

export async function listLettaModels(): Promise<AdapterModel[]> {
  const { baseUrl, apiKey } = await resolveLettaAuth();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(new URL("/v1/models/", baseUrl), {
      method: "GET",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Letta model list request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const records = Array.isArray(payload)
      ? payload
      : asRecord(payload)?.data && Array.isArray(asRecord(payload)?.data)
        ? (asRecord(payload)?.data as unknown[])
        : asRecord(payload)?.models && Array.isArray(asRecord(payload)?.models)
          ? (asRecord(payload)?.models as unknown[])
          : [];

    const models = dedupeModels(
      records
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map(toAdapterModel)
        .filter((entry): entry is AdapterModel => entry !== null),
    );

    return models.length > 0 ? sortModels(models) : fallbackLettaModels();
  } catch {
    return fallbackLettaModels();
  } finally {
    clearTimeout(timeout);
  }
}
