import { describe, expect, it } from "vitest";

import {
  TASK_RECORD_FIELD_ORDER,
  WORKFLOW_REVIEW_GATES,
  emptyTaskRecord,
  taskRecordSchema,
} from "../../src/task/index.js";
import type { TrellisTaskWorkflow } from "../../src/task/index.js";

function explicitWorkflow(): TrellisTaskWorkflow {
  return {
    contract: "explicit-selection-v1",
    host: "codex",
    execution_mode: "main-session",
    worktree_mode: "current-checkout",
    development_flow: "default",
    review_gates: {
      enabled: ["spec-review", "code-review"],
      disabled: ["code-architecture-review", "merge-review"],
      runs: {
        "spec-review": {
          status: "PASS",
          attempts: 1,
          report_path: "reports/spec-review.md",
        },
        "code-review": {
          status: "pending",
          attempts: 0,
          report_path: null,
        },
      },
    },
  };
}

describe("emptyTaskRecord", () => {
  it("emits legacy fields in canonical order followed by unselected workflow", () => {
    const record = emptyTaskRecord();
    expect(Object.keys(record)).toEqual([...TASK_RECORD_FIELD_ORDER, "workflow"]);
  });

  it("uses canonical defaults: planning status, P2 priority, today ISO date", () => {
    const record = emptyTaskRecord();
    expect(record.status).toBe("planning");
    expect(record.priority).toBe("P2");
    expect(record.dev_type).toBeNull();
    expect(record.subtasks).toEqual([]);
    expect(record.children).toEqual([]);
    expect(record.relatedFiles).toEqual([]);
    expect(record.meta).toEqual({});
    expect(record.workflow).toEqual({ selection_status: "unselected" });
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shallow-merges overrides on top of defaults", () => {
    const record = emptyTaskRecord({
      id: "demo",
      name: "demo",
      title: "Demo task",
      assignee: "developer",
      package: "core",
    });
    expect(record.id).toBe("demo");
    expect(record.title).toBe("Demo task");
    expect(record.assignee).toBe("developer");
    expect(record.package).toBe("core");
    expect(record.priority).toBe("P2");
  });

  it("copies collection overrides so callers cannot share mutable state", () => {
    const overrides = {
      children: ["child-a"],
      relatedFiles: ["src/demo.ts"],
      subtasks: ["subtask-a"],
      meta: { tracker: "demo", nested: { id: "n1" } },
    };
    const first = emptyTaskRecord(overrides);
    const second = emptyTaskRecord(overrides);

    overrides.children.push("child-b");
    overrides.meta.nested.id = "changed-by-override";
    first.relatedFiles.push("src/changed.ts");
    first.subtasks.push("subtask-b");
    first.meta.tracker = "changed";
    (first.meta.nested as { id: string }).id = "changed-by-first";

    expect(first.children).toEqual(["child-a"]);
    expect(second.relatedFiles).toEqual(["src/demo.ts"]);
    expect(second.subtasks).toEqual(["subtask-a"]);
    expect(second.meta).toEqual({ tracker: "demo", nested: { id: "n1" } });
  });
});

