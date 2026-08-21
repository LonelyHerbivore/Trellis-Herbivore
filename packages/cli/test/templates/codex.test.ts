import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllAgents,
  getConfigTemplate,
} from "../../src/templates/codex/index.js";
import { resolveAllAsSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const REVIEW_AGENTS = [
  ["trellis-spec-review", "spec-review"],
  ["trellis-code-review", "code-review"],
  ["trellis-code-architecture-review", "code-architecture-review"],
  ["trellis-merge-review", "merge-review"],
] as const;

const EXPECTED_AGENT_NAMES = [
  "trellis-check",
  "trellis-code-architecture-review",
  "trellis-code-review",
  "trellis-implement",
  "trellis-merge-review",
  "trellis-research",
  "trellis-spec-review",
];

// Shared skills are now sourced from common/ via resolveAllAsSkills
describe("codex shared skills (from common source)", () => {
  it("resolves all common templates for codex context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    for (const skill of skills) {
      // Codex uses $ prefix, not /trellis:
      expect(skill.content).not.toContain("/trellis:");
      expect(skill.content).not.toContain(".cursor/");
    }
  });
});

describe("codex getAllAgents", () => {
  it("returns the expected custom agent set", () => {
    const agents = getAllAgents();
    const names = agents.map((agent) => agent.name);
    expect(names).toEqual(EXPECTED_AGENT_NAMES);
  });

  it("each agent has required fields (name, description, developer_instructions)", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content.length).toBeGreaterThan(0);
      expect(agent.content).toContain("name = ");
      expect(agent.content).toContain("description = ");
      expect(agent.content).toContain("developer_instructions = ");
    }
  });
});

describe("codex read-only review agents", () => {
  for (const [agentName, gate] of REVIEW_AGENTS) {
    it(agentName + " keeps the task, read-only, and report contract", () => {
      const agent = getAllAgents().find(({ name }) => name === agentName);
      const content = agent?.content ?? "";

      expect(agent).toBeDefined();
      expect(content).toContain('name = "' + agentName + '"');
      expect(content).toContain('sandbox_mode = "read-only"');
      expect(content).toContain("MUST NOT spawn another `trellis-check`");
      expect(content.toLowerCase()).toContain("workflow-state breadcrumbs");
      expect(content).toContain("<task-path>/task.json");
      expect(content).toContain("task.worktree_path");
      expect(content).toContain("`" + gate + "`");
      expect(content).toContain("legacy task");
      expect(content).toContain("`unselected`");
      expect(content).toContain("disabled gate");
      expect(content).toContain("The main session writes");
      expect(content).toContain("**Result: PASS / FAIL**");
      expect(content).toContain("`<file>:<line>`");
      expect(content).toContain("### Blocking Issues");
      expect(content).toContain("### Suggested Next Actions");
      expect(content).toContain("### Verification Results");
      expect(content).toMatch(/\[features\][\s\S]*?multi_agent\s*=\s*false/);
      expect(content).toMatch(
        /\[features\.multi_agent_v2\][\s\S]*?enabled\s*=\s*false/,
      );
    });
  }
});

describe("codex shared skill source", () => {
  it("exposes trellis-break-loop from the common template source", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    const breakLoop = skills.find((skill) => skill.name === "trellis-break-loop");
    const commonSource = fs.readFileSync(
      path.join(repoRoot, "packages/cli/src/templates/common/skills/break-loop.md"),
      "utf-8",
    );

    expect(breakLoop).toBeDefined();
    expect(breakLoop?.content).toContain(commonSource.trim());
  });
});


describe("codex getConfigTemplate", () => {
  it("returns project config.toml content", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toContain("project_doc_fallback_filenames");
    expect(config.content).toContain("AGENTS.md");
  });
});

// =============================================================================
// Issue #234 — Codex sub-agent recursion guard
// =============================================================================
//
// trellis-implement / trellis-check agent toml MUST contain a hard recursion
// guard that tells the sub-agent it is already the dispatched agent and must
// not spawn another trellis-implement / trellis-check sub-agent. Without this,
// SessionStart's "dispatch trellis-implement" guidance leaks into sub-agent
// sessions and causes infinite recursion (see PRD).
describe("codex sub-agent recursion guard (issue #234)", () => {
  for (const name of ["trellis-implement", "trellis-check"] as const) {
    it(`${name}.toml developer_instructions forbids spawning trellis-implement / trellis-check`, () => {
      const tomlPath = path.join(
        repoRoot,
        "packages/cli/src/templates/codex/agents",
        `${name}.toml`,
      );
      const content = fs.readFileSync(tomlPath, "utf-8");
      // Hard prohibition keyword
      expect(content).toMatch(/MUST NOT spawn/i);
      // Mentions both sibling agent kinds explicitly
      expect(content).toContain("trellis-implement");
      expect(content).toContain("trellis-check");
      // Mentions the leakage source so the reader knows why
      expect(content).toMatch(/SessionStart|dispatch.*main session|breadcrumb/i);
    });
  }
});

describe("codex session-start.py compact SessionStart context", () => {
  const hookPath = path.join(
    repoRoot,
    "packages/cli/src/templates/codex/hooks/session-start.py",
  );

  it("uses compact task artifact guidance instead of sub-agent dispatch prose", () => {
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("Trellis compact SessionStart context");
    expect(content).toContain("Task context order for implementation/check");
    expect(content).toContain("design.md if present");
    expect(content).not.toContain("<sub-agent-notice>");
    expect(content).not.toContain("guides (inlined");
    expect(content).not.toContain("Project spec indexes are listed by path below");
  });
});
