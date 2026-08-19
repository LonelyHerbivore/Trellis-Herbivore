/**
 * Canonical task.json shape — single source of truth for Trellis tasks.
 *
 * The runtime Python writer is `.trellis/scripts/common/task_store.py`
 * (`cmd_create`). The 24 required legacy fields and their field order below
 * mirror that writer exactly. New records additionally carry an optional,
 * versioned `workflow` state without making historical task.json files
 * unreadable.
 *
 * Downstream consumers (CLI bootstrap, migration tooling, external Node
 * services) should depend on this type instead of redefining their own
 * task.json shape.
 */
export const WORKFLOW_REVIEW_GATES = [
  "spec-review",
  "code-review",
  "code-architecture-review",
  "merge-review",
] as const;

export type WorkflowReviewGate = (typeof WORKFLOW_REVIEW_GATES)[number];

export type WorkflowGateStatus = "pending" | "PASS" | "FAIL" | "skipped";

export interface WorkflowGateRun {
  status: WorkflowGateStatus;
  attempts: number;
  report_path: string | null;
}

export interface WorkflowReviewGateSelection {
  enabled: WorkflowReviewGate[];
  disabled: WorkflowReviewGate[];
  runs: Partial<Record<WorkflowReviewGate, WorkflowGateRun>>;
}

/** Initial state for tasks whose development strategy is not selected yet. */
export interface UnselectedTaskWorkflow {
  selection_status: "unselected";
}

/** Fully selected, versioned workflow contract. */
export interface ExplicitTaskWorkflow {
  contract: "explicit-selection-v1";
  host: "claude" | "codex";
  execution_mode: "main-session" | "subagent";
  worktree_mode: "current-checkout" | "new-worktree" | "existing-worktree";
  development_flow: "default" | "tdd";
  review_gates: WorkflowReviewGateSelection;
}

export type TrellisTaskWorkflow =
  | UnselectedTaskWorkflow
  | ExplicitTaskWorkflow;

export interface TrellisTaskRecord {
  id: string;
  name: string;
  title: string;
  description: string;
  status: string;
  dev_type: string | null;
  scope: string | null;
  package: string | null;
  priority: string;
  creator: string;
  assignee: string;
  createdAt: string;
  completedAt: string | null;
  branch: string | null;
  base_branch: string | null;
  worktree_path: string | null;
  commit: string | null;
  pr_url: string | null;
  subtasks: string[];
  children: string[];
  parent: string | null;
  relatedFiles: string[];
  notes: string;
  meta: Record<string, unknown>;
  /** Missing from historical records; absent means legacy workflow semantics. */
  workflow?: TrellisTaskWorkflow;
}

/**
 * Required legacy task field order — matches the original 24-field
 * `task_store.py::cmd_create` layout. `workflow`, when present, is written
 * immediately after these fields so legacy records retain their shape.
 */
export const TASK_RECORD_FIELD_ORDER = [
  "id",
  "name",
  "title",
  "description",
  "status",
  "dev_type",
  "scope",
  "package",
  "priority",
  "creator",
  "assignee",
  "createdAt",
  "completedAt",
  "branch",
  "base_branch",
  "worktree_path",
  "commit",
  "pr_url",
  "subtasks",
  "children",
  "parent",
  "relatedFiles",
  "notes",
  "meta",
] as const satisfies readonly (keyof TrellisTaskRecord)[];

export type TaskRecordField = (typeof TASK_RECORD_FIELD_ORDER)[number];

const STRING_FIELDS: ReadonlySet<TaskRecordField> = new Set([
  "id",
  "name",
  "title",
  "description",
  "status",
  "priority",
  "creator",
  "assignee",
  "createdAt",
  "notes",
]);

const NULLABLE_STRING_FIELDS: ReadonlySet<TaskRecordField> = new Set([
  "dev_type",
  "scope",
  "package",
  "completedAt",
  "branch",
  "base_branch",
  "worktree_path",
  "commit",
  "pr_url",
  "parent",
]);

const STRING_ARRAY_FIELDS: ReadonlySet<TaskRecordField> = new Set([
  "subtasks",
  "children",
  "relatedFiles",
]);

/**
 * Lightweight runtime schema for {@link TrellisTaskRecord}. Zero-dep on
 * purpose — `taskRecordSchema.parse(input)` returns a canonicalized
 * record, throwing on shape violations; `taskRecordSchema.safeParse`
 * returns a result discriminated by `success`.
 *
 * The 24 legacy fields are required; older partial records are rejected rather
 * than backfilled with defaults. `workflow` is the sole optional recognized
 * field: its absence represents a legacy task and is never backfilled on read.
 * Unknown fields on the input are intentionally omitted from this structured
 * output. `writeTaskRecord` preserves unknown fields already present on disk
 * by merging canonical updates over the existing JSON object.
 */
