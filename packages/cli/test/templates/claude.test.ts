import { describe, expect, it } from "vitest";
import {
  settingsTemplate,
  getAllAgents,
  getSettingsTemplate,
} from "../../src/templates/claude/index.js";

// =============================================================================
// settingsTemplate — module-level constant
// =============================================================================

describe("settingsTemplate", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(settingsTemplate)).not.toThrow();
  });

  it("is a non-empty string", () => {
    expect(settingsTemplate.length).toBeGreaterThan(0);
  });

  // v0.5.0-beta.8: pin CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 at the project
  // level so Bash tool cwd changes don't leak into subsequent hook invocations.
  // Without this, a user who runs `cd frontend/` via Bash tool leaves cwd stuck
  // in `frontend/`, and the next UserPromptSubmit hook (which resolves
  // `.claude/hooks/inject-workflow-state.py` relative to cwd) crashes with
  // ENOENT. We can't fix this via command-string rewriting because
  // $CLAUDE_PROJECT_DIR doesn't expand on Windows shells (see CC issue #6023).
  // The env-var approach is read by CC internally, identical on all platforms.
  it("sets CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 in env", () => {
    const settings = JSON.parse(settingsTemplate) as {
      env?: Record<string, string>;
    };
    expect(settings.env?.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR).toBe("1");
  });
});

// =============================================================================
// settingsTemplate — SessionStart hook matchers
// =============================================================================

describe("settingsTemplate SessionStart matchers", () => {
  const settings = JSON.parse(settingsTemplate);
  const sessionStartEntries = settings.hooks.SessionStart as {
    matcher: string;
    hooks: { type: string; command: string; timeout: number }[];
  }[];

  it("includes startup, clear, and compact matchers", () => {
    const matchers = sessionStartEntries.map((e) => e.matcher);
    expect(matchers).toContain("startup");
    expect(matchers).toContain("clear");
    expect(matchers).toContain("compact");
  });

  it("all SessionStart entries invoke the same session-start.py hook", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks).toHaveLength(1);
      expect(entry.hooks[0].command).toContain("session-start.py");
    }
  });

  it("all SessionStart entries use {{PYTHON_CMD}} placeholder", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks[0].command).toContain("{{PYTHON_CMD}}");
    }
  });
});

// Commands are now sourced from common/ templates and tested in platforms.test.ts

// =============================================================================
// getAllAgents — reads agent templates
// =============================================================================

