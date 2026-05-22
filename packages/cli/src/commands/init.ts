import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import figlet from "figlet";
import inquirer from "inquirer";
import { createWorkflowStructure } from "../configurators/workflow.js";
import {
  getInitToolChoices,
  resolveCliFlag,
  configurePlatform,
  getConfiguredPlatforms,
  getPlatformsWithPythonHooks,
} from "../configurators/index.js";
import {
  getPythonCommandForPlatform,
  setResolvedPythonCommand,
} from "../configurators/shared.js";
import { AI_TOOLS, type CliFlag } from "../types/ai-tools.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { agentsMdContent } from "../templates/markdown/index.js";
import {
  setWriteMode,
  startRecordingWrites,
  stopRecordingWrites,
  writeFile,
  type WriteMode,
} from "../utils/file-writer.js";
import { emptyTaskJson, type TaskJson } from "../utils/task-json.js";
import {
  detectProjectType,
  detectMonorepo,
  sanitizePkgName,
  type ProjectType,
  type DetectedPackage,
} from "../utils/project-detector.js";
import { initializeHashes, removeHash } from "../utils/template-hash.js";
import {
  NATIVE_WORKFLOW_ID,
  resolveWorkflowTemplate,
} from "../utils/workflow-resolver.js";
import {
  isCwdHomedir,
  homedirGuardMessage,
  homedirBypassEnabled,
} from "../utils/cwd-guard.js";
import {
  fetchTemplateIndex,
  probeRegistryIndex,
  downloadTemplateById,
  downloadRegistryDirect,
  parseRegistrySource,
  TIMEOUTS,
  TEMPLATE_INDEX_URL,
  type SpecTemplate,
  type TemplateStrategy,
  type RegistrySource,
  type RegistryBackend,
} from "../utils/template-fetcher.js";
import { setupProxy, maskProxyUrl } from "../utils/proxy.js";

const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 9;
const PYTHON_VERSION_RE = /Python (\d+)\.(\d+)/;

export function isSupportedPythonVersion(versionOutput: string): boolean {
  const match = versionOutput.match(PYTHON_VERSION_RE);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major > MIN_PYTHON_MAJOR ||
    (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR)
  );
}

// Sentinel returned when child_process spawn is blocked by a sandbox / kernel
// policy (e.g. seccomp inside Codex's Linux sandbox). EPERM/EACCES here mean
// "the kernel refused the spawn" — NOT "python3 isn't installed". The host
// usually has python3 on PATH; we just can't probe it from this Node process.
type PythonProbe = string | null | "sandbox-restricted";

function detectPythonVersion(command: string): PythonProbe {
  try {
    return execSync(`${command} --version`, {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EACCES") {
      return "sandbox-restricted";
    }
    return null;
  }
}

export function requireSupportedPython(command: string): string {
  // Final escape hatch — set when the user knows python3 is on PATH but
  // the probe keeps failing for environment-specific reasons.
  if (process.env.TRELLIS_SKIP_PYTHON_CHECK === "1") {
    return `version check skipped (TRELLIS_SKIP_PYTHON_CHECK=1)`;
  }

  const versionOutput = detectPythonVersion(command);

  if (versionOutput === "sandbox-restricted") {
    console.warn(
      chalk.yellow(
        `⚠ Python version check skipped — sandboxed environment blocked ` +
          `child_process spawn (EPERM/EACCES). Assuming "${command}" is on ` +
          `PATH. If init fails later, re-run on the host or set ` +
          `TRELLIS_SKIP_PYTHON_CHECK=1.`,
      ),
    );
    return `version unknown (sandbox-restricted)`;
  }

  if (!versionOutput) {
    throw new Error(
      `Python command "${command}" not found. Trellis init requires Python ≥ 3.9.`,
    );
  }

  if (!isSupportedPythonVersion(versionOutput)) {
    throw new Error(
      `${versionOutput} detected via "${command}", but Trellis init requires Python ≥ 3.9.`,
    );
  }

  return versionOutput;
}

/**
 * Candidate Python command list per platform.
 *
 * Windows: `python` is the usual python.org installer choice, but Microsoft
 * Store ships `python3`, and the `py` launcher is `py -3`. We try all three
 * before giving up — fixes #236 where users with only `python3` (not
 * `python`) had `trellis init` fail outright.
 *
 * Non-Windows: `python3` is canonical; `python` is a fallback for systems
 * where Python 3 is the only Python and is named `python` (some Arch
 * configs, conda envs).
 */
const PYTHON_CANDIDATES: Record<"win32" | "other", readonly string[]> = {
  win32: ["python", "python3", "py -3"],
  other: ["python3", "python"],
};

/**
 * Detect a working Python ≥ 3.9 command on the host platform.
 *
 * Honors `TRELLIS_PYTHON_CMD` (explicit override, no probe) and
 * `TRELLIS_SKIP_PYTHON_CHECK=1` (skip probe, trust platform default).
 *
 * Otherwise tries each candidate in `PYTHON_CANDIDATES` in order and returns
 * the first whose `--version` matches `Python ≥ 3.9`. Caches the result via
 * `setResolvedPythonCommand` so all downstream template / configurator
 * writes pick up the resolved value.
 *
 * Throws a helpful, Windows-aware error if no candidate works.
 */
export function resolveSupportedPython(): {
  command: string;
  version: string;
} {
  // Explicit override — user knows their environment.
  const override = process.env.TRELLIS_PYTHON_CMD?.trim();
  if (override) {
    setResolvedPythonCommand(override);
    return { command: override, version: "set via TRELLIS_PYTHON_CMD" };
  }

  // Skip probe entirely.
  if (process.env.TRELLIS_SKIP_PYTHON_CHECK === "1") {
    const fallback = getPythonCommandForPlatform();
    setResolvedPythonCommand(fallback);
    return {
      command: fallback,
      version: "version check skipped (TRELLIS_SKIP_PYTHON_CHECK=1)",
    };
  }

  const candidates =
    process.platform === "win32"
      ? PYTHON_CANDIDATES.win32
      : PYTHON_CANDIDATES.other;

  const probeFailures: string[] = [];
  for (const candidate of candidates) {
    const probe = detectPythonVersion(candidate);
    if (probe === "sandbox-restricted") {
      console.warn(
        chalk.yellow(
          `⚠ Python version check skipped — sandboxed environment blocked ` +
            `child_process spawn (EPERM/EACCES). Assuming "${candidate}" is ` +
            `on PATH. If init fails later, re-run on the host or set ` +
            `TRELLIS_SKIP_PYTHON_CHECK=1.`,
        ),
      );
      setResolvedPythonCommand(candidate);
      return {
        command: candidate,
        version: "version unknown (sandbox-restricted)",
      };
    }
    if (!probe) {
      probeFailures.push(`${candidate}: not found`);
      continue;
    }
    if (!isSupportedPythonVersion(probe)) {
      probeFailures.push(`${candidate}: ${probe} (< 3.9)`);
      continue;
    }
    setResolvedPythonCommand(candidate);
    return { command: candidate, version: probe };
  }

  const isWindows = process.platform === "win32";
  const installHint = isWindows
    ? `Install Python ≥ 3.9 from https://www.python.org/downloads/windows/ — make sure ` +
      `"Add Python to PATH" is checked in the installer. Or, if Python is ` +
      `installed under a different name, set TRELLIS_PYTHON_CMD=<your-cmd> ` +
      `before re-running init (e.g. \`set TRELLIS_PYTHON_CMD=py -3\`).`
    : `Install Python ≥ 3.9 from https://www.python.org/downloads/ or via your ` +
      `package manager. Or set TRELLIS_PYTHON_CMD=<your-cmd> before re-running.`;

  throw new Error(
    `No supported Python command found. Tried: ${candidates.join(", ")}.\n` +
      `Probe results:\n  ${probeFailures.join("\n  ")}\n\n` +
      `Trellis init requires Python ≥ 3.9. ${installHint}\n` +
      `Last-resort escape hatch: set TRELLIS_SKIP_PYTHON_CHECK=1 to skip the probe entirely.`,
  );
}

function getOsDisplayName(
  platform: NodeJS.Platform = process.platform,
): string {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

function logPythonAdaptationNotice(command: string): void {
  const osName = getOsDisplayName();
  console.log(
    chalk.blue(
      `📌 ${osName} detected: Trellis rendered Python commands as "${command}" in generated hooks, settings, and help text`,
    ),
  );
}

// =============================================================================
// Bootstrap Task Creation
// =============================================================================

const BOOTSTRAP_TASK_NAME = "00-bootstrap-guidelines";

/**
 * Slugify a developer name for safe use in task directory names.
 *
 * Unlike `sanitizePkgName` (which only strips npm @scope/ prefixes), this
 * handles arbitrary developer input: spaces, Unicode letters, punctuation,
 * path separators. Returns "user" fallback when input slugifies to empty.
 *
 * Exported for unit testing; not part of the public API.
 */
export function slugifyDeveloperName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

/**
 * Write a task skeleton (task.json + prd.md).
 *
 * Idempotent: if the task dir already exists, returns true without touching
 * anything. Shared by both creator bootstrap and joiner onboarding flows.
 */
function writeTaskSkeleton(
  cwd: string,
  taskName: string,
  taskJson: TaskJson,
  prdContent: string,
): boolean {
  const taskDir = path.join(cwd, PATHS.TASKS, taskName);
  if (fs.existsSync(taskDir)) return true; // idempotent

  try {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, FILE_NAMES.TASK_JSON),
      JSON.stringify(taskJson, null, 2),
      "utf-8",
    );
    fs.writeFileSync(path.join(taskDir, FILE_NAMES.PRD), prdContent, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function readCurrentDeveloperName(cwd: string): string | null {
  const developerFile = path.join(cwd, DIR_NAMES.WORKFLOW, FILE_NAMES.DEVELOPER);
  if (!fs.existsSync(developerFile)) {
    return null;
  }

  const raw = fs.readFileSync(developerFile, "utf-8");
  const nameMatch = raw.match(/^\s*name\s*=\s*(.+?)\s*$/m);
  return nameMatch ? nameMatch[1] : null;
}

function ensureInitialTrellisSwitch(cwd: string, developerName: string): void {
  const workspaceDir = path.join(
    cwd,
    DIR_NAMES.WORKFLOW,
    DIR_NAMES.WORKSPACE,
    developerName,
  );
  fs.mkdirSync(workspaceDir, { recursive: true });

  const switchFile = path.join(workspaceDir, "trellis-switch.json");
  if (fs.existsSync(switchFile)) {
    return;
  }

  fs.writeFileSync(
    switchFile,
    JSON.stringify({ enabled: true }, null, 2) + "\n",
    "utf-8",
  );

  const journals = fs
    .readdirSync(workspaceDir)
    .filter((f) => f.startsWith("journal-") && f.endsWith(".md"))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
      const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
      return nb - na;
    });
  const journalPath = path.join(workspaceDir, journals[0] ?? "journal-1.md");

  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, "", "utf-8");
  }

  const prefix = fs.statSync(journalPath).size > 0 ? "\n" : "";
  fs.appendFileSync(journalPath, `${prefix}- Trellis 已开启\n`, "utf-8");
}

