import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPullBasedPrelude } from "../../src/configurators/shared.js";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const SHARED_SESSION_START = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/session-start.py",
);
const SUBAGENT_HOOK = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/inject-subagent-context.py",
);

interface PythonCommand {
  command: string;
  args: string[];
}

interface TaskWorktreeOutput {
  task_dir: string;
  worktree_path: string;
  branch: string;
  base_branch: string;
  mode: string;
}

type WorktreeMode =
  | "current-checkout"
  | "new-worktree"
  | "existing-worktree";

function resolvePython(): PythonCommand | null {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
          { command: "python3", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate.command, [...candidate.args, "--version"], {
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // Try the next supported interpreter command.
    }
  }
  return null;
}

const PYTHON = resolvePython();

function git(repo: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git command failed");
  }
  return result.stdout;
}

function gitResult(repo: string, ...args: string[]) {
  return spawnSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
  });
}

function setupRepo(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Trellis Test");

  const trellis = path.join(repo, ".trellis");
  fs.mkdirSync(trellis, { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(trellis, "scripts"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(trellis, ".developer"), "name=test\n");
  fs.writeFileSync(path.join(trellis, "workflow.md"), "# Workflow\n");
  fs.writeFileSync(path.join(trellis, "config.yaml"), "session_auto_commit: false\n");
  fs.writeFileSync(path.join(trellis, ".gitignore"), ".runtime/\n**/__pycache__/\n**/*.pyc\n");
  fs.mkdirSync(path.join(trellis, "spec", "guides"), { recursive: true });
  fs.writeFileSync(path.join(trellis, "spec", "guides", "index.md"), "# Guides\n");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "initial");
}

function runTask(repo: string, ...args: string[]) {
  if (!PYTHON) {
    throw new Error("Python is unavailable");
  }
  return spawnSync(
    PYTHON.command,
    [...PYTHON.args, ".trellis/scripts/task.py", ...args],
    {
      cwd: repo,
      encoding: "utf-8",
    },
  );
}

function createTask(repo: string, slug: string): string {
  const created = runTask(repo, "create", "Worktree " + slug, "--slug", slug);
  expect(created.status).toBe(0);
  const taskName = fs
    .readdirSync(path.join(repo, ".trellis", "tasks"))
    .find((entry) => entry.endsWith("-" + slug));
  expect(taskName).toBeDefined();
  return taskName as string;
}

function readTask(repo: string, taskName: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(repo, ".trellis", "tasks", taskName, "task.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;
}

function writeTask(
  repo: string,
  taskName: string,
  task: Record<string, unknown>,
): void {
  fs.writeFileSync(
    path.join(repo, ".trellis", "tasks", taskName, "task.json"),
    JSON.stringify(task, null, 2) + "\n",
  );
}

function setWorktreeSelection(
  repo: string,
  taskName: string,
  mode: WorktreeMode,
  worktreePath: string,
  branch: string | null = null,
): void {
  const task = readTask(repo, taskName);
  task.workflow = {
    contract: "explicit-selection-v1",
    host: "codex",
    execution_mode: "subagent",
    worktree_mode: mode,
    development_flow: "default",
    review_gates: {
      enabled: [],
      disabled: [
        "spec-review",
        "code-review",
        "code-architecture-review",
        "merge-review",
      ],
      runs: {},
    },
  };
  task.worktree_path = worktreePath;
  task.branch = branch;
  task.base_branch = "main";
  writeTask(repo, taskName, task);
}

function taskPath(repo: string, taskName: string): string {
  return path.join(".trellis", "tasks", taskName);
}

function taskOutput(
  repo: string,
  command: string,
  taskName: string,
  ...args: string[]
): TaskWorktreeOutput {
  const result = runTask(repo, command, taskPath(repo, taskName), ...args, "--json");
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return JSON.parse(result.stdout) as TaskWorktreeOutput;
}

function commitTaskRecord(repo: string): void {
  git(repo, "add", ".trellis/tasks");
  git(repo, "commit", "-q", "-m", "record task worktree");
}

function setActiveTask(repo: string, taskName: string, contextId: string): void {
  const sessions = path.join(repo, ".trellis", ".runtime", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(
    path.join(sessions, contextId + ".json"),
    JSON.stringify({ current_task: taskPath(repo, taskName) }) + "\n",
  );
}

function runCodexRecovery(
  repo: string,
  activeTask: string,
  actualWorktree: string,
  cwd: string,
) {
  if (!PYTHON) {
    throw new Error("Python is unavailable");
  }
  const script = [
    "import json, sys",
    "from pathlib import Path",
    "repo = Path(sys.argv[1]).resolve()",
    "active_task = Path(sys.argv[2])",
    "actual_worktree = Path(sys.argv[3]).resolve()",
    "task_json = active_task if active_task.is_absolute() else repo / active_task",
    "data = json.loads(task_json.read_text(encoding='utf-8'))",
    "recorded = Path(data['worktree_path']).expanduser().resolve()",
    "if recorded != actual_worktree:",
    "    raise SystemExit(f'dispatch path mismatch: {recorded} != {actual_worktree}')",
    "sys.path.insert(0, str(repo / '.trellis' / 'scripts'))",
    "from common.worktree_sync import resolve_task_worktree",
    "resolved = resolve_task_worktree(repo, task_json.parent.name, data)",
    "if resolved.root != actual_worktree:",
    "    raise SystemExit(f'resolved path mismatch: {resolved.root} != {actual_worktree}')",
    "print(resolved.root)",
  ].join("\n");
  return spawnSync(
    PYTHON.command,
    [...PYTHON.args, "-c", script, repo, activeTask, actualWorktree],
    { cwd, encoding: "utf-8" },
  );
}

describe.skipIf(!PYTHON)("task.py task worktree runtime", () => {
  let tmp: string;
  let repo: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-worktree-"));
    repo = path.join(tmp, "repo");
    setupRepo(repo);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("#1 claims and resolves the current checkout", () => {
    const taskName = createTask(repo, "current");
    setWorktreeSelection(repo, taskName, "current-checkout", repo);

    const claimed = taskOutput(repo, "claim-worktree", taskName);
    expect(path.resolve(claimed.worktree_path)).toBe(path.resolve(repo));
    expect(claimed.branch).toBe("main");
    expect(claimed.base_branch).toBe("main");
    expect(claimed.mode).toBe("current-checkout");

    const resolved = taskOutput(repo, "resolve-worktree", taskName);
    expect(resolved).toEqual(claimed);
  });

  it("#2 creates one new managed worktree and retries idempotently", () => {
    const taskName = createTask(repo, "new");
    const expected = path.join(
      repo,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
    setWorktreeSelection(repo, taskName, "new-worktree", expected);

    const first = taskOutput(repo, "claim-worktree", taskName);
    expect(path.resolve(first.worktree_path)).toBe(path.resolve(expected));
    expect(fs.existsSync(expected)).toBe(true);
    expect(first.branch).toBe("task/" + taskName);

    const second = taskOutput(repo, "claim-worktree", taskName);
    expect(second).toEqual(first);

    const entries = git(repo, "worktree", "list", "--porcelain")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "));
    expect(entries).toHaveLength(2);
  });

  it("#3a checks task.json writability before creating a worktree", () => {
    const taskName = createTask(repo, "write-probe");
    const expected = path.join(
      repo,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
    setWorktreeSelection(repo, taskName, "new-worktree", expected);
    const taskJson = path.join(repo, ".trellis", "tasks", taskName, "task.json");
    fs.chmodSync(taskJson, 0o444);

    const blocked = runTask(repo, "claim-worktree", taskPath(repo, taskName));
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("task.json is not writable");
    expect(fs.existsSync(expected)).toBe(false);

    fs.chmodSync(taskJson, 0o644);
    const claimed = taskOutput(repo, "claim-worktree", taskName);
    expect(path.resolve(claimed.worktree_path)).toBe(path.resolve(expected));
  });

  it("#3 accepts an existing legacy .claude worktree record", () => {
    const taskName = createTask(repo, "legacy");
    const legacyWorktree = path.join(repo, ".claude", "worktree");
    git(repo, "worktree", "add", "-q", "-b", "legacy-task", legacyWorktree, "main");

    const task = readTask(repo, taskName);
    delete task.workflow;
    task.worktree_path = legacyWorktree;
    task.branch = "legacy-task";
    task.base_branch = "main";
    writeTask(repo, taskName, task);

    const claimed = taskOutput(repo, "claim-worktree", taskName);
    expect(path.resolve(claimed.worktree_path)).toBe(path.resolve(legacyWorktree));
    expect(claimed.mode).toBe("existing-worktree");
    expect(taskOutput(repo, "resolve-worktree", taskName)).toEqual(claimed);
  });

  it("#4 rejects missing, normal, foreign, conflicting, and branch-mismatched paths", () => {
    const owner = createTask(repo, "owner");
    const ownerPath = path.join(
      repo,
      ".trellis",
      "trellis-worktrees",
      owner,
    );
    setWorktreeSelection(repo, owner, "new-worktree", ownerPath);
    taskOutput(repo, "claim-worktree", owner);

    const conflict = createTask(repo, "conflict");
    setWorktreeSelection(repo, conflict, "existing-worktree", ownerPath, "task/" + owner);
    const conflictResult = runTask(
      repo,
      "claim-worktree",
      taskPath(repo, conflict),
    );
    expect(conflictResult.status).toBe(1);
    expect(conflictResult.stdout).toContain("already claimed");

    const missing = createTask(repo, "missing");
    setWorktreeSelection(
      repo,
      missing,
      "existing-worktree",
      path.join(repo, "deleted-worktree"),
      "missing",
    );
    const missingResult = runTask(
      repo,
      "resolve-worktree",
      taskPath(repo, missing),
    );
    expect(missingResult.status).toBe(1);
    expect(missingResult.stdout).toContain("does not exist");

    const plainDir = path.join(repo, "plain-directory");
    fs.mkdirSync(plainDir);
    const plain = createTask(repo, "plain");
    setWorktreeSelection(repo, plain, "existing-worktree", plainDir, "plain");
    const plainResult = runTask(repo, "claim-worktree", taskPath(repo, plain));
    expect(plainResult.status).toBe(1);
    expect(plainResult.stdout).toContain("not registered by Git");

    const foreign = path.join(tmp, "foreign");
    fs.mkdirSync(foreign);
    git(foreign, "init", "-q", "-b", "main");
    const foreignTask = createTask(repo, "foreign");
    setWorktreeSelection(repo, foreignTask, "existing-worktree", foreign, "main");
    const foreignResult = runTask(
      repo,
      "claim-worktree",
      taskPath(repo, foreignTask),
    );
    expect(foreignResult.status).toBe(1);
    expect(foreignResult.stdout).toContain("another Git repository");

    const mismatch = readTask(repo, owner);
    mismatch.branch = "not-the-owner-branch";
    writeTask(repo, owner, mismatch);
    const mismatchResult = runTask(
      repo,
      "resolve-worktree",
      taskPath(repo, owner),
    );
    expect(mismatchResult.status).toBe(1);
    expect(mismatchResult.stdout).toContain("branch mismatch");
  });

  it("#5b anchors relative task worktree paths to the primary checkout", () => {
    const taskName = createTask(repo, "relative");
    const relativePath = path.join(".claude", "relative-worktree");
    const actualWorktree = path.join(repo, relativePath);
    setWorktreeSelection(
      repo,
      taskName,
      "existing-worktree",
      relativePath,
      "relative-task",
    );
    git(repo, "worktree", "add", "-q", "-b", "relative-task", actualWorktree, "main");
    commitTaskRecord(repo);

    const caller = path.join(tmp, "relative-caller");
    git(repo, "worktree", "add", "-q", "-b", "relative-caller", caller, "main");
    const resolved = taskOutput(caller, "resolve-worktree", taskName);

    expect(path.resolve(resolved.worktree_path)).toBe(path.resolve(actualWorktree));
    expect(resolved.mode).toBe("existing-worktree");
  });

  it("#5 refuses nested new-worktree creation from a linked checkout", () => {
    const taskName = createTask(repo, "nested");
    const planned = path.join(
      repo,
      ".trellis",
      "trellis-worktrees",
      taskName,
    );
    setWorktreeSelection(repo, taskName, "new-worktree", planned);
    commitTaskRecord(repo);

    const linked = path.join(tmp, "linked");
    git(repo, "worktree", "add", "-q", "-b", "linked-checkout", linked, "main");
    const result = runTask(linked, "claim-worktree", taskPath(linked, taskName));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Cannot create a nested Trellis worktree");
  });

  it("#5a writes linked checkout claims to the primary task record", () => {
    const taskName = createTask(repo, "linked-claim");
    const linked = path.join(tmp, "linked-claim");
    setWorktreeSelection(repo, taskName, "existing-worktree", linked);
    commitTaskRecord(repo);
    git(repo, "worktree", "add", "-q", "-b", "linked-claim", linked, "main");

    const result = runTask(linked, "claim-worktree", taskPath(linked, taskName), "--json");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const primaryTask = readTask(repo, taskName);
    const linkedTask = readTask(linked, taskName);
    expect(primaryTask.branch).toBe("linked-claim");
    expect(linkedTask.branch).toBeNull();
  });

  it("#5c fails closed when the primary task record is malformed", () => {
    const taskName = createTask(repo, "malformed-primary");
    setWorktreeSelection(repo, taskName, "current-checkout", repo, "main");
    commitTaskRecord(repo);

    const linked = path.join(tmp, "malformed-linked");
    git(repo, "worktree", "add", "-q", "-b", "malformed-linked", linked, "main");
    fs.writeFileSync(
      path.join(repo, ".trellis", "tasks", taskName, "task.json"),
      "{ malformed\n",
    );

    const result = runTask(linked, "resolve-worktree", taskPath(linked, taskName));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("invalid or unreadable");
  });

  it("#5d denies an absolute task ref from another Git repository", () => {
    const foreignRepo = path.join(tmp, "foreign-repo");
    setupRepo(foreignRepo);
    const foreignTask = createTask(foreignRepo, "foreign-dispatch");
    const foreignTaskPath = path.join(
      foreignRepo,
      ".trellis",
      "tasks",
      foreignTask,
    );
    const sessions = path.join(repo, ".trellis", ".runtime", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, "foreign-dispatch-session.json"),
      JSON.stringify({ current_task: foreignTaskPath }) + "\n",
    );

    const result = spawnSync(PYTHON.command, [...PYTHON.args, SUBAGENT_HOOK], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        cwd: repo,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the task.",
        },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        TRELLIS_CONTEXT_ID: "foreign-dispatch-session",
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const hookResult = JSON.parse(result.stdout) as {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
    expect(hookResult.permissionDecision).toBe("deny");
    expect(hookResult.permissionDecisionReason).toContain("another Git repository");
  });

  it("#5d2 rejects a same-repo path that is not the task directory", () => {
    const taskName = createTask(repo, "identity");
    setWorktreeSelection(repo, taskName, "current-checkout", repo, "main");
    const fakeTaskPath = path.join(repo, "src", taskName);
    fs.mkdirSync(fakeTaskPath, { recursive: true });
    const sessions = path.join(repo, ".trellis", ".runtime", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, "same-repo-identity-session.json"),
      JSON.stringify({ current_task: fakeTaskPath }) + "\n",
    );

    const result = spawnSync(PYTHON.command, [...PYTHON.args, SUBAGENT_HOOK], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        cwd: repo,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the task.",
        },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        TRELLIS_CONTEXT_ID: "same-repo-identity-session",
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const hookResult = JSON.parse(result.stdout) as {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
    expect(hookResult.permissionDecision).toBe("deny");
    expect(hookResult.permissionDecisionReason).toContain(".trellis/tasks");
  });

  it("#5d3 rejects nested hook task paths instead of basename matching", () => {
    const taskName = createTask(repo, "hook-nested-ref");
    setWorktreeSelection(repo, taskName, "current-checkout", repo, "main");
    const fakeTaskPath = path.join(repo, ".trellis", "tasks", "fake", taskName);
    fs.mkdirSync(fakeTaskPath, { recursive: true });
    fs.copyFileSync(
      path.join(repo, ".trellis", "tasks", taskName, "task.json"),
      path.join(fakeTaskPath, "task.json"),
    );
    const sessions = path.join(repo, ".trellis", ".runtime", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, "hook-nested-ref-session.json"),
      JSON.stringify({ current_task: fakeTaskPath }) + "\n",
    );

    const result = spawnSync(PYTHON.command, [...PYTHON.args, SUBAGENT_HOOK], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        cwd: repo,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the task.",
        },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        TRELLIS_CONTEXT_ID: "hook-nested-ref-session",
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const hookResult = JSON.parse(result.stdout) as {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
    expect(hookResult.permissionDecision).toBe("deny");
    expect(hookResult.permissionDecisionReason).toContain("direct .trellis/tasks child");
  });

  it("#5e rejects foreign absolute task paths in task.py worktree commands", () => {
    const localTask = createTask(repo, "same-ref");
    setWorktreeSelection(repo, localTask, "current-checkout", repo, "main");
    const foreignRepo = path.join(tmp, "foreign-cli-repo");
    setupRepo(foreignRepo);
    const foreignTask = createTask(foreignRepo, "same-ref");
    setWorktreeSelection(foreignRepo, foreignTask, "current-checkout", foreignRepo, "main");

    const foreignTaskPath = path.join(
      foreignRepo,
      ".trellis",
      "tasks",
      foreignTask,
    );
    const result = runTask(repo, "resolve-worktree", foreignTaskPath, "--json");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("another Git repository");
  });

  it("#5e2 rejects nested non-task paths instead of basename matching", () => {
    const taskName = createTask(repo, "nested-ref");
    setWorktreeSelection(repo, taskName, "current-checkout", repo, "main");
    const fakePath = path.join(repo, ".trellis", "tasks", "fake", taskName);
    fs.mkdirSync(fakePath, { recursive: true });

    const result = runTask(repo, "resolve-worktree", fakePath, "--json");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("existing task directory with task.json");
  });

  it("#5f refuses a linked snapshot when the primary task record is missing", () => {
    const taskName = createTask(repo, "primary-missing");
    setWorktreeSelection(repo, taskName, "current-checkout", repo, "main");
    commitTaskRecord(repo);

    const linked = path.join(tmp, "primary-missing-linked");
    git(repo, "worktree", "add", "-q", "-b", "primary-missing-linked", linked, "main");
    fs.rmSync(path.join(repo, ".trellis", "tasks", taskName, "task.json"));
    expect(fs.existsSync(path.join(linked, ".trellis", "tasks", taskName, "task.json"))).toBe(true);

    const result = runTask(linked, "resolve-worktree", taskPath(linked, taskName));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("task.json not found");
  });

  it("#6 syncs runtime and planning from the recorded custom worktree path", () => {
    const taskName = createTask(repo, "sync");
    const customWorktree = path.join(tmp, "custom-worktree");
    setWorktreeSelection(repo, taskName, "new-worktree", customWorktree);
    const claimed = taskOutput(repo, "claim-worktree", taskName);
    expect(path.resolve(claimed.worktree_path)).toBe(path.resolve(customWorktree));

    const hook = path.join(tmp, "session-start.py");
    fs.copyFileSync(SHARED_SESSION_START, hook);
    const result = spawnSync(PYTHON.command, [...PYTHON.args, hook], {
      cwd: customWorktree,
      encoding: "utf-8",
      input: JSON.stringify({ cwd: customWorktree }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: customWorktree,
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("Actual worktree: " + customWorktree);
    expect(context).toContain("Bootstrapped runtime bundle from main workspace");
    expect(context).toContain(
      "Bootstrapped current task planning snapshot from main workspace",
    );
    expect(
      fs.existsSync(
        path.join(customWorktree, ".trellis", "tasks", taskName, "prd.md"),
      ),
    ).toBe(true);
  });

  it("#7 injects the same task/worktree pair for Claude and Codex dispatch", () => {
    const taskName = createTask(repo, "dispatch");
    const source = path.join(tmp, "dispatch-source");
    setWorktreeSelection(repo, taskName, "new-worktree", source);
    const claimed = taskOutput(repo, "claim-worktree", taskName);
    setActiveTask(repo, taskName, "dispatch-session");

    const result = spawnSync(PYTHON.command, [...PYTHON.args, SUBAGENT_HOOK], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        cwd: repo,
        tool_name: "Agent",
        tool_input: {
          subagent_type: "trellis-implement",
          prompt: "Implement the task.",
          isolation: "worktree",
        },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: repo,
        TRELLIS_CONTEXT_ID: "dispatch-session",
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const hookResult = JSON.parse(result.stdout) as {
      hookSpecificOutput?: {
        updatedInput?: { prompt?: string; isolation?: string };
        additionalContext?: string;
      };
    };
    const prompt = hookResult.hookSpecificOutput?.updatedInput?.prompt ?? "";
    expect(prompt.startsWith(
      "Active task: " + taskPath(repo, taskName) + "\n" +
        "Actual worktree: " + claimed.worktree_path + "\n\n",
    )).toBe(true);
    expect(hookResult.hookSpecificOutput?.updatedInput?.isolation).toBeUndefined();
    expect(hookResult.hookSpecificOutput?.additionalContext).toContain(
      "记录路径冲突",
    );

    const prelude = buildPullBasedPrelude("implement");
    expect(prelude).toContain("Actual worktree: <path>");
    expect(prelude).toContain("task.worktree_path");
    expect(prelude).toContain('fork_turns="none"');

    const taskJson = path.join(repo, ".trellis", "tasks", taskName, "task.json");
    const recovered = runCodexRecovery(
      repo,
      taskJson,
      claimed.worktree_path,
      tmp,
    );
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.stdout.trim()).toBe(path.resolve(claimed.worktree_path));

    const mismatched = runCodexRecovery(
      repo,
      taskJson,
      path.join(tmp, "wrong-worktree"),
      tmp,
    );
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr + mismatched.stdout).toContain(
      "dispatch path mismatch",
    );
  });

  it("#8 merges a clean task branch, reports already merged, and leaves conflicts recoverable", () => {
    const taskName = createTask(repo, "merge");
    const source = path.join(tmp, "merge-source");
    setWorktreeSelection(repo, taskName, "new-worktree", source);
    const claimed = taskOutput(repo, "claim-worktree", taskName);
    commitTaskRecord(repo);

    fs.writeFileSync(path.join(source, "src", "feature.txt"), "feature\n");
    git(source, "add", "src/feature.txt");
    git(source, "commit", "-q", "-m", "feature");

    const merged = runTask(repo, "merge-worktree", taskPath(repo, taskName));
    expect(merged.status, merged.stderr).toBe(0);
    expect(merged.stdout).toContain("Merged '" + claimed.branch + "'");
    expect(fs.readFileSync(path.join(repo, "src", "feature.txt"), "utf-8")).toMatch(
      /^feature\r?\n$/,
    );

    const already = runTask(repo, "merge-worktree", taskPath(repo, taskName));
    expect(already.status).toBe(0);
    expect(already.stdout).toContain("already merged");

    const conflictTask = createTask(repo, "merge-conflict");
    const conflictSource = path.join(tmp, "merge-conflict-source");
    setWorktreeSelection(repo, conflictTask, "new-worktree", conflictSource);
    taskOutput(repo, "claim-worktree", conflictTask);
    commitTaskRecord(repo);

    fs.writeFileSync(path.join(repo, "src", "base.txt"), "main conflict\n");
    git(repo, "add", "src/base.txt");
    git(repo, "commit", "-q", "-m", "main conflict");
    fs.writeFileSync(path.join(conflictSource, "src", "base.txt"), "source conflict\n");
    git(conflictSource, "add", "src/base.txt");
    git(conflictSource, "commit", "-q", "-m", "source conflict");

    const conflicted = runTask(
      repo,
      "merge-worktree",
      taskPath(repo, conflictTask),
    );
    expect(conflicted.status).toBe(1);
    expect(conflicted.stdout).toContain("Merge conflict left in place");
    expect(conflicted.stdout).toContain("merge --abort");
    expect(gitResult(repo, "rev-parse", "--verify", "MERGE_HEAD").status).toBe(0);
    git(repo, "merge", "--abort");
  }, 30_000);

  it("#9 preserves customized runtime files while filling missing bundle and planning files", () => {
    const taskName = createTask(repo, "preserve");
    const source = path.join(tmp, "preserve-source");
    setWorktreeSelection(repo, taskName, "new-worktree", source);
    taskOutput(repo, "claim-worktree", taskName);

    const customScript = path.join(
      source,
      ".trellis",
      "scripts",
      "common",
      "worktree_sync.py",
    );
    const customWorkflow = path.join(source, ".trellis", "workflow.md");
    const missingConfig = path.join(source, ".trellis", "config.yaml");
    const missingPlanning = path.join(
      source,
      ".trellis",
      "tasks",
      taskName,
      "prd.md",
    );
    fs.appendFileSync(customScript, "\n# local runtime customization\n");
    fs.writeFileSync(customWorkflow, "# local workflow customization\n");
    fs.rmSync(missingConfig);
    fs.mkdirSync(path.dirname(missingPlanning), { recursive: true });
    fs.copyFileSync(
      path.join(repo, ".trellis", "tasks", taskName, "task.json"),
      path.join(path.dirname(missingPlanning), "task.json"),
    );

    const syncScript = [
      "import sys",
      "from pathlib import Path",
      "repo = Path(sys.argv[1]).resolve()",
      "worktree = Path(sys.argv[2]).resolve()",
      "task_name = sys.argv[3]",
      "sys.path.insert(0, str(worktree / '.trellis' / 'scripts'))",
      "from common.worktree_sync import sync_runtime_bundle, sync_task_snapshot",
      "print(sync_runtime_bundle(repo, worktree))",
      "print(sync_task_snapshot(repo, worktree, task_name))",
    ].join("\n");
    const result = spawnSync(
      PYTHON.command,
      [...PYTHON.args, "-c", syncScript, repo, source, taskName],
      {
        cwd: source,
        encoding: "utf-8",
      },
    );

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(fs.readFileSync(customScript, "utf-8")).toContain(
      "local runtime customization",
    );
    expect(fs.readFileSync(customWorkflow, "utf-8")).toBe(
      "# local workflow customization\n",
    );
    expect(fs.existsSync(missingConfig)).toBe(true);
    expect(fs.existsSync(missingPlanning)).toBe(true);
  });
});
