import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SHARED_HOOKS_BY_PLATFORM,
  getSharedHookScripts,
  getSharedHookScriptsForPlatform,
  type SharedHookPlatform,
} from "../../src/templates/shared-hooks/index.js";

const ALL_HOOK_FILES = [
  "session-start.py",
  "inject-shell-session-context.py",
  "inject-workflow-state.py",
  "inject-subagent-context.py",
] as const;

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const PYTHON = process.platform === "win32" ? "python" : "python3";

function hasPython(): boolean {
  try {
    execFileSync(PYTHON, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function writeTaskArtifacts(repoRoot: string, taskName: string, prd: string): void {
  const taskDir = path.join(repoRoot, ".trellis", "tasks", taskName);
  fs.mkdirSync(path.join(taskDir, "research"), { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({
      id: taskName,
      name: taskName,
      title: taskName,
      status: "in_progress",
      priority: "P2",
      createdAt: "2026-06-04",
      assignee: "test",
      creator: "test",
      subtasks: [],
      children: [],
      relatedFiles: [],
      meta: {},
    }) + "\n",
  );
  fs.writeFileSync(path.join(taskDir, "prd.md"), prd);
  fs.writeFileSync(path.join(taskDir, "design.md"), "# design\n");
  fs.writeFileSync(path.join(taskDir, "implement.md"), "# implement\n");
  fs.writeFileSync(
    path.join(taskDir, "implement.jsonl"),
    '{"file":".trellis/spec/guides/index.md","reason":"test"}\n',
  );
  fs.writeFileSync(
    path.join(taskDir, "check.jsonl"),
    '{"file":".trellis/spec/guides/index.md","reason":"test"}\n',
  );
  fs.writeFileSync(path.join(taskDir, "research", "note.md"), "research\n");
}

function setupMainRepo(repoRoot: string, taskName: string, prd: string): void {
  fs.mkdirSync(repoRoot, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  fs.mkdirSync(path.join(repoRoot, ".trellis"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(repoRoot, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repoRoot, ".trellis", "spec", "guides"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(repoRoot, ".trellis", "workflow.md"), "# Workflow\n");
  fs.writeFileSync(path.join(repoRoot, ".trellis", "config.yaml"), "session_auto_commit: false\n");
  fs.writeFileSync(path.join(repoRoot, ".trellis", ".gitignore"), ".runtime/\n");
  fs.writeFileSync(path.join(repoRoot, ".trellis", "spec", "guides", "index.md"), "# Guides\n");
  writeTaskArtifacts(repoRoot, taskName, prd);
}

function runSessionStart(worktreeRoot: string): string {
  const sessionStart = getSharedHookScripts().find((h) => h.name === "session-start.py");
  if (!sessionStart) {
    throw new Error("session-start.py template missing");
  }
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-session-start-"));
  const scriptPath = path.join(scriptDir, "session-start.py");
  fs.writeFileSync(scriptPath, sessionStart.content);
  try {
    const result = spawnSync(PYTHON, [scriptPath], {
      cwd: worktreeRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: worktreeRoot,
      },
      input: JSON.stringify({ cwd: worktreeRoot }),
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "session-start failed");
    }
    return result.stdout;
  } finally {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
}

describe("shared-hooks capability table", () => {
  it("every capability-table entry names a real shared-hook file", () => {
    const realFiles = new Set(getSharedHookScripts().map((h) => h.name));
    for (const [platform, hooks] of Object.entries(
      SHARED_HOOKS_BY_PLATFORM,
    )) {
      for (const hook of hooks) {
        expect(
          realFiles.has(hook),
          `${platform} declares ${hook} but no such file exists under shared-hooks/`,
        ).toBe(true);
      }
    }
  });

  it("every shared-hook file is distributed to at least one platform", () => {
    const distributed = new Set<string>();
    for (const hooks of Object.values(SHARED_HOOKS_BY_PLATFORM)) {
      for (const h of hooks) distributed.add(h);
    }
    for (const hook of getSharedHookScripts()) {
      expect(
        distributed.has(hook.name),
        `${hook.name} exists under shared-hooks/ but no platform installs it — dead template`,
      ).toBe(true);
    }
  });

  it("statusline.py is not distributed by default", () => {
    const realFiles = new Set(getSharedHookScripts().map((h) => h.name));
    expect(realFiles.has("statusline.py")).toBe(false);
    for (const [platform, hooks] of Object.entries(
      SHARED_HOOKS_BY_PLATFORM,
    )) {
      expect(
        (hooks as readonly string[]).includes("statusline.py"),
        `${platform} must not install the generated statusline.py hook by default`,
      ).toBe(false);
    }
  });

  it("inject-subagent-context.py is restricted to class-1 push-based platforms", () => {
    // Class-2 (pull-based) platforms load context via agent-definition prelude,
    // not a hook-mutated prompt.
    const class2 = new Set(["codex", "copilot", "gemini", "qoder"]);
    for (const [platform, hooks] of Object.entries(
      SHARED_HOOKS_BY_PLATFORM,
    )) {
      const has = hooks.includes("inject-subagent-context.py");
      if (class2.has(platform))
        expect(
          has,
          `${platform} is class-2 pull-based and must not ship inject-subagent-context.py`,
        ).toBe(false);
    }
  });

  it("codex + copilot do not take the shared session-start.py (they bundle their own)", () => {
    expect(SHARED_HOOKS_BY_PLATFORM.codex).not.toContain("session-start.py");
    expect(SHARED_HOOKS_BY_PLATFORM.copilot).not.toContain("session-start.py");
  });

  it("inject-shell-session-context.py goes to Cursor only", () => {
    for (const [platform, hooks] of Object.entries(
      SHARED_HOOKS_BY_PLATFORM,
    )) {
      const has = hooks.includes("inject-shell-session-context.py");
      if (platform === "cursor") expect(has).toBe(true);
      else
        expect(
          has,
          `${platform} declares inject-shell-session-context.py but does not use Cursor beforeShellExecution`,
        ).toBe(false);
    }
  });

  it("kiro registers only inject-subagent-context.py (agentSpawn is its only hook event)", () => {
    expect([...SHARED_HOOKS_BY_PLATFORM.kiro]).toEqual([
      "inject-subagent-context.py",
    ]);
  });

  it("getSharedHookScriptsForPlatform returns exactly the declared set per platform", () => {
    for (const platform of Object.keys(
      SHARED_HOOKS_BY_PLATFORM,
    ) as SharedHookPlatform[]) {
      const names = getSharedHookScriptsForPlatform(platform)
        .map((h) => h.name)
        .sort();
      const expected = [...SHARED_HOOKS_BY_PLATFORM[platform]].sort();
      expect(names).toEqual(expected);
    }
  });

  it("shared-hooks directory only contains files enumerated by ALL_HOOK_FILES", () => {
    // Guards against a new shared hook being added without the capability
    // table being updated.
    const actual = new Set(getSharedHookScripts().map((h) => h.name));
    const expected = new Set(ALL_HOOK_FILES);
    expect(actual).toEqual(expected);
  });

  it("shared hooks do not read legacy .current-task state", () => {
    for (const hook of getSharedHookScripts()) {
      expect(
        hook.content,
        `${hook.name} must use the session-scoped active task resolver`,
      ).not.toContain(".current-task");
      expect(hook.content).not.toContain("global fallback");
    }
  });

  it("shared hooks honor trellis-switch.json gating", () => {
    const hooks = new Map(getSharedHookScripts().map((h) => [h.name, h.content]));
    expect(hooks.get("session-start.py")).toContain("_read_trellis_switch_enabled");
    expect(hooks.get("session-start.py")).toContain("trellis-switch.json");
    expect(hooks.get("session-start.py")).toContain('_detect_platform({}) == "claude"');
    expect(hooks.get("inject-workflow-state.py")).toContain("_read_trellis_switch_enabled");
    expect(hooks.get("inject-workflow-state.py")).toContain("trellis-switch.json");
    expect(hooks.get("inject-subagent-context.py")).toContain("_read_trellis_switch_enabled");
    expect(hooks.get("inject-subagent-context.py")).toContain("trellis-switch.json");
    expect(hooks.get("inject-subagent-context.py")).toContain("trellis-worktrees");
    expect(hooks.get("inject-subagent-context.py")).toContain("_infer_worktree_task");
  });

  it("shared session-start.py injects compact task artifact guidance", () => {
    const sessionStart = getSharedHookScripts().find(
      (h) => h.name === "session-start.py",
    );
    expect(sessionStart, "session-start.py is missing from shared-hooks/").toBeDefined();
    const content = sessionStart ? sessionStart.content : "";
    expect(content).toContain("<trellis-workflow>");
    expect(content).toContain("Task context order");
    expect(content).toContain("jsonl entries -> `prd.md`");
    expect(content).toContain("Lightweight task can request start review with PRD-only");
    expect(content).toContain("complex task must add");
    expect(content).toContain("trellis-worktrees");
    expect(content).toContain("<worktree-sync>");
    expect(content).not.toContain("Status: READY");
    expect(content).not.toContain("<workflow>");
  });
});

describe.skipIf(!hasPython())("shared session-start worktree bootstrap", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeRoot: string;
  const taskName = "06-04-worktree-bootstrap";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-shared-hooks-"));
    repoRoot = path.join(tmpDir, "repo");
    worktreeRoot = path.join(
      repoRoot,
      ".claude",
      "trellis-worktrees",
      taskName,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("bootstraps runtime bundle and planning snapshot into a Trellis-managed worktree", () => {
    setupMainRepo(repoRoot, taskName, "main planning\n");
    fs.mkdirSync(worktreeRoot, { recursive: true });

    const raw = runSessionStart(worktreeRoot);
    const parsed = JSON.parse(raw) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext ?? "";

    expect(context).toContain("<worktree-sync>");
    expect(context).toContain("Bootstrapped runtime bundle from main workspace");
    expect(context).toContain("Bootstrapped current task planning snapshot from main workspace");
    expect(context).toContain(`Current task: .trellis/tasks/${taskName}; status=in_progress.`);
    expect(
      fs.existsSync(path.join(worktreeRoot, ".trellis", "scripts", "task.py")),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(worktreeRoot, ".trellis", "tasks", taskName, "prd.md"),
        "utf-8",
      ),
    ).toContain("main planning");
    expect(
      fs.existsSync(
        path.join(worktreeRoot, ".trellis", "tasks", taskName, "research", "note.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(worktreeRoot, ".trellis", ".runtime"))).toBe(false);
  });

  it("reports planning drift and asks for explicit main-workspace overwrite", () => {
    setupMainRepo(repoRoot, taskName, "main planning\n");
    fs.mkdirSync(path.join(worktreeRoot, ".trellis", "tasks", taskName), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(worktreeRoot, ".trellis", "tasks", taskName, "task.json"),
      JSON.stringify({ title: taskName, status: "in_progress" }) + "\n",
    );
    fs.writeFileSync(
      path.join(worktreeRoot, ".trellis", "tasks", taskName, "prd.md"),
      "worktree planning\n",
    );

    const raw = runSessionStart(worktreeRoot);
    const parsed = JSON.parse(raw) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext ?? "";

    expect(context).toContain("Planning drift detected between main workspace and worktree");
    expect(context).toContain(
      "已检测到主工作区的某个任务的prd.md/planning与worktree不一致，是否执行 主工作区覆盖worktree 的操作？",
    );
    expect(context).toContain("`.backup-`");
    expect(context).toContain("inherit the original task's planning context");
  });
});