/**
 * Compute the bootstrap checklist items (previously stored as structured
 * `subtasks: [{name, status}]` in task.json). Per task 04-21-task-schema-unify
 * (D1), these live as markdown `- [ ]` items in prd.md instead, so task.json
 * stays canonical with `subtasks: string[]` (child task dir names, same as
 * task_store.py).
 */
function getBootstrapChecklistItems(
  projectType: ProjectType,
  packages?: DetectedPackage[],
): string[] {
  if (packages && packages.length > 0) {
    const items = packages.map((pkg) => `补充 ${pkg.name} 的开发规范`);
    items.push("补充代码示例");
    return items;
  }
  if (projectType === "frontend") {
    return ["补充前端开发规范", "补充代码示例"];
  }
  if (projectType === "backend") {
    return ["补充后端开发规范", "补充代码示例"];
  }
  return ["补充后端开发规范", "补充前端开发规范", "补充代码示例"];
}

function getBootstrapRelatedFiles(
  projectType: ProjectType,
  packages?: DetectedPackage[],
): string[] {
  if (packages && packages.length > 0) {
    return packages.map((pkg) => `.trellis/spec/${sanitizePkgName(pkg.name)}/`);
  }
  if (projectType === "frontend") {
    return [".trellis/spec/frontend/"];
  }
  if (projectType === "backend") {
    return [".trellis/spec/backend/"];
  }
  return [".trellis/spec/backend/", ".trellis/spec/frontend/"];
}

