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

function writeTaskArtifacts(
  repoRoot: string,
  taskName: string,
  prd: string,
  implementPlan = "# implement\n",
): void {
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
  fs.writeFileSync(path.join(taskDir, "implement.md"), implementPlan);
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

function setupMainRepo(
  repoRoot: string,
  taskName: string,
  prd: string,
  implementPlan?: string,
): void {
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
  writeTaskArtifacts(repoRoot, taskName, prd, implementPlan);
}

function setSessionActiveTask(
  repoRoot: string,
  taskName: string,
  contextId = "test-session",
): string {
  const sessionsDir = path.join(repoRoot, ".trellis", ".runtime", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `${contextId}.json`),
    JSON.stringify({ current_task: `.trellis/tasks/${taskName}` }) + "\n",
  );
  return contextId;
}

function setupManagedWorktreeRepo(
  worktreeRoot: string,
  taskName: string,
  prd: string,
  implementPlan = "# implement\n",
): void {
  fs.mkdirSync(worktreeRoot, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: worktreeRoot,
    encoding: "utf-8",
  });
  fs.mkdirSync(path.join(worktreeRoot, ".trellis"), { recursive: true });
  fs.cpSync(
    TEMPLATE_SCRIPTS,
    path.join(worktreeRoot, ".trellis", "scripts"),
    {
      recursive: true,
    },
  );
  fs.mkdirSync(path.join(worktreeRoot, ".trellis", "spec", "guides"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(worktreeRoot, ".trellis", "workflow.md"),
    "# Workflow\n",
  );
  fs.writeFileSync(
    path.join(worktreeRoot, ".trellis", "config.yaml"),
    "session_auto_commit: false\n",
  );
  fs.writeFileSync(
    path.join(worktreeRoot, ".trellis", ".gitignore"),
    ".runtime/\n",
  );
  fs.writeFileSync(
    path.join(worktreeRoot, ".trellis", "spec", "guides", "index.md"),
    "# Guides\n",
  );
  writeTaskArtifacts(worktreeRoot, taskName, prd, implementPlan);
}