describe("getAllAgents", () => {
  it("each agent has name and content", () => {
    const agents = getAllAgents();
    for (const agent of agents) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });

  it("includes Claude review-gate agents", () => {
    const names = getAllAgents().map((agent) => agent.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "trellis-implement",
        "trellis-check",
        "trellis-spec-review",
        "trellis-code-review",
        "trellis-code-architecture-review",
        "trellis-merge-review",
      ]),
    );
  });

  it("uses the configured model matrix and keeps review gates read-only", () => {
    const agents = new Map(
      getAllAgents().map((agent) => [agent.name, agent.content]),
    );
    const sonnetAgentNames = [
      "trellis-research",
      "trellis-check",
      "trellis-spec-review",
      "trellis-code-review",
      "trellis-merge-review",
    ];
    const reviewGateNames = [
      "trellis-spec-review",
      "trellis-code-review",
      "trellis-code-architecture-review",
      "trellis-merge-review",
    ];

    for (const name of sonnetAgentNames) {
      expect(agents.get(name)).toContain("model: sonnet");
    }
    expect(agents.get("trellis-code-architecture-review")).toContain(
      "model: opus",
    );

    const opusAgentNames = [...agents]
      .filter(([, content]) => content.includes("model: opus"))
      .map(([name]) => name);
    expect(opusAgentNames).toEqual(["trellis-code-architecture-review"]);

    for (const name of reviewGateNames) {
      const content = agents.get(name);
      expect(content).toBeDefined();
      expect(content).toContain("tools: Read, Bash, Glob, Grep");
      expect(content).not.toContain("Write");
      expect(content).not.toContain("Edit");
      expect(content).toContain("reports blocking issues to the main session");
    }
  });

  it("trellis implement agent opts into acceptEdits without widening other Claude agents", () => {
    const agents = new Map(
      getAllAgents().map((agent) => [agent.name, agent.content]),
    );

    const implementContent = agents.get("trellis-implement");
    const checkContent = agents.get("trellis-check");

    expect(implementContent).toBeDefined();
    expect(implementContent).toContain("permissionMode: acceptEdits");
    expect(implementContent).not.toMatch(/^model:/m);
    expect(checkContent).toBeDefined();
    expect(checkContent).not.toContain("permissionMode: acceptEdits");
  });

  it("trellis implement and check agents preserve explicit review-gate contract semantics", () => {
    const agents = new Map(
      getAllAgents().map((agent) => [agent.name, agent.content]),
    );

    for (const name of ["trellis-implement", "trellis-check"]) {
      const content = agents.get(name);
      expect(content).toBeDefined();
      expect(content).toContain("Review-gate contract: explicit-selection-v1");
      expect(content).toContain("Review-gate contract: explicit-selection-v1");
      expect(content).toContain("Optional review gates status: configured");
      expect(content).toContain("trellis-improve-codebase-architecture");
      expect(content).toContain("trellis-code-architecture-review");
      expect(content).toContain("trellis-merge-review");
      expect(content).toContain("legacy task");
      expect(content).toContain("<task-path>/task.json");
      expect(content).toContain("`task.worktree_path` is the sole worktree path");
      expect(content).toContain("do not derive or override it from task Markdown");
      expect(content).toContain("do not create, switch, nest, or synchronize a worktree");
      expect(content).not.toContain(
        "stay on the shared `./.trellis/trellis-worktrees",
      );
    }
  });

  it("Claude review-gate agents use the task record as the shared gate contract", () => {
    const agents = new Map(
      getAllAgents().map((agent) => [agent.name, agent.content]),
    );
    const reviewGates = [
      ["trellis-spec-review", "spec-review"],
      ["trellis-code-review", "code-review"],
      ["trellis-code-architecture-review", "code-architecture-review"],
      ["trellis-merge-review", "merge-review"],
    ] as const;

    for (const [name, gate] of reviewGates) {
      const content = agents.get(name);
      expect(content).toBeDefined();
      expect(content).toContain("<task-path>/task.json");
      expect(content).toContain("The task record is authoritative");
      expect(content).toContain("workflow.selection_status: unselected");
      expect(content).toContain(`disabled \`${gate}\` gate`);
      expect(content).toContain("Missing `workflow` is legacy compatibility");
      expect(content).toContain("## Read-Only Boundary");
      expect(content).toContain(
        "Do not edit product code, task artifacts, `task.json`, reports, or configuration.",
      );
      expect(content).toContain("Return the Markdown report only.");
      expect(content).toContain(`<task-path>/reports/${gate}.md`);
      expect(content).toContain(`workflow.review_gates.runs.${gate}`);
      expect(content).toContain("`task.worktree_path` is the sole worktree path");
      expect(content).toContain("do not derive or override it from task Markdown");
      expect(content).not.toContain("stay on the shared `./.trellis/trellis-worktrees");
      expect(content).toContain("### Findings");
      expect(content).toContain("### Blocking Issues");
      expect(content).toContain("### Suggested Next Actions");
      expect(content).toContain("### Verification Results");
    }
  });
});

// =============================================================================
// getSettingsTemplate — returns settings as SettingsTemplate
// =============================================================================

describe("getSettingsTemplate", () => {
  it("returns correct shape with valid JSON", () => {
    const result = getSettingsTemplate();
    expect(result.targetPath).toBe("settings.json");
    expect(result.content.length).toBeGreaterThan(0);
    expect(() => JSON.parse(result.content)).not.toThrow();
  });
});
