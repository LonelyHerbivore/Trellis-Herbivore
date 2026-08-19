import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);

interface PythonCommand {
  command: string;
  args: string[];
}

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
      // Try the next platform-supported interpreter command.
    }
  }
  return null;
}

const PYTHON = resolvePython();

function setupRepo(tmp: string): void {
  const trellisDir = path.join(tmp, ".trellis");
  fs.mkdirSync(trellisDir, { recursive: true });
  fs.writeFileSync(path.join(trellisDir, ".developer"), "name=test\n");
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(trellisDir, "scripts"), {
    recursive: true,
  });
}

function runTask(repo: string, ...args: string[]) {
  if (!PYTHON) {
    throw new Error("Python is unavailable");
  }
  return spawnSync(PYTHON.command, [...PYTHON.args, ".trellis/scripts/task.py", ...args], {
    cwd: repo,
    encoding: "utf-8",
  });
}

function explicitWorkflow() {
  return {
    contract: "explicit-selection-v1",
    host: "codex",
    execution_mode: "main-session",
    worktree_mode: "current-checkout",
    development_flow: "default",
    review_gates: {
      enabled: ["spec-review"],
      disabled: ["code-review", "code-architecture-review", "merge-review"],
      runs: {
        "spec-review": {
          status: "pending",
          attempts: 0,
          report_path: null,
        },
      },
    },
  };
}

describe.skipIf(!PYTHON)("task.py workflow-state contract", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-workflow-state-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a new task with an explicit unselected workflow state", () => {
    const created = runTask(tmp, "create", "Workflow state", "--slug", "workflow-state");
    expect(created.status).toBe(0);

    const tasksDir = path.join(tmp, ".trellis", "tasks");
    const taskDirName = fs
      .readdirSync(tasksDir)
      .find((entry) => entry.endsWith("-workflow-state"));
    expect(taskDirName).toBeDefined();
    const taskDir = path.join(tasksDir, taskDirName as string);
    const taskJson = JSON.parse(
      fs.readFileSync(path.join(taskDir, "task.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(taskJson.workflow).toEqual({ selection_status: "unselected" });

    const validation = runTask(tmp, "validate", `.trellis/tasks/${taskDirName}`);
    expect(validation.status).toBe(0);
    expect(validation.stdout).toContain("workflow selection is unselected");
  });

  it("accepts a complete legacy task but rejects an incomplete one", () => {
    const created = runTask(tmp, "create", "Legacy task", "--slug", "legacy");
    expect(created.status).toBe(0);

    const tasksDir = path.join(tmp, ".trellis", "tasks");
    const taskDirName = fs
      .readdirSync(tasksDir)
      .find((entry) => entry.endsWith("-legacy"));
    expect(taskDirName).toBeDefined();
    const taskDir = path.join(tasksDir, taskDirName as string);
    const legacyTask = JSON.parse(
      fs.readFileSync(path.join(taskDir, "task.json"), "utf-8"),
    ) as Record<string, unknown>;
    delete legacyTask.workflow;
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify(legacyTask) + "\n",
    );

    const validation = runTask(tmp, "validate", `.trellis/tasks/${taskDirName}`);
    expect(validation.status).toBe(0);
    expect(validation.stdout).toContain("legacy workflow accepted");

    delete legacyTask.assignee;
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify(legacyTask) + "\n",
    );

    const invalid = runTask(tmp, "validate", `.trellis/tasks/${taskDirName}`);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain("task.assignee is required");
  });

  it("validates a complete explicit selection and rejects invalid gate state", () => {
    const created = runTask(tmp, "create", "Explicit task", "--slug", "explicit");
    expect(created.status).toBe(0);

    const tasksDir = path.join(tmp, ".trellis", "tasks");
    const taskDirName = fs
      .readdirSync(tasksDir)
      .find((entry) => entry.endsWith("-explicit"));
    expect(taskDirName).toBeDefined();
    const taskDir = path.join(tasksDir, taskDirName as string);
    const validTask = JSON.parse(
      fs.readFileSync(path.join(taskDir, "task.json"), "utf-8"),
    ) as Record<string, unknown>;
    const workflow = explicitWorkflow();
    validTask.worktree_path = "D:/repo";
    validTask.workflow = workflow;
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify(validTask) + "\n",
    );

    const valid = runTask(tmp, "validate", `.trellis/tasks/${taskDirName}`);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("explicit workflow selection is valid");

    workflow.review_gates.runs["spec-review"].attempts = -1;
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify(validTask) + "\n",
    );

    const invalid = runTask(tmp, "validate", `.trellis/tasks/${taskDirName}`);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain("attempts must be a non-negative integer");
  });
});