export const taskRecordSchema = {
  parse(input: unknown): TrellisTaskRecord {
    return parseTaskRecord(input);
  },
  safeParse(
    input: unknown,
  ):
    | { success: true; data: TrellisTaskRecord }
    | { success: false; error: Error } {
    try {
      return { success: true, data: parseTaskRecord(input) };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  },
} as const;

function parseTaskRecord(input: unknown): TrellisTaskRecord {
  if (!isPlainObject(input)) {
    throw new Error("task record must be a JSON object");
  }
  const out = emptyTaskRecord();
  const inputBag = input as Record<string, unknown>;
  for (const field of TASK_RECORD_FIELD_ORDER) {
    if (!(field in input)) {
      throw new Error(`task.${field} is required`);
    }
    const value = inputBag[field];
    assignField(out, field, value);
  }
  if ("workflow" in inputBag) {
    out.workflow = parseTaskWorkflow(inputBag.workflow, out.worktree_path);
  } else {
    // A missing workflow field is an intentional legacy compatibility state.
    delete out.workflow;
  }
  return out;
}

function assignField(
  record: TrellisTaskRecord,
  field: TaskRecordField,
  value: unknown,
): void {
  const bag = record as unknown as Record<string, unknown>;
  if (STRING_FIELDS.has(field)) {
    if (typeof value !== "string") {
      throw new Error(`task.${field} must be a string`);
    }
    bag[field] = value;
    return;
  }
  if (NULLABLE_STRING_FIELDS.has(field)) {
    if (value !== null && typeof value !== "string") {
      throw new Error(`task.${field} must be a string or null`);
    }
    bag[field] = value;
    return;
  }
  if (STRING_ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new Error(`task.${field} must be an array of strings`);
    }
    bag[field] = [...value];
    return;
  }
  if (field === "meta") {
    if (!isPlainObject(value)) {
      throw new Error("task.meta must be a JSON object");
    }
    record.meta = cloneJsonObject(value, "task.meta");
    return;
  }
  // Should be unreachable given the field sets cover every canonical field.
  /* c8 ignore next */
  throw new Error(`unknown canonical task field: ${field}`);
}

/**
 * Produce a fully-populated canonical-shape {@link TrellisTaskRecord}.
 *
 * All 24 legacy fields are present in canonical order. New records also carry
 * an unselected workflow state. `overrides` shallow-merges over the defaults —
 * callers supply per-task values (id, name, title, assignee, createdAt, etc.)
 * and leave null-default fields untouched unless they have a real value.
 */
export function emptyTaskRecord(
  overrides: Partial<TrellisTaskRecord> = {},
): TrellisTaskRecord {
  const today = new Date().toISOString().split("T")[0] ?? "";
  const base: TrellisTaskRecord = {
    id: "",
    name: "",
    title: "",
    description: "",
    status: "planning",
    dev_type: null,
    scope: null,
    package: null,
    priority: "P2",
    creator: "",
    assignee: "",
    createdAt: today,
    completedAt: null,
    branch: null,
    base_branch: null,
    worktree_path: null,
    commit: null,
    pr_url: null,
    subtasks: [],
    children: [],
    parent: null,
    relatedFiles: [],
    notes: "",
    meta: {},
    workflow: { selection_status: "unselected" },
  };
  const record: TrellisTaskRecord = { ...base, ...overrides };
  if (overrides.subtasks !== undefined) {
    record.subtasks = [...overrides.subtasks];
  }
  if (overrides.children !== undefined) {
    record.children = [...overrides.children];
  }
  if (overrides.relatedFiles !== undefined) {
    record.relatedFiles = [...overrides.relatedFiles];
  }
  if (overrides.meta !== undefined) {
    record.meta = cloneJsonObject(overrides.meta, "task.meta");
  }
  if (
    Object.prototype.hasOwnProperty.call(overrides, "workflow") &&
    overrides.workflow === undefined
  ) {
    delete record.workflow;
  } else if (record.workflow !== undefined) {
    record.workflow = parseTaskWorkflow(record.workflow, record.worktree_path);
  }
  return record;
}

/**
 * Parse and normalize the optional, versioned workflow state stored beside a
 * task's legacy fields. The real worktree directory remains task.worktree_path;
 * this state only records which worktree mode was selected.
 */