describe("taskRecordSchema", () => {
  it("parses a canonical record", () => {
    const input = emptyTaskRecord({ id: "x", name: "x", title: "X" });
    const parsed = taskRecordSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
  });

  it("reads a 24-field record without workflow as legacy", () => {
    const legacy = { ...emptyTaskRecord({ id: "legacy" }) } as Record<
      string,
      unknown
    >;
    delete legacy.workflow;

    const parsed = taskRecordSchema.parse(legacy);
    expect(parsed.id).toBe("legacy");
    expect(parsed.workflow).toBeUndefined();
    expect("workflow" in parsed).toBe(false);
  });

  it("parses a complete explicit workflow selection", () => {
    const input = emptyTaskRecord({
      id: "selected",
      worktree_path: "D:/repo",
      workflow: explicitWorkflow(),
    });

    const parsed = taskRecordSchema.parse(input);
    expect(parsed.workflow).toEqual(explicitWorkflow());
    expect(parsed.workflow).not.toBe(input.workflow);
  });

  it("rejects non-object inputs", () => {
    expect(() => taskRecordSchema.parse("nope")).toThrow(/must be a JSON object/);
    expect(() => taskRecordSchema.parse(null)).toThrow();
    expect(() => taskRecordSchema.parse([])).toThrow();
  });

  it("rejects wrong field types", () => {
    expect(() =>
      taskRecordSchema.parse({ ...emptyTaskRecord(), title: 42 }),
    ).toThrow(/task.title must be a string/);
    expect(() =>
      taskRecordSchema.parse({ ...emptyTaskRecord(), children: ["ok", 1] }),
    ).toThrow(/task.children must be an array of strings/);
    expect(() =>
      taskRecordSchema.parse({ ...emptyTaskRecord(), meta: [] }),
    ).toThrow(/task.meta must be a JSON object/);
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord(),
        meta: { nested: new Date() },
      }),
    ).toThrow(/task.meta.nested must contain only JSON values/);
  });

  it("rejects records missing canonical fields", () => {
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord(),
        meta: undefined,
      }),
    ).toThrow(/task.meta must be a JSON object/);

    const partial = { ...emptyTaskRecord() } as Record<string, unknown>;
    delete partial.base_branch;
    expect(() => taskRecordSchema.parse(partial)).toThrow(
      /task.base_branch is required/,
    );
  });

  it("rejects incomplete or ambiguous workflow selections", () => {
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord(),
        workflow: { selection_status: "unselected", host: "codex" },
      }),
    ).toThrow(/task.workflow must contain exactly: selection_status/);

    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord({ worktree_path: "D:/repo" }),
        workflow: {
          contract: "explicit-selection-v1",
          execution_mode: "main-session",
          worktree_mode: "current-checkout",
          development_flow: "default",
          review_gates: explicitWorkflow().review_gates,
        },
      }),
    ).toThrow(/task.workflow must contain exactly/);

    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord({ workflow: explicitWorkflow() }),
      }),
    ).toThrow(/requires task.worktree_path to be a non-empty string/);
  });

  it("requires enabled and disabled review gates to form the fixed partition", () => {
    const workflow = explicitWorkflow();
    workflow.review_gates.disabled = ["code-review", "merge-review"];
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord({ worktree_path: "D:/repo" }),
        workflow,
      }),
    ).toThrow(/must partition every workflow review gate exactly once/);

    expect(WORKFLOW_REVIEW_GATES).toEqual([
      "spec-review",
      "code-review",
      "code-architecture-review",
      "merge-review",
    ]);
  });

  it("rejects runs for disabled gates and invalid run details", () => {
    const disabledRun = explicitWorkflow();
    disabledRun.review_gates.runs["merge-review"] = {
      status: "PASS",
      attempts: 1,
      report_path: "reports/merge.md",
    };
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord({ worktree_path: "D:/repo" }),
        workflow: disabledRun,
      }),
    ).toThrow(/runs must contain exactly the enabled review gates/);

    for (const reportPath of ["../report.md", "reports/../report.md", "C:\\report.md"]) {
      const invalidPath = explicitWorkflow();
      invalidPath.review_gates.runs["spec-review"] = {
        status: "FAIL",
        attempts: 2,
        report_path: reportPath,
      };
      expect(() =>
        taskRecordSchema.parse({
          ...emptyTaskRecord({ worktree_path: "D:/repo" }),
          workflow: invalidPath,
        }),
      ).toThrow(/report_path must be a task-relative path or null/);
    }

    const invalidAttempts = explicitWorkflow();
    invalidAttempts.review_gates.runs["spec-review"] = {
      status: "PASS",
      attempts: -1,
      report_path: null,
    };
    expect(() =>
      taskRecordSchema.parse({
        ...emptyTaskRecord({ worktree_path: "D:/repo" }),
        workflow: invalidAttempts,
      }),
    ).toThrow(/attempts must be a non-negative integer/);
  });

  it("allows null for nullable string fields", () => {
    const parsed = taskRecordSchema.parse({
      ...emptyTaskRecord(),
      branch: null,
      worktree_path: null,
      parent: null,
    });
    expect(parsed.branch).toBeNull();
    expect(parsed.worktree_path).toBeNull();
    expect(parsed.parent).toBeNull();
  });

  it("safeParse returns success / error discriminated result", () => {
    const ok = taskRecordSchema.safeParse(emptyTaskRecord());
    expect(ok.success).toBe(true);
    const bad = taskRecordSchema.safeParse({ title: 1 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.message).toMatch(/task.id is required/);
    }
  });

  it("drops unknown fields while retaining the recognized workflow state", () => {
    const parsed = taskRecordSchema.parse({
      ...emptyTaskRecord({
        id: "x",
        worktree_path: "D:/repo",
        workflow: explicitWorkflow(),
      }),
      // @ts-expect-error - simulate older/newer on-disk field
      legacy_field: "keep-me-on-disk",
    });
    expect("legacy_field" in parsed).toBe(false);
    expect(parsed.workflow?.contract).toBe("explicit-selection-v1");
  });
});
