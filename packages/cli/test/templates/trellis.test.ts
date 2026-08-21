import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  WORKFLOW_REVIEW_GATES,
  emptyTaskRecord,
  taskRecordSchema,
} from "trellis-hgl-core/task";
import { getAllAgents as getClaudeAgents } from "../../src/templates/claude/index.js";
import { getAllAgents as getCodexAgents } from "../../src/templates/codex/index.js";
import {
  getCommandTemplates,
  getSkillTemplates,
} from "../../src/templates/common/index.js";
import {
  scriptsInit,
  commonInit,
  commonPaths,
  commonDeveloper,
  commonGitContext,
  commonTaskQueue,
  commonTaskUtils,
  commonActiveTask,
  commonCliAdapter,
  commonWorktreeSync,
  getDeveloperScript,
  initDeveloperScript,
  taskScript,
  getContextScript,
  addSessionScript,
  workflowMdTemplate,
  gitignoreTemplate,
  getAllScripts,
} from "../../src/templates/trellis/index.js";

// =============================================================================
// Template Constants — module-level string exports
// =============================================================================

describe("trellis template constants", () => {
  const allTemplates = {
    scriptsInit,
    commonInit,
    commonPaths,
    commonDeveloper,
    commonGitContext,
    commonTaskQueue,
    commonTaskUtils,
    commonActiveTask,
    commonCliAdapter,
    commonWorktreeSync,
    getDeveloperScript,
    initDeveloperScript,
    taskScript,
    getContextScript,
    addSessionScript,
    workflowMdTemplate,
    gitignoreTemplate,
  };

  function explicitReviewFixture(host: "claude" | "codex") {
    return {
      contract: "explicit-selection-v1",
      host,
      execution_mode: "subagent",
      worktree_mode: "current-checkout",
      development_flow: "default",
      review_gates: {
        enabled: ["merge-review", "code-review", "spec-review"],
        disabled: ["code-architecture-review"],
        runs: {
          "merge-review": { status: "pending", attempts: 0, report_path: null },
          "code-review": { status: "pending", attempts: 0, report_path: null },
          "spec-review": { status: "pending", attempts: 0, report_path: null },
        },
      },
    } as const;
  }

  function taskRecordWithWorkflow(workflow: unknown): Record<string, unknown> {
    return {
      ...emptyTaskRecord(),
      worktree_path: "D:\\actual-worktree",
      workflow,
    };
  }

  function inProgressBreadcrumb(): string {
    const inProgressMatch = /\[workflow-state:in_progress\]([\s\S]*?)\[\/workflow-state:in_progress\]/.exec(
      workflowMdTemplate,
    );
    if (!inProgressMatch) {
      throw new Error("in_progress breadcrumb block must exist in workflow.md");
    }
    return inProgressMatch[1];
  }

  function workflowStateBreadcrumb(status: string): string {
    const match = new RegExp(
      `^\\[workflow-state:${status}\\]\\r?\\n([\\s\\S]*?)^\\[/workflow-state:${status}\\]`,
      "m",
    ).exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`${status} breadcrumb block must exist in workflow.md`);
    }
    return match[1];
  }

  function stepSection(step: string): string {
    const pattern = new RegExp(
      `#### ${step.replace(".", "\\.")}[^\\n]*\\n([\\s\\S]*?)(?=\\n#### |\\n### |$)`,
    );
    const match = pattern.exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`workflow.md step ${step} must exist`);
    }
    return match[1];
  }

  it("all templates are non-empty strings", () => {
    for (const [name, content] of Object.entries(allTemplates)) {
      expect(content.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("Python scripts contain valid Python syntax indicators", () => {
    // scriptsInit (__init__.py) only has docstrings, so use scripts with actual code
    const pyScripts = [
      commonInit,
      commonPaths,
      commonActiveTask,
      getDeveloperScript,
      taskScript,
    ];
    for (const script of pyScripts) {
      expect(
        script.includes("import") ||
          script.includes("def ") ||
          script.includes("class ") ||
          script.includes("#"),
      ).toBe(true);
    }
  });

  it("scriptsInit is a Python docstring module", () => {
    expect(scriptsInit).toContain('"""');
  });

  it("workflowMdTemplate is markdown", () => {
    expect(workflowMdTemplate).toContain("#");
  });

  it("marketplace native workflow mirror matches the bundled workflow", () => {
    const repoRoot = fs.existsSync(path.join(process.cwd(), "marketplace"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const marketplaceNative = fs.readFileSync(
      path.join(repoRoot, "marketplace/workflows/native/workflow.md"),
      "utf-8",
    );
    expect(marketplaceNative).toBe(workflowMdTemplate);
  });

  it("marketplace TDD workflow planning breadcrumbs include behavior gates", () => {
    const repoRoot = fs.existsSync(path.join(process.cwd(), "marketplace"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const tddWorkflow = fs.readFileSync(
      path.join(repoRoot, "marketplace/workflows/tdd/workflow.md"),
      "utf-8",
    );
    const planning = /\[workflow-state:planning\]([\s\S]*?)\[\/workflow-state:planning\]/.exec(
      tddWorkflow,
    )?.[1];
    const planningInline = /\[workflow-state:planning-inline\]([\s\S]*?)\[\/workflow-state:planning-inline\]/.exec(
      tddWorkflow,
    )?.[1];

    for (const block of [planning, planningInline]) {
      expect(block).toContain("observable behavior slices");
      expect(block).toContain("public interface under test");
      expect(block).toContain("mock boundaries");
    }
  });

  it("[issue-225] workflow.md in_progress breadcrumb has class-2 sub-agent dispatch protocol", () => {
    // The in_progress breadcrumb instructs the main agent to prefix
    // dispatch prompts with "Active task: <path>" on class-2 platforms.
    // Without this line, codex/copilot/gemini/qoder sub-agents cannot
    // find the active task (no PreToolUse hook to inject context).
    const block = inProgressBreadcrumb();
    expect(block).toContain("Active task:");
    expect(block.toLowerCase()).toContain("class-2");
    expect(block).toMatch(/codex|copilot|gemini|qoder/);
  });

  it("[issue-237] workflow.md in_progress breadcrumb self-exempts implement/check sub-agents", () => {
    // The in_progress breadcrumb may be injected into sub-agent turns on some
    // hosts, so its main-session dispatch guidance must not recursively apply
    // to a sub-agent that is already doing the requested work.
    const block = inProgressBreadcrumb();
    expect(block).toContain("Main-session default");
    expect(block).toContain("Sub-agent self-exemption");
    expect(block).toContain("already running as `trellis-implement`");
    expect(block).toContain("do NOT spawn another `trellis-implement`");
    expect(block).toContain("already running as `trellis-check`");
    expect(block).toContain("do NOT spawn another `trellis-check`");
    expect(block).toContain("main session only");
  });

  it("workflow.md in_progress breadcrumb records host-neutral review gates and final verification reachability", () => {
    const block = inProgressBreadcrumb();
    expect(block).toContain("Review gates are host-neutral");
    expect(block).toContain("Claude Code and Codex");
    expect(block).toContain("trellis-merge-review");
    expect(block).toContain("Review-gate contract: explicit-selection-v1");
    expect(block).toContain("Optional review gates status: configured");
    expect(block).toContain("workflow.review_gates.runs[<gate>]");
    expect(block).toContain("reports/<gate>.md");
    expect(block).toContain("at 3 consecutive FAILs");
    expect(block).toContain("trellis-check");
    expect(block).toContain("merge if needed");
    expect(block).toContain("build/test");
    expect(block).toContain("trellis-code-architecture-review");
    expect(block).toContain("does not by itself enable or block deep-review");
  });

  it("Claude and Codex publish the same review-gate contract", () => {
    const fixtureDispatches = (["claude", "codex"] as const).map((host) => {
      const parsed = taskRecordSchema.parse(
        taskRecordWithWorkflow(explicitReviewFixture(host)),
      );
      const workflow = parsed.workflow;
      if (workflow === undefined || "selection_status" in workflow) {
        throw new Error(`${host} fixture must use explicit review-gate selection`);
      }
      return WORKFLOW_REVIEW_GATES.filter((gate) =>
        workflow.review_gates.enabled.includes(gate),
      ).map((gate) => "trellis-" + gate);
    });
    expect(fixtureDispatches).toEqual([
      ["trellis-spec-review", "trellis-code-review", "trellis-merge-review"],
      ["trellis-spec-review", "trellis-code-review", "trellis-merge-review"],
    ]);

    const enabled = [
      "spec-review",
      "code-review",
      "code-architecture-review",
    ] as const;
    const disabledGate = "merge-review";
    const block = inProgressBreadcrumb();
    const gateIndexes = enabled.map((gate) => block.indexOf("`" + gate + "`"));
    expect(gateIndexes[0]).toBeGreaterThan(-1);
    expect(gateIndexes[1]).toBeGreaterThan(gateIndexes[0] ?? -1);
    expect(gateIndexes[2]).toBeGreaterThan(gateIndexes[1] ?? -1);
    expect(block).toContain("Disabled gates are not dispatched.");
    expect(block).toContain("legacy task");
    expect(block).toContain("workflow.selection_status: unselected");
    expect(block).toContain("invalid structured record");

    const hostAgents = [
      ["Claude", getClaudeAgents()],
      ["Codex", getCodexAgents()],
    ] as const;

    for (const [host, agents] of hostAgents) {
      const contents = new Map(agents.map((agent) => [agent.name, agent.content]));
      for (const gate of enabled) {
        const content = contents.get("trellis-" + gate) ?? "";
        expect(content, host + " should define the " + gate + " gate").toContain(
          "<task-path>/task.json",
        );
        expect(content).toContain("workflow.selection_status");
        expect(content).toContain("legacy");
        expect(content).toContain("`" + gate + "`");
        expect(content).toMatch(/malformed structured workflow|incomplete or invalid/);
        expect(content).toContain("## Read-Only Boundary");
        expect(content).toContain("Return the Markdown report only.");
        expect(content).toContain("<task-path>/reports/" + gate + ".md");
        expect(content).toContain("workflow.review_gates.runs." + gate);
      }

      const disabledContent = contents.get("trellis-" + disabledGate) ?? "";
      expect(disabledContent, host + " should define the disabled gate").toContain(
        "`" + disabledGate + "`",
      );
      expect(disabledContent).toContain("disabled");
      expect(disabledContent).toMatch(/blocks this review|must not be dispatched/);
      expect(disabledContent).toContain("## Read-Only Boundary");
      expect(disabledContent).toContain("Return the Markdown report only.");
      expect(disabledContent).toContain(
        "<task-path>/reports/" + disabledGate + ".md",
      );
      expect(disabledContent).toContain(
        "workflow.review_gates.runs." + disabledGate,
      );
    }
  });

  it("[issue-237] workflow.md Phase 2 dispatch steps require prompt recursion guards", () => {
    expect(workflowMdTemplate).toContain("**Dispatch prompt guard**");
    expect(workflowMdTemplate).toContain(
      "already the `trellis-implement` sub-agent",
    );
    expect(workflowMdTemplate).toContain(
      "not spawn another `trellis-implement` / `trellis-check`",
    );
    expect(workflowMdTemplate).toContain(
      "already the `trellis-check` sub-agent",
    );
    expect(workflowMdTemplate).toContain(
      "not spawn another `trellis-check` / `trellis-implement`",
    );
    expect(workflowMdTemplate).toContain(
      "`trellis-implement` carries `permissionMode: acceptEdits`",
    );
    expect(workflowMdTemplate).toContain(
      "host-constrained mode such as `auto`",
    );
  });

  it("workflow.md documents parent child task tree responsibilities", () => {
    expect(workflowMdTemplate).toContain("### Parent / Child Task Trees");
    expect(workflowMdTemplate).toContain(
      "several independently verifiable deliverables",
    );
    expect(workflowMdTemplate).toContain(
      "Parent/child structure is not a dependency system",
    );
    expect(workflowMdTemplate).toContain("--parent <parent-dir>");
    expect(workflowMdTemplate).toContain("task.py add-subtask <parent> <child>");
    expect(workflowMdTemplate).toContain(
      "start the child that owns the next independently verifiable deliverable",
    );
  });

  it("workflow.md step 1.1 includes parent child split guidance", () => {
    const step = stepSection("1.1");
    expect(step).toContain("When considering a parent/child split");
    expect(step).toContain("Parent tasks own source requirements");
    expect(step).toContain("Child tasks own actual deliverables");
    expect(step).toContain(
      "Parent/child structure is not a dependency system",
    );
    expect(step).toContain("Do not start the parent unless");
    expect(step).toContain("A.` / `B.` / `C.`");
    expect(step).toContain("task-local review-gate 选择");
    expect(step).toContain("Review-gate contract: explicit-selection-v1");
    expect(step).toContain("Optional review gates status: pending");
    expect(step).toContain("Optional review gates status: configured");
    expect(step).toContain("legacy task");
    expect(step).toContain("trellis-check");
    expect(step).toContain("pre-development architecture guidance");
    expect(step).toContain("trellis-code-architecture-review");
    expect(step).toContain("不会隐式开启 `trellis-improve-codebase-architecture` deep-review");
  });

  it("workflow.md planning breadcrumb requires Claude Code research before brainstorm when repo facts are needed", () => {
    const planning = workflowStateBreadcrumb("planning");
    expect(planning).toContain("Claude Code research-first gate");
    expect(planning).toContain("feature additions, feature changes, and bug fixes that depend on repository facts");
    expect(planning).toContain("run `trellis-research` before the first `trellis-brainstorm` question");
    expect(planning).toContain("When this gate triggers, explicitly tell the user that repository evidence is required");
    expect(planning).toContain("persist findings to `{TASK_DIR}/research/`");
    expect(planning).toContain("pure conversation, capability or usage explanation, pure user preference choices");
    expect(planning).toContain("If a later user answer would materially change the current understanding of repository facts");
    expect(planning).toContain("If research is inconclusive, report what was checked");
    expect(planning).toContain("`trellis-research` when the research-first gate applies → `trellis-brainstorm`");
  });

  it("workflow.md step 1.1 documents the Claude Code research-first gate", () => {
    const step = stepSection("1.1");
    expect(step).toContain("Claude Code research-first gate");
    expect(step).toContain("在第一个 `trellis-brainstorm` 问题前先分派 `trellis-research`");
    expect(step).toContain("把研究结果写入 `{TASK_DIR}/research/`");
    expect(step).toContain("触发该门槛时，先明确告诉用户当前问题需要仓库证据");
    expect(step).toContain("纯对话、能力说明、用法解释、纯用户偏好选择");
    expect(step).toContain("如果用户回答会明显影响“仓库当前事实”");
    expect(step).toContain("先报告已查证据、缺失证据");
  });

  it("workflow.md planning breadcrumb keeps requirement clarification before strategy decisions on Claude Code path", () => {
    const planning = workflowStateBreadcrumb("planning");
    expect(planning).toContain("trellis-grill-me");
    expect(planning).toContain("development strategy decision");
    expect(planning).toContain("`trellis-grill-me` is a required planning gate");
    expect(planning).toContain("Before `trellis-grill-me` is complete");
    expect(planning).toContain("do not enter development strategy decisions");
    expect(planning).toContain("do not create or complete `design.md` / `implement.md`");
    expect(planning).toContain("do not run `task.py start`");
    expect(planning).toContain("Do not enter development strategy decisions until `prd.md` has been tightened");
  });

  it("workflow.md planning breadcrumb records Claude Code development strategy decisions before start", () => {
    const planning = workflowStateBreadcrumb("planning");
    expect(planning).toContain("development mode");
    expect(planning).toContain("branch vs worktree");
    expect(planning).toContain("task.worktree_path");
    expect(planning).toContain("chosen actual directory");
    expect(planning).not.toContain("./.trellis/trellis-worktrees/<task-dir-name>");
    expect(planning).toContain("trellis-tdd");
    expect(planning).toContain("A.` / `B.` / `C.`");
    expect(planning).toContain("trellis-merge-review");
    expect(planning).toContain("Review-gate contract: explicit-selection-v1");
    expect(planning).toContain("Optional review gates status: pending");
    expect(planning).toContain("Optional review gates status: configured");
    expect(planning).toContain("Enabled optional review gates:");
    expect(planning).toContain("Disabled optional review gates:");
    expect(planning).toContain("pre-development architecture guidance");
    expect(planning).toContain("trellis-code-architecture-review");
    expect(planning).toContain("do NOT implicitly enable `trellis-improve-codebase-architecture` deep-review");
    expect(planning).toContain("Machine-readable selection is mandatory for new tasks");
    expect(planning).toContain("{TASK_DIR}/task.json.workflow");
    expect(planning).toContain(
      "do not treat an unselected or invalid structured workflow as a legacy task",
    );
  });

  it("shared templates keep task.worktree_path as the sole selected worktree", () => {
    expect(workflowMdTemplate).toContain("task.worktree_path");
    expect(workflowMdTemplate).not.toContain(
      "./.trellis/trellis-worktrees/<task-dir-name>",
    );

    const commonTemplates = new Map(
      [...getCommandTemplates(), ...getSkillTemplates()].map((template) => [
        template.name,
        template.content,
      ]),
    );
    for (const name of ["start", "brainstorm", "before-dev"]) {
      const content = commonTemplates.get(name) ?? "";
      expect(content, name + " should use task.worktree_path").toContain(
        "task.worktree_path",
      );
      expect(content).not.toContain("./.trellis/trellis-worktrees/<task-dir-name>");
    }
  });

  it("workflow.md planning breadcrumb requires native AskUserQuestion for Claude Code development strategy", () => {
    const planning = workflowStateBreadcrumb("planning");
    expect(planning).toContain("AskUserQuestion");
    expect(planning).toContain("Every `AskUserQuestion` question must have 2–4 options");
    expect(planning).toContain("do not put all five optional review gates in one question");
    expect(planning).toContain("core review gates with `multiSelect: true`");
    expect(planning).toContain("add-on review gates with `multiSelect: true`");
    expect(planning).toContain("Do not offer default review-gate packages");
    expect(planning).toContain("ask only for unresolved fields");
  });

  it("workflow.md step 1.1 documents AskUserQuestion strategy-question constraints", () => {
    const step = stepSection("1.1");
    expect(step).toContain("Claude Code 原生 `AskUserQuestion` 工具");
    expect(step).toContain("必须只有 2–4 options");
    expect(step).toContain("不要把 5 个 optional review gates 放进同一个 question");
    expect(step).toContain("核心 review gates 问题使用 `multiSelect: true`");
    expect(step).toContain("附加 review gates 问题使用 `multiSelect: true`");
    expect(step).toContain("不提供默认 review-gate 套餐");
    expect(step).toContain("只补齐未决字段");
  });

  it("workflow.md step 2.2 explains the shared review-gate contract and preserved order", () => {
    const step = stepSection("2.2");
    expect(step).toContain("所有宿主遵守同一 review-gate 合同");
    expect(step).toContain("{TASK_DIR}/task.json");
    expect(step).toContain("trellis-spec-review");
    expect(step).toContain("trellis-code-review");
    expect(step).toContain("trellis-code-architecture-review");
    expect(step).toContain("trellis-improve-codebase-architecture");
    expect(step).toContain("trellis-merge-review");
    expect(step).toContain("explicit-selection-v1");
    expect(step).toContain("legacy task");
    expect(step).toContain("不能把格式错误的 structured task 静默降级成 legacy");
    expect(step).toContain("Do not advance to the next gate until the previous gate passes");
    expect(step).toContain("after 3 consecutive FAILs");
    expect(step).toContain("Never skip a gate implicitly");
    expect(step).toContain("{TASK_DIR}/reports/<gate>.md");
    expect(step).toContain("inline 不会跳过 enabled review gate");
  });

  it("workflow.md in_progress-inline keeps the same enabled gate order", () => {
    const inline = workflowStateBreadcrumb("in_progress-inline");
    expect(inline).toContain("does not skip an enabled review gate");
    expect(inline).toContain("`spec-review`, `code-review`, and `code-architecture-review` gate in order");
    expect(inline).toContain("independent read-only review agent");
    expect(inline).toContain("reports/<gate>.md");
    expect(inline).toContain("merge-review");
    expect(inline).toContain("before final build/test");
  });

  it("workflow.md planning-inline requires machine-readable selection before start", () => {
    const planningInline = workflowStateBreadcrumb("planning-inline");
    expect(planningInline).toContain("Machine-readable selection is mandatory for new tasks");
    expect(planningInline).toContain("{TASK_DIR}/task.json.workflow");
    expect(planningInline).toContain("invalid structured workflow");
  });

  it("gitignoreTemplate contains ignore patterns", () => {
    expect(gitignoreTemplate).toContain(".developer");
    expect(gitignoreTemplate).toContain("trellis-worktrees/");
    expect(gitignoreTemplate).toContain("__pycache__");
  });
});

// =============================================================================
// getAllScripts — pure function assembling pre-loaded strings
// =============================================================================

describe("getAllScripts", () => {
  it("returns a Map", () => {
    const scripts = getAllScripts();
    expect(scripts).toBeInstanceOf(Map);
  });

  it("contains expected script entries", () => {
    const scripts = getAllScripts();
    expect(scripts.has("__init__.py")).toBe(true);
    expect(scripts.has("common/__init__.py")).toBe(true);
    expect(scripts.has("common/paths.py")).toBe(true);
    expect(scripts.has("common/active_task.py")).toBe(true);
    expect(scripts.has("common/worktree_sync.py")).toBe(true);
    expect(scripts.has("task.py")).toBe(true);
    expect(scripts.has("get_developer.py")).toBe(true);
  });

  it("has at least one entry", () => {
    const scripts = getAllScripts();
    expect(scripts.size).toBeGreaterThan(0);
  });

  it("all values are non-empty strings", () => {
    const scripts = getAllScripts();
    for (const [key, value] of scripts) {
      expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("values match the exported constants", () => {
    const scripts = getAllScripts();
    expect(scripts.get("__init__.py")).toBe(scriptsInit);
    expect(scripts.get("common/__init__.py")).toBe(commonInit);
    expect(scripts.get("task.py")).toBe(taskScript);
  });

  it("does not contain multi_agent entries", () => {
    const scripts = getAllScripts();
    for (const [key] of scripts) {
      expect(key, `${key} should not be a multi_agent script`).not.toContain("multi_agent");
    }
  });
});
