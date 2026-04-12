import type { UIAdapterModule } from "../types";
import { parseClawStdoutLine } from "@paperclipai/adapter-claw-local/ui";
import { buildClawConfig } from "@paperclipai/adapter-claw-local/ui";

// Simple config fields component - can be expanded with actual form fields later
export function ClawConfigFields() {
  return null;
}

export const clawLocalUIAdapter: UIAdapterModule = {
  type: "claw_local",
  label: "Claw Code (local)",
  parseStdoutLine: parseClawStdoutLine,
  ConfigFields: ClawConfigFields,
  buildAdapterConfig: buildClawConfig,
};
