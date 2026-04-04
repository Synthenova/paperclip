import type { UIAdapterModule } from "../types";
import { parseLettaStdoutLine, buildLettaLocalConfig } from "@paperclipai/adapter-letta-local/ui";
import { LettaLocalConfigFields } from "./config-fields";

export const lettaLocalUIAdapter: UIAdapterModule = {
  type: "letta_local",
  label: "Letta (local)",
  parseStdoutLine: parseLettaStdoutLine,
  ConfigFields: LettaLocalConfigFields,
  buildAdapterConfig: buildLettaLocalConfig,
};