export function parseTaskWorkflow(
  value: unknown,
  worktreePath: string | null,
): TrellisTaskWorkflow {
  if (!isPlainObject(value)) {
    throw new Error("task.workflow must be a JSON object");
  }

  if ("selection_status" in value) {
    assertExactKeys(value, ["selection_status"], "task.workflow");
    if (value.selection_status !== "unselected") {
      throw new Error("task.workflow.selection_status must be unselected");
    }
    return { selection_status: "unselected" };
  }

  assertExactKeys(
    value,
    [
      "contract",
      "host",
      "execution_mode",
      "worktree_mode",
      "development_flow",
      "review_gates",
    ],
    "task.workflow",
  );

  if (value.contract !== "explicit-selection-v1") {
    throw new Error("task.workflow.contract must be explicit-selection-v1");
  }

  const host = parseStringEnum(value.host, ["claude", "codex"], "task.workflow.host");
  const executionMode = parseStringEnum(
    value.execution_mode,
    ["main-session", "subagent"],
    "task.workflow.execution_mode",
  );
  const worktreeMode = parseStringEnum(
    value.worktree_mode,
    ["current-checkout", "new-worktree", "existing-worktree"],
    "task.workflow.worktree_mode",
  );
  const developmentFlow = parseStringEnum(
    value.development_flow,
    ["default", "tdd"],
    "task.workflow.development_flow",
  );

  if (typeof worktreePath !== "string" || worktreePath.trim() === "") {
    throw new Error(
      `task.workflow.worktree_mode ${worktreeMode} requires task.worktree_path to be a non-empty string`,
    );
  }

  return {
    contract: "explicit-selection-v1",
    host,
    execution_mode: executionMode,
    worktree_mode: worktreeMode,
    development_flow: developmentFlow,
    review_gates: parseWorkflowReviewGates(value.review_gates),
  };
}

function parseWorkflowReviewGates(value: unknown): WorkflowReviewGateSelection {
  const field = "task.workflow.review_gates";
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  assertExactKeys(value, ["enabled", "disabled", "runs"], field);

  const enabled = parseWorkflowGateList(value.enabled, `${field}.enabled`);
  const disabled = parseWorkflowGateList(value.disabled, `${field}.disabled`);
  const selection = [...enabled, ...disabled];
  if (
    selection.length !== WORKFLOW_REVIEW_GATES.length ||
    new Set(selection).size !== WORKFLOW_REVIEW_GATES.length ||
    WORKFLOW_REVIEW_GATES.some((gate) => !selection.includes(gate))
  ) {
    throw new Error(
      `${field}.enabled and ${field}.disabled must partition every workflow review gate exactly once`,
    );
  }

  if (!isPlainObject(value.runs)) {
    throw new Error(`${field}.runs must be a JSON object`);
  }
  const runsValue = value.runs;
  const runKeys = Object.keys(runsValue);
  if (
    runKeys.length !== enabled.length ||
    !enabled.every((gate) => gate in runsValue) ||
    runKeys.some((gate) => !isWorkflowReviewGate(gate))
  ) {
    throw new Error(`${field}.runs must contain exactly the enabled review gates`);
  }

  const runs: Partial<Record<WorkflowReviewGate, WorkflowGateRun>> = {};
  for (const gate of enabled) {
    runs[gate] = parseWorkflowGateRun(runsValue[gate], `${field}.runs.${gate}`);
  }
  return { enabled, disabled, runs };
}

function parseWorkflowGateList(
  value: unknown,
  field: string,
): WorkflowReviewGate[] {
  if (!Array.isArray(value) || value.some((gate) => typeof gate !== "string")) {
    throw new Error(`${field} must be an array of workflow review gates`);
  }
  const gates: WorkflowReviewGate[] = [];
  for (const gate of value) {
    if (!isWorkflowReviewGate(gate)) {
      throw new Error(`${field} contains an unknown workflow review gate: ${gate}`);
    }
    if (gates.includes(gate)) {
      throw new Error(`${field} must not contain duplicate workflow review gates`);
    }
    gates.push(gate);
  }
  return gates;
}

function parseWorkflowGateRun(value: unknown, field: string): WorkflowGateRun {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  assertExactKeys(value, ["status", "attempts", "report_path"], field);

  const status = parseStringEnum(
    value.status,
    ["pending", "PASS", "FAIL", "skipped"],
    `${field}.status`,
  );
  const attempts = value.attempts;
  if (!Number.isInteger(attempts) || typeof attempts !== "number" || attempts < 0) {
    throw new Error(`${field}.attempts must be a non-negative integer`);
  }
  if (
    value.report_path !== null &&
    (typeof value.report_path !== "string" ||
      !isTaskRelativeReportPath(value.report_path))
  ) {
    throw new Error(`${field}.report_path must be a task-relative path or null`);
  }

  return {
    status,
    attempts,
    report_path: value.report_path,
  };
}

function parseStringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function isWorkflowReviewGate(value: string): value is WorkflowReviewGate {
  return (WORKFLOW_REVIEW_GATES as readonly string[]).includes(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key)) ||
    expected.some((key) => !(key in value))
  ) {
    throw new Error(`${field} must contain exactly: ${expected.join(", ")}`);
  }
}

function isTaskRelativeReportPath(value: string): boolean {
  if (
    value.trim() === "" ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    return false;
  }
  return value
    .split(/[\\/]/)
    .every((part) => part !== "" && part !== "." && part !== "..");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function cloneJsonObject(
  value: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = cloneJsonValue(child, `${path}.${key}`);
  }
  return out;
}

function cloneJsonValue(value: unknown, path: string): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be a finite JSON number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    return cloneJsonObject(value, path);
  }
  throw new Error(`${path} must contain only JSON values`);
}
