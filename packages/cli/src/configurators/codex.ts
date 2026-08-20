import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import {
  getAllAgents,
  getAllHooks,
  getConfigTemplate,
  getHooksConfig,
} from "../templates/codex/index.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolveAllAsSkillsNeutral,
  resolveBundledSkills,
  resolveCodexTrellisStartSkill,
  applyPullBasedPreludeToml,
  writeSkills,
  writeSharedHooks,
  replacePythonCommandLiterals,
  replacePythonCommandLiteralsForToml,
  resolveCodexHooksConfig,
} from "./shared.js";

/**
 * Configure Codex by writing:
 * - .agents/skills/ — Trellis skills from the common source
 * - .codex/agents/, hooks/, hooks.json, config.toml — platform-specific
 */
export async function configureCodex(cwd: string): Promise<void> {
  // Shared skills from common source → .agents/skills/
  // Uses the neutral placeholder resolver so the 5 shared workflow skills
  // (brainstorm, before-dev, check, break-loop, update-spec) render to the
  // same bytes regardless of which platform writes them — required because
  // Gemini CLI 0.40+ also targets `.agents/skills/` (last-writer-wins is
  // safe when both writers produce identical output).
  const sharedSkillsRoot = path.join(cwd, ".agents", "skills");
  await writeSkills(
    sharedSkillsRoot,
    resolveAllAsSkillsNeutral(AI_TOOLS.codex.templateContext),
    resolveBundledSkills(AI_TOOLS.codex.templateContext),
  );

  // Additionally write `trellis-start` to .agents/skills/ — Codex-specific.
  // The SessionStart hook was removed in 0.5.5 (de-recursion); inject-workflow-state.py
  // injects a `<trellis-bootstrap>` block on no_task turns instructing the AI to
  // invoke `$trellis-start` to load workflow context. Without this skill, that
  // invocation has nothing to resolve. Other agent-capable platforms keep their
  // working SessionStart hooks and don't need this.
  // Must stay in sync with `collectPlatformTemplates.codex.collectTemplates`
  // (configurators/index.ts) — both share `resolveCodexTrellisStartSkill`.
  const trellisStart = resolveCodexTrellisStartSkill(
    AI_TOOLS.codex.templateContext,
  );
  if (trellisStart) {
    const trellisStartDir = path.join(sharedSkillsRoot, trellisStart.name);
    ensureDir(trellisStartDir);
    await writeFile(
      path.join(trellisStartDir, "SKILL.md"),
      trellisStart.content,
    );
  }

  const codexRoot = path.join(cwd, ".codex");

  // Custom agents → .codex/agents/
  const codexAgentsRoot = path.join(codexRoot, "agents");
  ensureDir(codexAgentsRoot);

  // Codex is a class-2 (pull-based) platform: PreToolUse only fires for Bash
  // and CollabAgentSpawn hook is not implemented (#15486). Sub-agents must
  // load Trellis context themselves via the prelude injected here.
  for (const agent of applyPullBasedPreludeToml(getAllAgents())) {
    await writeFile(
      path.join(codexAgentsRoot, `${agent.name}.toml`),
      replacePythonCommandLiteralsForToml(agent.content),
    );
  }

  // Hooks → .codex/hooks/
  const hooksDir = path.join(codexRoot, "hooks");
  ensureDir(hooksDir);

  // Codex-specific hook files. hooks.json currently registers only
  // UserPromptSubmit; session-start.py is retained as a compact compatibility
  // template and regression surface.
  for (const hook of getAllHooks()) {
    await writeFile(
      path.join(hooksDir, hook.name),
      replacePythonCommandLiterals(hook.content),
    );
  }

  // Shared hooks (inject-workflow-state.py only). Sub-agent context is
  // pull-based (class-2).
  await writeSharedHooks(hooksDir, "codex");

  // Hooks config → .codex/hooks.json
  await writeFile(
    path.join(codexRoot, "hooks.json"),
    resolveCodexHooksConfig(getHooksConfig()),
  );

  // User-level hook prerequisites are checked during Codex init/update. The
  // generated AGENTS.md keeps the trellis-start fallback whenever hooks are
  // disabled or have not yet been approved through /hooks.
  // Config → .codex/config.toml
  const config = getConfigTemplate();
  await writeFile(
    path.join(codexRoot, config.targetPath),
    replacePythonCommandLiterals(config.content),
  );
}