function getBootstrapPrdContent(
  projectType: ProjectType,
  pythonCmd: string,
  packages?: DetectedPackage[],
): string {
  const checklistItems = getBootstrapChecklistItems(projectType, packages);
  const checklistMarkdown = checklistItems
    .map((item) => `- [ ] ${item}`)
    .join("\n");

  const header = `# 启动任务：补全项目开发规范

**你（AI）正在执行这个任务，开发者不会直接阅读这个文件。**

开发者刚刚第一次在这个项目里运行了 \`trellis init\`。
现在 \`.trellis/\` 已创建，里面包含待补全的 spec 脚手架，这个启动任务也已经
出现在 \`.trellis/tasks/\` 下。当他们准备处理它时，应当在提供 Trellis 会话身份
的会话里启动这个任务。

**你的目标**：帮助他们把团队真实的编码规范补充进 \`.trellis/spec/\`。
未来这个项目里的每次 AI 会话——包括 \`trellis-implement\` 和 \`trellis-check\`
子代理——都会自动加载每个任务 jsonl 清单里列出的 spec 文件。spec 为空，
子代理就会写出泛化代码；spec 真实完整，子代理才会贴近团队现有风格。

不要一上来倾倒说明。先用一句简短欢迎语开场，确认仓库里是否已有约定文档
（如 CLAUDE.md、.cursorrules 等），再以对话方式推进。

---

## 当前状态（完成后更新下面复选框）

${checklistMarkdown}

---

## 需要补充的 Spec 文件
`;

  const backendSection = `

### 后端规范

| 文件 | 需要记录的内容 |
|------|----------------|
| \`.trellis/spec/backend/directory-structure.md\` | 各类文件的放置位置（routes、services、utils 等） |
| \`.trellis/spec/backend/database-guidelines.md\` | ORM、迁移、查询模式、命名约定 |
| \`.trellis/spec/backend/error-handling.md\` | 错误如何捕获、记录和返回 |
| \`.trellis/spec/backend/logging-guidelines.md\` | 日志级别、格式、记录范围 |
| \`.trellis/spec/backend/quality-guidelines.md\` | 代码评审标准、测试要求 |
`;

  const frontendSection = `

### 前端规范

| 文件 | 需要记录的内容 |
|------|----------------|
| \`.trellis/spec/frontend/directory-structure.md\` | 组件、页面、hook 的组织方式 |
| \`.trellis/spec/frontend/component-guidelines.md\` | 组件模式、props 约定 |
| \`.trellis/spec/frontend/hook-guidelines.md\` | 自定义 hook 命名与模式 |
| \`.trellis/spec/frontend/state-management.md\` | 本地状态、全局状态、服务端状态的使用方式 |
| \`.trellis/spec/frontend/type-safety.md\` | TypeScript 约定、类型组织方式 |
| \`.trellis/spec/frontend/quality-guidelines.md\` | 代码规范、禁用模式 |
`;

  const footer = `

### 思考指南（已预填）

\`.trellis/spec/guides/\` 中已预置通用思考指南。
只有当其中内容明显不适合当前项目时，才需要调整。

---

## 如何补充 Spec

### 第一步：优先导入已有约定文档（推荐）

先在仓库中搜索已有的约定文档。如果存在，先读这些文件，再把相关规则整理到对应
的 \`.trellis/spec/\` 文件里——这通常比从零开始快得多。

| 文件 / 目录 | 工具 |
|------|------|
| \`CLAUDE.md\` / \`CLAUDE.local.md\` | Claude Code |
| \`AGENTS.md\` | Codex / Claude Code / 兼容 agent 的工具 |
| \`.cursorrules\` | Cursor |
| \`.cursor/rules/*.mdc\` | Cursor（规则目录） |
| \`.windsurfrules\` | Windsurf |
| \`.clinerules\` | Cline |
| \`.roomodes\` | Roo Code |
| \`.github/copilot-instructions.md\` | GitHub Copilot |
| \`.vscode/settings.json\` → \`github.copilot.chat.codeGeneration.instructions\` | VS Code Copilot |
| \`CONVENTIONS.md\` / \`.aider.conf.yml\` | aider |
| \`CONTRIBUTING.md\` | 通用项目约定 |
| \`.editorconfig\` | 编辑器格式规则 |

### 第二步：分析代码库中未被文档覆盖的部分

从真实代码里归纳模式。写每个 spec 文件前：
- 先找到 2-3 个真实示例。
- 记录真实文件路径，不要写假想路径。
- 记下团队明确避免的反模式。

### 第三步：记录现实，而不是理想状态

**关键**：写代码库现在**实际上怎样做**，而不是“应该怎样做”。
子代理会按 spec 来实现；如果 spec 写的是不存在的理想模式，后续生成的代码就会和
仓库现状脱节。

如果团队存在已知技术债，请记录当前现状——如何改进是后续话题，不属于这次启动任务。

---

## 运行时机制速览（当开发者问“为什么需要 spec”时再解释）

- 每个 AI 编码任务都会派生两个子代理：\`trellis-implement\`（负责写代码）和
  \`trellis-check\`（负责验证质量）。
- 每个任务都有 \`implement.jsonl\` / \`check.jsonl\` 清单，用于列出需要加载的 spec 文件。
- 平台 hook 会自动把这些 spec 文件以及任务的 \`prd.md\` 注入到每个子代理的 prompt 中，
  这样它们能按团队约定编码或评审，而不需要人工反复粘贴。
- 唯一事实来源是 \`.trellis/spec/\`。这也是为什么现在把它补好，会长期持续收益。

---

## 完成方式

当开发者确认上面的清单都已结合真实示例补完后，引导他们执行：

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py finish
${pythonCmd} ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
\`\`\`

归档后，后续每位新加入这个项目的开发者拿到的将不再是这个启动任务，而是
\`00-join-<slug>\` 入项引导任务。

---

## 建议开场白

“欢迎使用 Trellis！刚才的初始化已经让我可以帮助你补齐项目 spec。这是一次性设置，
做好之后，后续每次 AI 会话都会按团队规范工作，而不是产出泛化代码。开始前你手头有
现成的约定文档（如 CLAUDE.md、.cursorrules、CONTRIBUTING.md）可以先让我读取吗？
如果没有，我就从代码库里开始归纳。”
`;

  let content = header;

  if (packages && packages.length > 0) {
    // Monorepo: generate per-package sections
    for (const pkg of packages) {
      const pkgType = pkg.type === "unknown" ? "fullstack" : pkg.type;
      const specName = sanitizePkgName(pkg.name);
      content += `\n### Package: ${pkg.name} (\`spec/${specName}/\`)\n`;
      if (pkgType !== "frontend") {
        content += `\n- Backend guidelines: \`.trellis/spec/${specName}/backend/\`\n`;
      }
      if (pkgType !== "backend") {
        content += `\n- Frontend guidelines: \`.trellis/spec/${specName}/frontend/\`\n`;
      }
    }
  } else if (projectType === "frontend") {
    content += frontendSection;
  } else if (projectType === "backend") {
    content += backendSection;
  } else {
    // fullstack
    content += backendSection;
    content += frontendSection;
  }
  content += footer;

  return content;
}

function getBootstrapTaskJson(
  developer: string,
  projectType: ProjectType,
  packages?: DetectedPackage[],
): TaskJson {
  const today = new Date().toISOString().split("T")[0];
  const relatedFiles = getBootstrapRelatedFiles(projectType, packages);

  // Canonical 24-field shape via emptyTaskJson factory.
  // Checklist items (previously stored as structured `subtasks`) are now
  // rendered as `- [ ]` items in prd.md; task.json.subtasks is always
  // string[] (child task dir names) per the canonical schema.
  return emptyTaskJson({
    id: BOOTSTRAP_TASK_NAME,
    name: BOOTSTRAP_TASK_NAME,
    title: "Bootstrap Guidelines",
    description: "Fill in project development guidelines for AI agents",
    status: "in_progress",
    dev_type: "docs",
    priority: "P1",
    creator: developer,
    assignee: developer,
    createdAt: today,
    relatedFiles,
    notes: `First-time setup task created by trellis init (${projectType} project)`,
  });
}

/**
 * Create bootstrap task for first-time setup
 */
function createBootstrapTask(
  cwd: string,
  developer: string,
  pythonCmd: string,
  projectType: ProjectType,
  packages?: DetectedPackage[],
): boolean {
  const taskJson = getBootstrapTaskJson(developer, projectType, packages);
  const prdContent = getBootstrapPrdContent(projectType, pythonCmd, packages);
  return writeTaskSkeleton(cwd, BOOTSTRAP_TASK_NAME, taskJson, prdContent);
}

// =============================================================================
// Joiner Onboarding Task Creation
// =============================================================================

/**
 * task.json factory for joiner onboarding. Mirrors the bootstrap factory but
 * uses dev_type "docs", higher priority "P1", and the developer-specific task
 * name (so multiple joiners in the same checkout don't collide).
 */
function getJoinerTaskJson(developer: string, taskName: string): TaskJson {
  const today = new Date().toISOString().split("T")[0];
  return emptyTaskJson({
    id: taskName,
    name: taskName,
    title: `Joining: Onboard to this Trellis project (${developer})`,
    description:
      "Onboard a new developer to an existing Trellis project: learn the workflow, conventions, and find assigned work",
    status: "in_progress",
    dev_type: "docs",
    priority: "P1",
    creator: developer,
    assignee: developer,
    createdAt: today,
    notes:
      "Generated by trellis init for a new developer joining an existing Trellis project",
  });
}

/**
 * PRD content for joiner onboarding. Kept concise (~80 lines) — deeper
 * guidance lives in skills and docs.
 */