function commitRepoState(repoRoot: string, message = "init"): void {
  spawnSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  spawnSync("git", ["config", "user.name", "Trellis Test"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  const result = spawnSync("git", ["add", "."], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git add failed");
  }
  const commit = spawnSync("git", ["commit", "-q", "-m", message], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (commit.status !== 0) {
    throw new Error(commit.stderr || commit.stdout || "git commit failed");
  }
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

function runPreToolUseHook(
  cwd: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
): {
  hookSpecificOutput?: {
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
  updatedInput?: Record<string, unknown>;
  updated_input?: Record<string, unknown>;
  systemMessage?: string;
} {
  const hook = getSharedHookScripts().find(
    (h) => h.name === "inject-subagent-context.py",
  );
  if (!hook) {
    throw new Error("inject-subagent-context.py template missing");
  }
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-pretool-"));
  const scriptPath = path.join(scriptDir, "inject-subagent-context.py");
  fs.writeFileSync(scriptPath, hook.content);
  try {
    const result = spawnSync(PYTHON, [scriptPath], {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        ...env,
      },
      input: JSON.stringify(input),
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "pre-tool hook failed");
    }
    return JSON.parse(result.stdout) as {
      hookSpecificOutput?: {
        updatedInput?: Record<string, unknown>;
        additionalContext?: string;
      };
      updatedInput?: Record<string, unknown>;
      updated_input?: Record<string, unknown>;
    };
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

describe.skipIf(!hasPython())("shared subagent hook worktree isolation fix", () => {
  let tmpDir: string;
  let repoRoot: string;
  let worktreeRoot: string;
  const taskName = "06-05-hook-isolation-fix";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-subagent-hook-"));
    repoRoot = path.join(tmpDir, "repo");
    worktreeRoot = path.join(
      tmpDir,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes conflicting Claude worktree isolation when cwd is already the shared worktree", () => {
    setupManagedWorktreeRepo(worktreeRoot, taskName, "# prd\n");

    const result = runPreToolUseHook(
      worktreeRoot,
      {
        cwd: worktreeRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: worktreeRoot,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(result.systemMessage).toContain(
      '自动移除冲突的 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      '自动移除 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "<!-- trellis-hook-injected -->",
    );
  });

  it("uses structured tool_input path fields as the shared worktree signal without active task state", () => {
    setupMainRepo(repoRoot, taskName, "# prd\n", "# implement\n");
    const sharedWorktreeRoot = path.join(
      repoRoot,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
    fs.mkdirSync(sharedWorktreeRoot, { recursive: true });

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
          target_path: `./.trellis/trellis-worktrees/${taskName}/src/index.ts`,
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      '自动移除 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "<!-- trellis-hook-injected -->",
    );
    expect(
      fs.existsSync(path.join(sharedWorktreeRoot, ".trellis", "scripts", "task.py")),
    ).toBe(true);
  });

  it("bootstraps runtime bundle into the shared worktree before dispatch", () => {
    setupMainRepo(
      repoRoot,
      taskName,
      "# prd\n",
      "# implement\n- 开发模式：subagent\n- 分支策略：worktree（路径：./.trellis/trellis-worktrees/06-05-hook-isolation-fix）\n",
    );
    const sharedWorktreeRoot = path.join(
      repoRoot,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
    fs.mkdirSync(sharedWorktreeRoot, { recursive: true });
    const contextId = setSessionActiveTask(repoRoot, taskName, "bootstrap-session");

    runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(
      fs.existsSync(path.join(sharedWorktreeRoot, ".trellis", "scripts", "task.py")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sharedWorktreeRoot, ".trellis", "tasks", taskName, "prd.md")),
    ).toBe(true);
  });

  it("covers Claude review gates when the task strategy is recorded only in prd.md", () => {
    setupMainRepo(
      repoRoot,
      taskName,
      "# prd\n## 开发策略\n- 开发模式：subagent\n- 分支策略：worktree（路径：./.trellis/trellis-worktrees/06-05-hook-isolation-fix）\n",
      "# implement\n",
    );
    const contextId = setSessionActiveTask(repoRoot, taskName, "spec-review-session");

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-spec-review",
          prompt: "Review this task against the spec.",
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "# Review Gate Task",
    );
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      "共享 `./.trellis/trellis-worktrees/06-05-hook-isolation-fix` 路径工作",
    );
  });

  it("does not mis-detect prose mentions when the recorded strategy is not shared worktree", () => {
    setupMainRepo(
      repoRoot,
      taskName,
      "# prd\n本文讨论过 `subagent + worktree` 冲突，但本任务不采用该策略。\n",
      "# implement\n- 开发模式：当前会话持续开发\n- 分支策略：当前分支直接开发\n",
    );
    const contextId = setSessionActiveTask(repoRoot, taskName, "direct-branch-session");

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: `本文只是在讨论 ./.trellis/trellis-worktrees/${taskName}/src/index.ts 这个历史路径，不应触发共享 worktree 策略。`,
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBe("worktree");
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "<!-- trellis-hook-injected -->",
    );
  });

  it("covers the documented A/B/C strategy block format in implement.md", () => {
    setupMainRepo(
      repoRoot,
      taskName,
      "# prd\n",
      "# implement\nReview-gate contract: explicit-selection-v1\n\n### A. 开发模式\n- 选择：A2 subagent\n\n### B. 分支 / worktree 方式\n- 选择：B2 worktree（路径：./.trellis/trellis-worktrees/06-05-hook-isolation-fix）\n\n### C. 开发流与架构指导\n- 选择：C1 默认流程\n",
    );
    const contextId = setSessionActiveTask(repoRoot, taskName, "abc-strategy-session");

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(result.systemMessage).toContain(
      '自动移除冲突的 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      '自动移除 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "<!-- trellis-hook-injected -->",
    );
  });

  it("uses the current shared worktree path as a Claude-only signal even without prompt hints", () => {
    setupManagedWorktreeRepo(worktreeRoot, taskName, "# prd\n");

    const result = runPreToolUseHook(
      worktreeRoot,
      {
        cwd: worktreeRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: worktreeRoot,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      '自动移除 `isolation: "worktree"`',
    );
    expect(result.hookSpecificOutput?.updatedInput?.prompt).toContain(
      "<!-- trellis-hook-injected -->",
    );
  });

  it("keeps isolation untouched on non-Claude platforms even when the shared worktree path appears", () => {
    setupManagedWorktreeRepo(worktreeRoot, taskName, "# prd\n");

    const result = runPreToolUseHook(
      worktreeRoot,
      {
        cwd: worktreeRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: `Implement on ./.trellis/trellis-worktrees/${taskName}/src/index.ts`,
          isolation: "worktree",
        },
      },
      {
        CURSOR_PROJECT_DIR: worktreeRoot,
      },
    );

    expect(result.hookSpecificOutput?.updatedInput?.isolation).toBe("worktree");
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("denies dispatch when the recorded worktree cannot be resolved", () => {
    setupMainRepo(repoRoot, taskName, "# prd\\n");
    const taskJson = path.join(repoRoot, ".trellis", "tasks", taskName, "task.json");
    const task = JSON.parse(fs.readFileSync(taskJson, "utf-8")) as Record<string, unknown>;
    task.workflow = {
      contract: "explicit-selection-v1",
      worktree_mode: "existing-worktree",
    };
    task.worktree_path = path.join(repoRoot, "missing-worktree");
    task.branch = "missing-branch";
    task.base_branch = "main";
    fs.writeFileSync(taskJson, JSON.stringify(task) + "\n");
    const contextId = setSessionActiveTask(repoRoot, taskName, "invalid-worktree-session");

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
          isolation: "worktree",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
      "dispatch stopped",
    );
    expect(result.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("denies malformed workflow records instead of falling back to a derived worktree", () => {
    setupMainRepo(repoRoot, taskName, "# prd\\n");
    const taskJson = path.join(repoRoot, ".trellis", "tasks", taskName, "task.json");
    const task = JSON.parse(fs.readFileSync(taskJson, "utf-8")) as Record<string, unknown>;
    task.workflow = "malformed";
    task.worktree_path = repoRoot;
    task.branch = "main";
    task.base_branch = "main";
    fs.writeFileSync(taskJson, JSON.stringify(task) + "\n");
    const contextId = setSessionActiveTask(repoRoot, taskName, "malformed-workflow-session");

    const result = runPreToolUseHook(
      repoRoot,
      {
        cwd: repoRoot,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the requested fix.",
        },
      },
      {
        CLAUDE_PROJECT_DIR: repoRoot,
        TRELLIS_CONTEXT_ID: contextId,
      },
    );

    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
      "Task workflow must be a JSON object",
    );
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
      ".trellis",
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

  it("reports planning drift and asks for explicit main-workspace overwrite when the populated worktree is git-clean", () => {
    setupMainRepo(repoRoot, taskName, "main planning\n");
    setupManagedWorktreeRepo(worktreeRoot, taskName, "main planning\n");
    fs.mkdirSync(path.join(worktreeRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(worktreeRoot, "src", "index.ts"), "export const clean = true;\n");
    commitRepoState(worktreeRoot, "init worktree");
    fs.writeFileSync(
      path.join(repoRoot, ".trellis", "tasks", taskName, "prd.md"),
      "main planning updated\n",
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
    expect(context).not.toContain("Do NOT auto-overwrite: this worktree has local code changes.");
    expect(context).toContain("`.backup-`");
    expect(context).toContain("inherit the original task's planning context");
  });

  it("blocks auto-overwrite when the populated worktree has local code changes", () => {
    setupMainRepo(repoRoot, taskName, "main planning\n");
    setupManagedWorktreeRepo(worktreeRoot, taskName, "main planning\n");
    fs.mkdirSync(path.join(worktreeRoot, "src"), { recursive: true });
    const sourceFile = path.join(worktreeRoot, "src", "index.ts");
    fs.writeFileSync(sourceFile, "export const clean = true;\n");
    commitRepoState(worktreeRoot, "init worktree");
    fs.writeFileSync(sourceFile, "export const clean = false;\n");
    fs.writeFileSync(
      path.join(repoRoot, ".trellis", "tasks", taskName, "prd.md"),
      "main planning updated\n",
    );

    const raw = runSessionStart(worktreeRoot);
    const parsed = JSON.parse(raw) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext ?? "";

    expect(context).toContain("Planning drift detected between main workspace and worktree");
    expect(context).toContain(
      "Do NOT auto-overwrite: this worktree has local code changes.",
    );
    expect(context).not.toContain(
      "已检测到主工作区的某个任务的prd.md/planning与worktree不一致，是否执行 主工作区覆盖worktree 的操作？",
    );
  });
});
