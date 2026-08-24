import path from "node:path";
import { getTemplateContext } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  resolveAllAsSkills,
  resolveBundledSkills,
  writeSkills,
  writeAgents,
  writeSharedHooks,
} from "./shared.js";
import { getAllAgents } from "../templates/kiro/index.js";

/**
 * Configure Kiro Code:
 * - skills/trellis-{name}/SKILL.md — all templates as auto-triggered skills
 * - agents/{name}.json — sub-agent definitions (JSON, with hooks embedded)
 * - hooks/*.py — shared hook scripts (referenced by agent JSON hooks)
 */
export async function configureKiro(cwd: string): Promise<void> {
  // Kiro configDir is ".kiro/skills" — agents and hooks go under ".kiro/"
  const kiroRoot = path.join(cwd, ".kiro");

  await writeSkills(
    path.join(kiroRoot, "skills"),
    resolveAllAsSkills(getTemplateContext("kiro")),
    resolveBundledSkills(getTemplateContext("kiro")),
  );

  // Agents (JSON format, with {{PYTHON_CMD}} resolved)
  const agents = getAllAgents().map((a) => ({
    ...a,
    content: resolvePlaceholders(a.content),
  }));
  await writeAgents(path.join(kiroRoot, "agents"), agents, ".json");

  await writeSharedHooks(path.join(kiroRoot, "hooks"), "kiro");
}