function getJoinerPrdContent(developer: string, pythonCmd: string): string {
  const slug = slugifyDeveloperName(developer);
  return `# 入项引导任务

**你（AI）正在执行这个任务，开发者不会直接阅读这个文件。**

\`${developer}\` 刚在一个全新 clone 上运行了 \`trellis init\`，看到了 “Developer
initialized” 提示，接下来会开始在聊天里向你提问。这个入项任务已经位于
\`.trellis/tasks/\` 下；当他们准备处理它时，应当在提供 Trellis 会话身份的会话中启动。

你的职责是帮助他们理解 Trellis。不要一次性把所有内容倾倒给他们——先用一句简短问候开场，
问他们想从哪里开始，再随着对话逐步补充后续内容。

---

## 需要覆盖的主题（顺序可按他们的问题调整）

### 1. Trellis 是什么 + 工作流是什么

Trellis 是叠加在 Claude Code / Cursor 等工具之上的一层工作流，用来让 AI agent
在每次会话里都遵循项目自己的规范，而不是反复产出泛化代码。

- **三阶段流程**：Plan（brainstorm → \`prd.md\`）→ Execute（编码 + 检查）→
  Finish（沉淀 + 收尾）。完整参考见 \`.trellis/workflow.md\`。
- **任务生命周期**：planning → in_progress → done → archive，目录位于
  \`.trellis/tasks/\`。
- **核心 slash commands**：
  - \`/trellis:continue\` —— 恢复当前会话的活动任务
  - \`/trellis:finish-work\` —— 收尾已完成任务
  - \`/trellis:start\` —— 从零启动一次会话（这里通常不需要；SessionStart hook 会自动完成启动）

### 2. 运行时机制（当他们问“它怎么知道该做什么”时解释）

- **SessionStart hook** 会运行 \`get_context.py\`，并在每次新会话开始时把身份、git 状态、
  当前会话活动任务、活动任务列表、工作流阶段注入到 AI 对话中。
- **\`<workflow-state>\` 标签** 会在每次用户消息时自动注入，携带当前任务和阶段提示。
- **\`/trellis:continue\`** 会加载 Phase Index，读取 \`prd.md\` 与近期活动，然后把当前任务
  路由到正确技能（规划走 \`trellis-brainstorm\`，编码走 \`trellis-implement\`，验证走 \`trellis-check\`）。
- **\`trellis-implement\` 子代理** 会在需要写代码时启动。平台 hook 会读取
  \`{TASK_DIR}/implement.jsonl\`，并把这些 spec 文件与 \`prd.md\` 一起注入子代理 prompt，
  让它按项目规范编码。
- **\`trellis-check\` 子代理** 也采用同样机制读取 \`check.jsonl\` —— 按规范审查改动、自动修复问题、运行 lint/typecheck。

文件布局（当他们问“东西都放哪”时提到）：
- \`.trellis/.runtime/sessions/<session>.json\` —— 会话级活动任务状态，已 gitignore
- \`.trellis/tasks/<task>/{implement,check}.jsonl\` —— 每个任务的上下文清单
- \`.trellis/spec/\` —— 项目级规范（唯一事实来源）
- \`.trellis/workspace/${developer}/journal-*.md\` —— 该开发者的会话日志，约 2000 行轮转一次

### 3. 这个项目自己的约定

- 帮他们概括 \`.trellis/spec/\`：这个团队实际要求哪些编码规范。
- 指给他们看 \`.trellis/tasks/archive/\` 里最近 5 条记录，作为实际工作节奏示例。
  **如果 archive 为空**（项目刚开始），就跳过，不要编造例子。
- 这次入项引导不负责讲业务代码本身——那部分应由 README 和团队成员来承担。

### 4. 他们当前被分配的工作

- 先检查 \`.trellis/workspace/${developer}/\` 是否已存在——如果存在，说明这是他们从另一台机器带来的日志，值得提醒。
- 运行 \`${pythonCmd} ./.trellis/scripts/task.py list --assignee ${developer}\`，展示分配给他们的任务。（如果名字含空格，记得加引号。）
- 提醒他们：“My Tasks” 区块会在每次新会话的 SessionStart 上下文里自动出现。

---

## 可选：带他们完整走一遍一个小任务

如果他们想先练手再接正式任务，可以主动提议挑一个很小的 P3 任务或 typo 修复，
一起完整走一遍：\`/trellis:continue\` → 你通过子代理实现 → \`/trellis:finish-work\`。

---

## 完成方式

当他们觉得已经完成入项理解（或者以上四个主题已经有过充分来回交流）后，引导他们执行：

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py finish
${pythonCmd} ./.trellis/scripts/task.py archive 00-join-${slug}
\`\`\`

---

## 建议开场白

“欢迎！这次 \`trellis init\` 已经让我可以带你完成这个项目的入项引导。我可以先讲工作流，
也可以先讲底层运行机制、团队 spec，或者直接看你现在关心的问题——你想从哪一块开始？”
`;
}

/**
 * Create joiner onboarding task for a new developer on an existing Trellis
 * project. Task name is slugified to be filesystem-safe for arbitrary
 * developer names (spaces, Unicode, punctuation).
 */
function createJoinerOnboardingTask(
  cwd: string,
  developer: string,
  pythonCmd: string,
): boolean {
  const slug = slugifyDeveloperName(developer);
  const taskName = `00-join-${slug}`;
  const taskJson = getJoinerTaskJson(developer, taskName);
  const prdContent = getJoinerPrdContent(developer, pythonCmd);
  return writeTaskSkeleton(cwd, taskName, taskJson, prdContent);
}

/**
 * Handle re-init when .trellis/ already exists.
 * Returns true if handled (caller should return), false if user chose full re-init.
 */
async function handleReinit(
  cwd: string,
  options: InitOptions,
  developerName: string | undefined,
  pythonCmd: string,
): Promise<boolean> {
  const TOOLS = getInitToolChoices();
  const configuredPlatforms = getConfiguredPlatforms(cwd);
  const configuredNames = [...configuredPlatforms]
    .map((id) => AI_TOOLS[id].name)
    .join(", ");

  // Determine explicit platform flags
  const explicitTools = TOOLS.filter(
    (t) => options[t.key as keyof InitOptions],
  ).map((t) => t.key);

  let doAddPlatforms = explicitTools.length > 0;
  let doAddDeveloper = !!options.user;
  let platformsToAdd: string[] = explicitTools;

  // No explicit flags → show menu
  if (!doAddPlatforms && !doAddDeveloper) {
    if (options.yes) {
      console.log(chalk.gray(`Already initialized with: ${configuredNames}`));
      console.log(
        chalk.gray(
          "Use platform flags (e.g., --codex) or -u <name> to add platforms/developer.",
        ),
      );
      return true;
    }

    console.log(
      chalk.gray(`\n   Already initialized with: ${configuredNames}\n`),
    );

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "Trellis is already initialized. What would you like to do?",
        choices: [
          { name: "Add AI platform(s)", value: "add-platform" },
          {
            name: "Set up developer identity on this device",
            value: "add-developer",
          },
          { name: "Full re-initialize", value: "full" },
        ],
      },
    ]);

    if (action === "full") {
      return false; // Fall through to full init
    }
    if (action === "add-platform") doAddPlatforms = true;
    if (action === "add-developer") doAddDeveloper = true;
  }

  // --- Add platforms ---
  if (doAddPlatforms) {
    if (platformsToAdd.length === 0) {
      // Interactive: show only unconfigured platforms
      const unconfigured = TOOLS.filter((t) => {
        const pid = resolveCliFlag(t.key);
        return pid && !configuredPlatforms.has(pid);
      });

      if (unconfigured.length === 0) {
        console.log(
          chalk.green("✓ All available platforms are already configured."),
        );
      } else {
        const answers = await inquirer.prompt<{ tools: string[] }>([
          {
            type: "checkbox",
            name: "tools",
            message: "Select platforms to add:",
            choices: unconfigured.map((t) => ({
              name: t.name,
              value: t.key,
            })),
          },
        ]);
        platformsToAdd = answers.tools;
      }
    }

    const reinitWritten = startRecordingWrites(cwd);
    try {
      for (const tool of platformsToAdd) {
        const platformId = resolveCliFlag(tool as CliFlag);
        if (platformId) {
          if (configuredPlatforms.has(platformId)) {
            console.log(
              chalk.gray(
                `  ○ ${AI_TOOLS[platformId].name} already configured, skipping`,
              ),
            );
          } else {
            console.log(
              chalk.blue(`📝 Configuring ${AI_TOOLS[platformId].name}...`),
            );
            await configurePlatform(platformId, cwd);
          }
        }
      }
    } finally {
      stopRecordingWrites();
    }

    // Update template hashes. Merge mode: preserve previously-tracked
    // platforms' hashes, layer in the newly-added platform's writes.
    const hashedCount = initializeHashes(cwd, {
      trackedPaths: reinitWritten,
      merge: true,
    });
    if (hashedCount > 0) {
      console.log(
        chalk.gray(`📋 Tracking ${hashedCount} template files for updates`),
      );
    }

    if (platformsToAdd.includes("claude")) {
      const currentDeveloper = readCurrentDeveloperName(cwd);
      if (currentDeveloper) {
        try {
          ensureInitialTrellisSwitch(cwd, currentDeveloper);
        } catch {
          // Silent failure
        }
      }
    }
  }

  // --- Add developer ---
  if (doAddDeveloper) {
    let devName = developerName;
    if (!devName) {
      devName = await askInput("Your name: ");
      while (!devName) {
        console.log(chalk.yellow("Name is required"));
        devName = await askInput("Your name: ");
      }
    }

    // Capture pre-init state: if .developer did not exist before we ran
    // init_developer.py, this checkout had no identity → treat as a new
    // joiner onboarding onto an existing Trellis project.
    const hadDeveloperFileBefore = fs.existsSync(
      path.join(cwd, DIR_NAMES.WORKFLOW, FILE_NAMES.DEVELOPER),
    );

    let developerInitialized = false;
    try {
      const scriptPath = path.join(cwd, PATHS.SCRIPTS, "init_developer.py");
      execSync(`${pythonCmd} "${scriptPath}" "${devName}"`, {
        cwd,
        stdio: "pipe",
      });
      developerInitialized = true;
      console.log(chalk.green(`✓ Developer "${devName}" initialized`));
    } catch {
      console.log(
        chalk.yellow("⚠ Could not initialize developer. Run manually:"),
      );
      console.log(
        chalk.gray(
          `  ${pythonCmd} .trellis/scripts/init_developer.py ${devName}`,
        ),
      );
    }

    if (developerInitialized && getConfiguredPlatforms(cwd).has("claude-code")) {
      try {
        ensureInitialTrellisSwitch(cwd, devName);
      } catch {
        // Silent failure
      }
    }

    // Create joiner onboarding task for fresh checkouts (no prior .developer).
    // Runs outside the init_developer try/catch so failures surface as warnings.
    if (!hadDeveloperFileBefore) {
      try {
        if (!createJoinerOnboardingTask(cwd, devName, pythonCmd)) {
          console.warn(
            chalk.yellow("⚠ Failed to create joiner onboarding task"),
          );
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠ Joiner onboarding setup failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }

  return true;
}

interface InitOptions {
  cursor?: boolean;
  claude?: boolean;
  opencode?: boolean;
  codex?: boolean;
  kilo?: boolean;
  kiro?: boolean;
  gemini?: boolean;
  antigravity?: boolean;
  windsurf?: boolean;
  qoder?: boolean;
  codebuddy?: boolean;
  copilot?: boolean;
  droid?: boolean;
  pi?: boolean;
  yes?: boolean;
  user?: string;
  force?: boolean;
  skipExisting?: boolean;
  template?: string;
  overwrite?: boolean;
  append?: boolean;
  registry?: string;
  monorepo?: boolean;
  workflow?: string;
  workflowSource?: string;
}

// Compile-time check: every CliFlag must be a key of InitOptions.
// If a new platform is added to CliFlag but not to InitOptions, this line errors.
// Uses [X] extends [Y] to prevent distributive conditional behavior.
type _AssertCliFlagsInOptions = [CliFlag] extends [keyof InitOptions]
  ? true
  : "ERROR: CliFlag has values not present in InitOptions";
const _cliFlagCheck: _AssertCliFlagsInOptions = true;

/**
 * Write monorepo package configuration to config.yaml (non-destructive patch).
 * Appends packages: and default_package: without disturbing existing config.
 */
function writeMonorepoConfig(cwd: string, packages: DetectedPackage[]): void {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  let content = "";

  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    // Config not created yet; will be created by createWorkflowStructure
    return;
  }

  // Don't overwrite if packages: already exists (re-init case)
  if (/^packages\s*:/m.test(content)) {
    return;
  }

  const lines = ["\n# Auto-detected monorepo packages", "packages:"];
  for (const pkg of packages) {
    lines.push(`  ${sanitizePkgName(pkg.name)}:`);
    lines.push(`    path: ${pkg.path}`);
    if (pkg.isSubmodule) {
      lines.push("    type: submodule");
    } else if (pkg.isGitRepo) {
      lines.push("    git: true");
    }
  }

  // Use first non-submodule package as default, fallback to first package
  const defaultPkg =
    packages.find((p) => !p.isSubmodule)?.name ?? packages[0]?.name;
  if (defaultPkg) {
    lines.push(`default_package: ${defaultPkg}`);
  }

  fs.writeFileSync(
    configPath,
    content.trimEnd() + "\n" + lines.join("\n") + "\n",
    "utf-8",
  );
}

interface InitAnswers {
  tools: string[];
  template?: string;
  existingDirAction?: TemplateStrategy;
}

export async function init(options: InitOptions): Promise<void> {
  // Refuse to run in $HOME — running here would scoop platform runtime data
  // (Claude/Codex/OpenCode session histories etc.) into the trellis hash
  // manifest, and a subsequent `trellis uninstall` would wipe it.
  if (isCwdHomedir() && !homedirBypassEnabled()) {
    console.error(chalk.red(homedirGuardMessage("init")));
    process.exit(1);
  }

  const cwd = process.cwd();
  const isFirstInit = !fs.existsSync(path.join(cwd, DIR_NAMES.WORKFLOW));
  // Captured here (before createWorkflowStructure + init_developer run) so
  // the three-branch dispatch at the bottom can tell "fresh clone joiner"
  // (.trellis/ exists, .developer missing) apart from "creator first init".
  const hadDeveloperFileAtStart = fs.existsSync(
    path.join(cwd, DIR_NAMES.WORKFLOW, FILE_NAMES.DEVELOPER),
  );

  // Generate ASCII art banner dynamically using FIGlet "Rebel" font
  const banner = figlet.textSync("Trellis", { font: "Rebel" });
  console.log(chalk.cyan(`\n${banner.trimEnd()}`));
  console.log(
    chalk.gray(
      "\n   All-in-one AI framework & toolkit for Claude Code & Cursor\n",
    ),
  );

  // Set up proxy before any network calls
  const proxyUrl = setupProxy();
  if (proxyUrl) {
    console.log(chalk.gray(`   Using proxy: ${maskProxyUrl(proxyUrl)}\n`));
  }

  // Set write mode based on options
  let writeMode: WriteMode = "ask";
  if (options.force) {
    writeMode = "force";
    console.log(chalk.gray("Mode: Force overwrite existing files\n"));
  } else if (options.skipExisting) {
    writeMode = "skip";
    console.log(chalk.gray("Mode: Skip existing files\n"));
  } else if (options.yes) {
    // -y implies non-interactive: never prompt on conflicts. Default to skip
    // (preserve user files) — explicit --force is required to overwrite.
    writeMode = "skip";
    console.log(chalk.gray("Mode: Non-interactive (skip existing files)\n"));
  }
  setWriteMode(writeMode);

  // Detect developer name from git config or options
  let developerName = options.user;
  if (!developerName) {
    // Only detect from git if current directory is a git repo
    const isGitRepo = fs.existsSync(path.join(cwd, ".git"));
    if (isGitRepo) {
      try {
        developerName = execSync("git config user.name", {
          cwd,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Git not available or no user.name configured
      }
    }
  }

  if (developerName) {
    console.log(chalk.blue("👤 Developer:"), chalk.gray(developerName));
  }

  const { command: pythonCmd } = resolveSupportedPython();

  // ==========================================================================
  // Re-init fast path: skip full flow when .trellis/ already exists
  // ==========================================================================

  // Aborted-init recovery (issue #204): if .trellis/ exists but tasks/ is
  // empty, the previous init never reached bootstrap creation. Fall through
  // to the full flow so the main-dispatch tasksEmpty fallback fires —
  // handleReinit's joiner branch would otherwise mis-route the recovery.
  const tasksDirEarly = path.join(cwd, PATHS.TASKS);
  const tasksEmptyEarly =
    !fs.existsSync(tasksDirEarly) || fs.readdirSync(tasksDirEarly).length === 0;

  if (
    !isFirstInit &&
    !options.force &&
    !options.skipExisting &&
    !tasksEmptyEarly
  ) {
    const reinitDone = await handleReinit(
      cwd,
      options,
      developerName,
      pythonCmd,
    );
    if (reinitDone) return;
    // reinitDone === false means user chose "full re-initialize" → fall through
  }

  if (!developerName && !options.yes) {
    // Ask for developer name if not detected and not in yes mode
    console.log(
      chalk.gray(
        "\nTrellis supports team collaboration - each developer has their own\n" +
          `workspace directory (${PATHS.WORKSPACE}/{name}/) to track AI sessions.\n` +
          "Tip: Usually this is your git username (git config user.name).\n",
      ),
    );
    developerName = await askInput("Your name: ");
    while (!developerName) {
      console.log(chalk.yellow("Name is required"));
      developerName = await askInput("Your name: ");
    }
    console.log(chalk.blue("👤 Developer:"), chalk.gray(developerName));
  }

  // Detect project type (silent - no output)
  const detectedType = detectProjectType(cwd);

  // Parse custom registry source early (needed by both monorepo + single-repo flows)
  let registry: RegistrySource | undefined;
  if (options.registry) {
    try {
      registry = parseRegistrySource(options.registry);
    } catch (error) {
      console.log(
        chalk.red(
          error instanceof Error ? error.message : "Invalid registry source",
        ),
      );
      return;
    }
  }

  // Determine template strategy from flags (needed before monorepo template downloads)
  let templateStrategy: TemplateStrategy = "skip";
  if (options.overwrite) {
    templateStrategy = "overwrite";
  } else if (options.append) {
    templateStrategy = "append";
  }

  // ==========================================================================
  // Monorepo Detection
  // ==========================================================================

  let monorepoPackages: DetectedPackage[] | undefined;
  let remoteSpecPackages: Set<string> | undefined;

  if (options.monorepo !== false) {
    // options.monorepo: true = --monorepo, false = --no-monorepo, undefined = auto
    const detected = detectMonorepo(cwd);

    if (options.monorepo === true && !detected) {
      console.log(
        chalk.red(
          "Error: --monorepo specified but no multi-package layout detected.",
        ),
      );
      console.log("");
      console.log(chalk.gray("Checked:"));
      console.log(chalk.gray("  ✗ pnpm-workspace.yaml"));
      console.log(chalk.gray("  ✗ package.json workspaces"));
      console.log(chalk.gray("  ✗ Cargo.toml [workspace]"));
      console.log(chalk.gray("  ✗ go.work"));
      console.log(chalk.gray("  ✗ pyproject.toml [tool.uv.workspace]"));
      console.log(chalk.gray("  ✗ .gitmodules"));
      console.log(chalk.gray("  ✗ sibling .git directories (need ≥ 2)"));
      console.log("");
      console.log("To configure manually, add to .trellis/config.yaml:");
      console.log("");
      console.log(chalk.cyan("  packages:"));
      console.log(chalk.cyan("    frontend:"));
      console.log(chalk.cyan("      path: ./frontend"));
      console.log(chalk.cyan("      git: true       # if it has its own .git"));
      console.log(chalk.cyan("    backend:"));
      console.log(chalk.cyan("      path: ./backend"));
      console.log(chalk.cyan("      git: true"));
      return;
    }

    if (detected && detected.length > 0) {
      let enableMonorepo = false;

      if (options.monorepo === true || options.yes) {
        enableMonorepo = true;
      } else {
        // Show detected packages and ask
        console.log(chalk.blue("\n🔍 Detected monorepo packages:"));
        for (const pkg of detected) {
          const tag = pkg.isSubmodule
            ? chalk.gray(" (submodule)")
            : pkg.isGitRepo
              ? chalk.gray(" (git repo)")
              : "";
          console.log(
            chalk.gray(`   - ${pkg.name}`) +
              chalk.gray(` (${pkg.path})`) +
              chalk.gray(` [${pkg.type}]`) +
              tag,
          );
        }
        console.log("");

        const { useMonorepo } = await inquirer.prompt<{
          useMonorepo: boolean;
        }>([
          {
            type: "confirm",
            name: "useMonorepo",
            message: "Enable monorepo mode?",
            default: true,
          },
        ]);
        enableMonorepo = useMonorepo;
      }

      if (enableMonorepo) {
        monorepoPackages = detected;
        remoteSpecPackages = new Set<string>();

        // Per-package template selection (unless -y mode: all use blank spec)
        if (!options.yes && !options.template) {
          for (const pkg of detected) {
            const { specSource } = await inquirer.prompt<{
              specSource: string;
            }>([
              {
                type: "list",
                name: "specSource",
                message: `Spec source for ${pkg.name} (${pkg.path}):`,
                choices: [
                  { name: "From scratch (Trellis default)", value: "blank" },
                  { name: "Download remote template", value: "remote" },
                ],
                default: "blank",
              },
            ]);

            if (specSource === "remote") {
              // Use existing template download flow, targeting spec/<name>/
              const destDir = path.join(
                cwd,
                PATHS.SPEC,
                sanitizePkgName(pkg.name),
              );
              console.log(chalk.blue(`📦 Select template for ${pkg.name}...`));
              // Fetch templates if not already done
              const templates = await fetchTemplateIndex();
              const specTemplates = templates
                .filter((t) => t.type === "spec")
                .map((t) => ({
                  name: `${t.id} (${t.name})`,
                  value: t.id,
                }));

              if (specTemplates.length > 0) {
                const { templateId } = await inquirer.prompt<{
                  templateId: string;
                }>([
                  {
                    type: "list",
                    name: "templateId",
                    message: `Select template for ${pkg.name}:`,
                    choices: specTemplates,
                  },
                ]);

                const result = await downloadTemplateById(
                  cwd,
                  templateId,
                  templateStrategy,
                  templates.find((t) => t.id === templateId),
                  undefined,
                  destDir,
                );

                if (result.success) {
                  console.log(chalk.green(`   ${result.message}`));
                  remoteSpecPackages.add(sanitizePkgName(pkg.name));
                } else {
                  console.log(chalk.yellow(`   ${result.message}`));
                  console.log(chalk.gray("   Falling back to blank spec..."));
                }
              } else {
                console.log(
                  chalk.gray("   No templates available. Using blank spec."),
                );
              }
            }
          }
        } else if (options.template) {
          // --template as default for all packages
          for (const pkg of detected) {
            const destDir = path.join(
              cwd,
              PATHS.SPEC,
              sanitizePkgName(pkg.name),
            );
            const result = await downloadTemplateById(
              cwd,
              options.template,
              templateStrategy,
              undefined,
              registry,
              destDir,
            );
            if (result.success && !result.skipped) {
              remoteSpecPackages.add(sanitizePkgName(pkg.name));
            }
          }
        }
      }
    }
  }

  // Tool definitions derived from platform registry
  const TOOLS = getInitToolChoices();

  // Build tools from explicit flags
  const explicitTools = TOOLS.filter(
    (t) => options[t.key as keyof InitOptions],
  ).map((t) => t.key);

  let tools: string[];

  if (explicitTools.length > 0) {
    // Explicit flags take precedence (works with or without -y)
    tools = explicitTools;
  } else if (options.yes) {
    // No explicit tools + -y: default to Cursor and Claude
    tools = TOOLS.filter((t) => t.defaultChecked).map((t) => t.key);
  } else {
    // Interactive mode
    const answers = await inquirer.prompt<InitAnswers>([
      {
        type: "checkbox",
        name: "tools",
        message: "Select AI tools to configure:",
        choices: TOOLS.map((t) => ({
          name: t.name,
          value: t.key,
          checked: t.defaultChecked,
        })),
      },
    ]);
    tools = answers.tools;
  }

  // Treat unknown project type as fullstack
  const projectType: ProjectType =
    detectedType === "unknown" ? "fullstack" : detectedType;

  if (tools.length === 0) {
    console.log(
      chalk.yellow("No tools selected. At least one tool is required."),
    );
    return;
  }

  // ==========================================================================
  // Template Selection (single-repo only; monorepo handles templates above)
  // ==========================================================================

  let selectedTemplate: string | null = null;

  // Pre-fetched templates list (used to pass selected SpecTemplate to downloadTemplateById)
  let fetchedTemplates: SpecTemplate[] = [];
  let registryBackend: RegistryBackend | undefined;

  // Determine the index URL based on registry
  const indexUrl = registry
    ? `${registry.rawBaseUrl}/index.json`
    : TEMPLATE_INDEX_URL;

  if (monorepoPackages) {
    // Monorepo: template selection already handled above
  } else if (options.template) {
    // Template specified via --template flag
    selectedTemplate = options.template;
  } else if (!options.yes) {
    // Interactive mode: show template selection
    const timeoutSec = TIMEOUTS.INDEX_FETCH_MS / 1000;
    const sourceLabel = registry ? registry.gigetSource : TEMPLATE_INDEX_URL;
    console.log(
      chalk.gray(`   Fetching available templates from ${sourceLabel}`),
    );
    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed++;
      process.stdout.write(
        `\r${chalk.gray(`   Loading... ${elapsed}s/${timeoutSec}s`)}`,
      );
    }, 1000);
    process.stdout.write(chalk.gray(`   Loading... 0s/${timeoutSec}s`));
    let templates: SpecTemplate[];
    let registryProbeNotFound = false;
    let registryProbeError: Error | undefined;
    if (registry) {
      const probeResult = await probeRegistryIndex(indexUrl, registry);
      templates = probeResult.templates;
      registryProbeNotFound = probeResult.isNotFound;
      registryProbeError = probeResult.error;
      registryBackend = probeResult.backend;
    } else {
      templates = await fetchTemplateIndex(indexUrl);
    }
    clearInterval(ticker);
    // Clear the loading line
    process.stdout.write("\r\x1b[2K");
    fetchedTemplates = templates;

    if (templates.length === 0 && registry && registryProbeNotFound) {
      // Custom registry: confirmed no index.json — will try direct download later
      console.log(
        chalk.gray(
          "   No index.json found at registry. Will download as direct spec template.",
        ),
      );
    } else if (templates.length === 0 && registry) {
      // Custom registry: transient error (not a 404) — abort, don't misclassify
      console.log(
        chalk.red(
          `   ${registryProbeError?.message ?? "Could not reach registry. Check your connection and try again."}`,
        ),
      );
      return;
    } else if (templates.length === 0) {
      console.log(
        chalk.gray(
          "   Could not fetch templates (offline or server unavailable).",
        ),
      );
      console.log(chalk.gray("   Using blank templates.\n"));
    }

    if (templates.length > 0) {
      // Build template choices
      const specTemplates = templates
        .filter((t) => t.type === "spec")
        .map((t) => ({
          name: `${t.id} (${t.name})`,
          value: t.id,
        }));

      const templateChoices = registry
        ? specTemplates
        : [
            {
              name: "from scratch (default)",
              value: "blank",
            },
            ...specTemplates,
            {
              name: "custom (enter a registry source)",
              value: "__custom__",
            },
          ];

      // Loop to allow returning from custom source input back to the picker
      let templatePicked = false;
      while (templateChoices.length > 0 && !templatePicked) {
        const templateAnswer = await inquirer.prompt<{ template: string }>([
          {
            type: "list",
            name: "template",
            message: "Select a spec template:",
            choices: templateChoices,
            default: registry ? undefined : "blank",
          },
        ]);

        if (templateAnswer.template === "__custom__") {
          // Prompt for custom registry source (empty → back to picker)
          const customSource = await askInput(
            "Enter registry source (e.g., gh:myorg/myrepo/specs), or press Enter to go back: ",
          );
          if (!customSource) {
            continue; // Back to picker
          }
          try {
            registry = parseRegistrySource(customSource);
            fetchedTemplates = []; // Reset so direct-download guard works correctly
            // Probe index.json to detect marketplace vs direct download
            const customIndexUrl = `${registry.rawBaseUrl}/index.json`;
            console.log(
              chalk.gray(
                `   Checking for templates at ${registry.gigetSource}...`,
              ),
            );
            const customProbe = await probeRegistryIndex(
              customIndexUrl,
              registry,
            );
            const customTemplates = customProbe.templates;
            registryBackend = customProbe.backend;
            if (customTemplates.length > 0) {
              // Marketplace mode: show picker with custom templates
              fetchedTemplates = customTemplates;
              const customChoices = customTemplates
                .filter((t) => t.type === "spec")
                .map((t) => ({
                  name: `${t.id} (${t.name})`,
                  value: t.id,
                }));
              if (customChoices.length > 0) {
                const customAnswer = await inquirer.prompt<{
                  template: string;
                }>([
                  {
                    type: "list",
                    name: "template",
                    message: "Select a spec template:",
                    choices: customChoices,
                  },
                ]);
                selectedTemplate = customAnswer.template;

                // Check if spec directory already exists and ask what to do
                const specDir = path.join(cwd, PATHS.SPEC);
                if (
                  fs.existsSync(specDir) &&
                  !options.overwrite &&
                  !options.append
                ) {
                  const actionAnswer = await inquirer.prompt<{
                    action: TemplateStrategy;
                  }>([
                    {
                      type: "list",
                      name: "action",
                      message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
                      choices: [
                        { name: "Skip (keep existing)", value: "skip" },
                        {
                          name: "Overwrite (replace all)",
                          value: "overwrite",
                        },
                        {
                          name: "Append (add missing files only)",
                          value: "append",
                        },
                      ],
                      default: "skip",
                    },
                  ]);
                  templateStrategy = actionAnswer.action;
                }
              }
              templatePicked = true;
            } else if (customProbe.isNotFound) {
              // No index.json → direct download mode
              templatePicked = true;
            } else {
              // Transient error (not 404) — loop back, don't misclassify
              console.log(
                chalk.yellow(
                  `   ${customProbe.error?.message ?? "Could not reach registry. Try again or enter a different source."}`,
                ),
              );
              registry = undefined; // Reset so we don't fall through to direct download
            }
          } catch (error) {
            console.log(
              chalk.red(
                error instanceof Error
                  ? error.message
                  : "Invalid registry source",
              ),
            );
            // Loop back to picker
          }
        } else {
          templatePicked = true;
          if (templateAnswer.template !== "blank") {
            selectedTemplate = templateAnswer.template;

            // Check if spec directory already exists and ask what to do
            const specDir = path.join(cwd, PATHS.SPEC);
            if (
              fs.existsSync(specDir) &&
              !options.overwrite &&
              !options.append
            ) {
              const actionAnswer = await inquirer.prompt<{
                action: TemplateStrategy;
              }>([
                {
                  type: "list",
                  name: "action",
                  message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
                  choices: [
                    { name: "Skip (keep existing)", value: "skip" },
                    { name: "Overwrite (replace all)", value: "overwrite" },
                    {
                      name: "Append (add missing files only)",
                      value: "append",
                    },
                  ],
                  default: "skip",
                },
              ]);
              templateStrategy = actionAnswer.action;
            }
          }
        }
      }
    }
  }
  // -y mode with --registry (no --template): probe index.json to detect mode
  // Skip when monorepo mode already handled templates above
  if (options.yes && registry && !selectedTemplate && !monorepoPackages) {
    const probeResult = await probeRegistryIndex(
      `${registry.rawBaseUrl}/index.json`,
      registry,
    );
    registryBackend = probeResult.backend;
    if (probeResult.templates.length > 0) {
      // Marketplace mode requires interactive selection — can't auto-select
      console.log(
        chalk.red(
          "Error: Registry is a marketplace with multiple templates. " +
            "Use --template <id> to specify which one, or remove -y for interactive selection.",
        ),
      );
      return;
    }
    if (!probeResult.isNotFound) {
      // Transient error (not 404) — abort, don't misclassify as direct-download
      console.log(
        chalk.red(
          `Error: ${probeResult.error?.message ?? "Could not reach registry. Check your connection and try again."}`,
        ),
      );
      return;
    }
    // isNotFound=true → no index.json, proceed with direct download (fetchedTemplates stays empty)
  }

  // ==========================================================================
  // Download Remote Template (if selected or direct registry download)
  // ==========================================================================

  let useRemoteTemplate = false;

  if (selectedTemplate) {
    // Marketplace mode: download specific template by ID
    console.log(chalk.blue(`📦 Downloading template "${selectedTemplate}"...`));
    console.log(chalk.gray("   This may take a moment on slow connections."));

    // Find pre-fetched SpecTemplate to avoid double-fetch
    const prefetched = fetchedTemplates.find((t) => t.id === selectedTemplate);

    const result = await downloadTemplateById(
      cwd,
      selectedTemplate,
      templateStrategy,
      prefetched,
      registry,
      undefined,
      registryBackend,
    );

    if (result.success) {
      if (result.skipped) {
        console.log(chalk.gray(`   ${result.message}`));
      } else {
        console.log(chalk.green(`   ${result.message}`));
        useRemoteTemplate = true;
      }
    } else {
      console.log(chalk.yellow(`   ${result.message}`));
      console.log(chalk.gray("   Falling back to blank templates..."));
      const retryCmd = registry
        ? `trellis init --registry ${registry.gigetSource} --template ${selectedTemplate}`
        : `trellis init --template ${selectedTemplate}`;
      console.log(chalk.gray(`   You can retry later: ${retryCmd}`));
    }
  } else if (registry && fetchedTemplates.length === 0) {
    // Direct download mode: registry has no index.json, download directory directly
    console.log(
      chalk.blue(`📦 Downloading spec from ${registry.gigetSource}...`),
    );
    console.log(chalk.gray("   This may take a moment on slow connections."));

    // Ask about existing spec dir in interactive mode
    if (!options.yes && !options.overwrite && !options.append) {
      const specDir = path.join(cwd, PATHS.SPEC);
      if (fs.existsSync(specDir)) {
        const actionAnswer = await inquirer.prompt<{
          action: TemplateStrategy;
        }>([
          {
            type: "list",
            name: "action",
            message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
            choices: [
              { name: "Skip (keep existing)", value: "skip" },
              { name: "Overwrite (replace all)", value: "overwrite" },
              { name: "Append (add missing files only)", value: "append" },
            ],
            default: "skip",
          },
        ]);
        templateStrategy = actionAnswer.action;
      }
    }

    const result = await downloadRegistryDirect(
      cwd,
      registry,
      templateStrategy,
      undefined,
      registryBackend,
    );

    if (result.success) {
      if (result.skipped) {
        console.log(chalk.gray(`   ${result.message}`));
      } else {
        console.log(chalk.green(`   ${result.message}`));
        useRemoteTemplate = true;
      }
    } else {
      console.log(chalk.yellow(`   ${result.message}`));
      console.log(chalk.gray("   Falling back to blank templates..."));
      console.log(
        chalk.gray(
          `   You can retry later: trellis init --registry ${registry.gigetSource}`,
        ),
      );
    }
  }

  // ==========================================================================
  // Resolve workflow template (default: native bundled)
  // ==========================================================================

  const workflowIdInput = options.workflow?.trim();
  const workflowId =
    workflowIdInput && workflowIdInput.length > 0
      ? workflowIdInput
      : NATIVE_WORKFLOW_ID;
  let workflowMdOverride: string | undefined;
  if (workflowId !== NATIVE_WORKFLOW_ID || options.workflowSource) {
    const resolved = await resolveWorkflowTemplate(workflowId, {
      source: options.workflowSource,
    });
    if (resolved.id !== NATIVE_WORKFLOW_ID) {
      workflowMdOverride = resolved.content;
      console.log(
        chalk.blue(`🧭 Using workflow template: ${chalk.cyan(resolved.id)}`),
      );
    }
  }

  // ==========================================================================
  // Create Workflow Structure
  // ==========================================================================

  // Record every successful write from here through createRootFiles. The
  // captured set is the source of truth for `.template-hashes.json`'s
  // platform/root entries — replacing the previous "walk every managed dir"
  // approach that swept user-owned runtime files into the manifest
  // (.codex/sessions/, .claude/projects/, pre-existing AGENTS.md).
  const writtenPaths = startRecordingWrites(cwd);
  try {
    // Create workflow structure with project type
    console.log(chalk.blue("📁 Creating workflow structure..."));
    await createWorkflowStructure(cwd, {
      projectType,
      skipSpecTemplates: useRemoteTemplate,
      packages: monorepoPackages,
      remoteSpecPackages,
      workflowMdOverride,
    });

    // Write monorepo packages to config.yaml (non-destructive patch)
    if (monorepoPackages) {
      writeMonorepoConfig(cwd, monorepoPackages);
      console.log(chalk.blue("📦 Monorepo packages written to config.yaml"));
    }

    // Write version file for update tracking
    const versionPath = path.join(cwd, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, VERSION);

    // Configure selected tools by copying entire directories (dogfooding)
    for (const tool of tools) {
      const platformId = resolveCliFlag(tool);
      if (platformId) {
        console.log(
          chalk.blue(`📝 Configuring ${AI_TOOLS[platformId].name}...`),
        );
        await configurePlatform(platformId, cwd);
      }
    }

    const pythonPlatforms = getPlatformsWithPythonHooks();
    const hasSelectedPythonPlatform = pythonPlatforms.some((id) =>
      tools.includes(AI_TOOLS[id].cliFlag),
    );
    if (hasSelectedPythonPlatform) {
      logPythonAdaptationNotice(pythonCmd);
    }

    // Create root files (skip if exists)
    await createRootFiles(cwd);
  } finally {
    stopRecordingWrites();
  }

  // Initialize template hashes for modification tracking
  const hashedCount = initializeHashes(cwd, { trackedPaths: writtenPaths });
  if (hashedCount > 0) {
    console.log(
      chalk.gray(`📋 Tracking ${hashedCount} template files for updates`),
    );
  }

  // Non-native workflow is user-managed local content. Drop the
  // `.trellis/workflow.md` hash entry so `trellis update` classifies it as
  // modified and does not silently restore native bytes. See design.md
  // "Durable-state contract".
  if (workflowMdOverride !== undefined && workflowId !== NATIVE_WORKFLOW_ID) {
    removeHash(cwd, PATHS.WORKFLOW_GUIDE_FILE);
  }

  // Initialize developer identity (silent - no output)
  if (developerName) {
    let developerInitialized = false;
    try {
      const scriptPath = path.join(cwd, PATHS.SCRIPTS, "init_developer.py");
      execSync(`${pythonCmd} "${scriptPath}" "${developerName}"`, {
        cwd,
        stdio: "pipe", // Silent
      });
      developerInitialized = true;
    } catch {
      // Silent failure - user can run init_developer.py manually
    }

    if (developerInitialized && getConfiguredPlatforms(cwd).has("claude-code")) {
      try {
        ensureInitialTrellisSwitch(cwd, developerName);
      } catch {
        // Silent failure
      }
    }

    // Three-branch dispatch using flags captured at init() start (before
    // createWorkflowStructure/init_developer ran, so they reflect the disk
    // state of the user's checkout, not the state this init just produced):
    //   isFirstInit=true                       → creator bootstrap (new project)
    //   isFirstInit=false + no .developer file → joiner onboarding (fresh clone)
    //   isFirstInit=false + .developer exists  → same-dev re-init, no task
    //
    // Tasks-empty fallback (issue #204): if .trellis/ exists but tasks dir is
    // empty, the previous init aborted before creating the bootstrap task. Run
    // bootstrap creation regardless of isFirstInit. writeTaskSkeleton is
    // idempotent so repeated triggers are safe.
    //
    // Runs OUTSIDE the init_developer try/catch (which uses stdio: "pipe")
    // so joiner failures surface as warnings instead of being silently
    // swallowed.
    const tasksDir = path.join(cwd, PATHS.TASKS);
    const tasksEmpty =
      !fs.existsSync(tasksDir) || fs.readdirSync(tasksDir).length === 0;

    if (isFirstInit || tasksEmpty) {
      createBootstrapTask(
        cwd,
        developerName,
        pythonCmd,
        projectType,
        monorepoPackages,
      );
    } else if (!hadDeveloperFileAtStart) {
      try {
        if (!createJoinerOnboardingTask(cwd, developerName, pythonCmd)) {
          console.warn(
            chalk.yellow("⚠ Failed to create joiner onboarding task"),
          );
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠ Joiner onboarding setup failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }
}

/**
 * Simple readline-based input (no flickering like inquirer)
 */
function askInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function createRootFiles(cwd: string): Promise<void> {
  const agentsPath = path.join(cwd, FILE_NAMES.AGENTS);

  // Write AGENTS.md from template
  const agentsWritten = await writeFile(agentsPath, agentsMdContent);
  if (agentsWritten) {
    console.log(chalk.blue("📄 Created AGENTS.md"));
  }
}
