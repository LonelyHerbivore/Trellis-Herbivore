import { parse as parseToml } from "@iarna/toml";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import inquirer from "inquirer";

const USER_CONFIG_KEY = "default_mode_request_user_input";
const CC_SWITCH_KEY = "common_config_codex";
const CC_SWITCH_READ_SCRIPT = [
  "import json",
  "import sqlite3",
  "import sys",
  "from pathlib import Path",
  "",
  "try:",
  "    uri = Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'",
  "    connection = sqlite3.connect(uri, uri=True)",
  "    row = connection.execute('SELECT value FROM settings WHERE key = ?', ('common_config_codex',)).fetchone()",
  "    connection.close()",
  "    print(json.dumps({'ok': True, 'exists': row is not None, 'value': row[0] if row else ''}))",
  "except Exception as error:",
  "    print(json.dumps({'ok': False, 'error': str(error)}))",
].join("\n");
const CC_SWITCH_WRITE_SCRIPT = [
  "import base64",
  "import json",
  "import sqlite3",
  "import sys",
  "",
  "try:",
  "    database_path, backup_path, encoded_value, expected_exists, encoded_expected_value = sys.argv[1:6]",
  "    value = base64.b64decode(encoded_value).decode('utf-8')",
  "    expected_value = base64.b64decode(encoded_expected_value).decode('utf-8')",
  "    expected_exists = expected_exists == '1'",
  "    source = sqlite3.connect(database_path)",
  "    source.execute('BEGIN IMMEDIATE')",
  "    row = source.execute('SELECT value FROM settings WHERE key = ?', ('common_config_codex',)).fetchone()",
  "    exists = row is not None",
  "    if exists != expected_exists or (exists and row[0] != expected_value):",
  "        source.rollback()",
  "        source.close()",
  "        print(json.dumps({'ok': False, 'conflict': True, 'error': 'cc-switch 配置在确认后发生变化'}))",
  "    else:",
  "        backup_source = sqlite3.connect(database_path)",
  "        backup = sqlite3.connect(backup_path)",
  "        backup_source.backup(backup)",
  "        backup.close()",
  "        backup_source.close()",
  "        if exists:",
  "            source.execute('UPDATE settings SET value = ? WHERE key = ?', (value, 'common_config_codex'))",
  "        else:",
  "            source.execute('INSERT INTO settings(key, value) VALUES (?, ?)', ('common_config_codex', value))",
  "        source.commit()",
  "        source.close()",
  "        print(json.dumps({'ok': True}))",
  "except Exception as error:",
  "    print(json.dumps({'ok': False, 'error': str(error)}))",
].join("\n");

export type CodexUserConfigStatus =
  | "already-enabled"
  | "enabled"
  | "dry-run"
  | "declined"
  | "conflict"
  | "non-interactive"
  | "failed";

export type CodexHooksStatus = "enabled" | "disabled" | "missing" | "unknown";

type ConfigPlanState =
  | "already-enabled"
  | "needs-write"
  | "conflict"
  | "malformed";

interface ConfigPlan {
  state: ConfigPlanState;
  content: string;
  hooksStatus: CodexHooksStatus;
  reason?: string;
}

export interface CodexUserConfigResult {
  status: CodexUserConfigStatus;
  source: "cc-switch" | "codex-config" | "undetermined";
  target: string;
  backupPath?: string;
  hooksStatus: CodexHooksStatus;
  message?: string;
}

export interface EnsureCodexRequestUserInputOptions {
  interactive: boolean;
  dryRun?: boolean;
  homeDir?: string;
  pythonCommand?: string;
}

function normalizeLines(content: string): {
  lines: string[];
  eol: string;
  trailingNewline: boolean;
} {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = content.endsWith("\n");
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  return { lines, eol, trailingNewline };
}

function renderLines(lines: string[], eol: string, trailingNewline: boolean): string {
  const output = lines.join(eol);
  return trailingNewline || lines.length === 0 ? output + eol : output;
}

interface TomlValidation {
  hasFeatures: boolean;
  featuresKind: "missing" | "table" | "other";
  target: "missing" | "true" | "false" | "other";
  hooksStatus: CodexHooksStatus;
}

function createMalformedPlan(content: string, reason: string): ConfigPlan {
  return {
    state: "malformed",
    content,
    hooksStatus: "unknown",
    reason,
  };
}

function containsTomlMultilineValue(content: string): boolean {
  return content.includes('"""') || content.includes("'''");
}

function startsTomlMultilineArray(line: string): boolean {
  const equalsIndex = line.indexOf("=");
  if (equalsIndex < 0) return false;
  const value = line.slice(equalsIndex + 1).trim();
  return value.startsWith("[") && !value.includes("]");
}

function isTomlTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateTomlContent(
  content: string,
): { ok: true; value: TomlValidation } | { ok: false; reason: string } {
  try {
    const document = parseToml(content) as Record<string, unknown>;
    const hasFeatures = Object.hasOwn(document, "features");
    const features = document.features;
    let featuresKind: TomlValidation["featuresKind"] = "missing";
    let target: TomlValidation["target"] = "missing";
    let hooksStatus: CodexHooksStatus = "missing";

    if (hasFeatures) {
      if (!isTomlTable(features)) {
        featuresKind = "other";
      } else {
        featuresKind = "table";
        if (Object.hasOwn(features, USER_CONFIG_KEY)) {
          const value = features[USER_CONFIG_KEY];
          target = value === true ? "true" : value === false ? "false" : "other";
        }

        let disabled = false;
        let unknown = false;
        for (const key of ["hooks", "codex_hooks"]) {
          if (!Object.hasOwn(features, key)) continue;
          const value = features[key];
          if (value === true) {
            hooksStatus = "enabled";
            break;
          }
          if (value === false) {
            disabled = true;
          } else {
            unknown = true;
          }
        }
        if (hooksStatus !== "enabled") {
          hooksStatus = unknown ? "unknown" : disabled ? "disabled" : "missing";
        }
      }
    }

    return {
      ok: true,
      value: { hasFeatures, featuresKind, target, hooksStatus },
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        "无法安全验证 TOML 语法：" +
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

export async function planCodexRequestUserInputPatch(
  content: string,
): Promise<ConfigPlan> {
  const validation = validateTomlContent(content);
  if (!validation.ok) return createMalformedPlan(content, validation.reason);

  if (containsTomlMultilineValue(content)) {
    return createMalformedPlan(
      content,
      "检测到多行 TOML 字符串；为避免覆盖，拒绝自动修改。",
    );
  }

  const normalized = normalizeLines(content);
  const lines = normalized.lines;
  const sections: number[] = [];
  const featureTables: number[] = [];
  const exactFeaturesTable = /^\[\s*features\s*\]\s*(?:#.*)?$/;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (startsTomlMultilineArray(lines[index])) {
      return createMalformedPlan(
        content,
        "检测到多行 TOML array；为避免覆盖，拒绝自动修改。",
      );
    }
    if (trimmed.startsWith("[")) {
      sections.push(index);
      if (exactFeaturesTable.test(trimmed)) featureTables.push(index);
    }
  }

  if (validation.value.hasFeatures) {
    if (validation.value.featuresKind !== "table" || featureTables.length !== 1) {
      return {
        state: "conflict",
        content,
        hooksStatus: "unknown",
        reason: "检测到无法安全定位的 features 配置，无法合并 [features] table。",
      };
    }
  } else if (featureTables.length > 0) {
    return createMalformedPlan(content, "TOML features section 与验证结果不一致。");
  }

  if (!validation.value.hasFeatures) {
    const nextLines = [...lines];
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push("[features]", USER_CONFIG_KEY + " = true");
    return {
      state: "needs-write",
      content: renderLines(
        nextLines,
        normalized.eol,
        normalized.trailingNewline || content.length === 0,
      ),
      hooksStatus: "missing",
    };
  }

  const featuresStart = featureTables[0];
  const nextSection = sections.find((section) => section > featuresStart);
  const featuresEnd = nextSection ?? lines.length;

  if (validation.value.target === "true") {
    const bareTargetPattern = new RegExp(
      "^\\s*" + USER_CONFIG_KEY + "\\s*=\\s*true\\s*(?:#.*)?$",
    );
    const bareTargetCount = lines
      .slice(featuresStart + 1, featuresEnd)
      .filter((line) => bareTargetPattern.test(line)).length;
    if (bareTargetCount !== 1) {
      return {
        state: "conflict",
        content,
        hooksStatus: validation.value.hooksStatus,
        reason: "现有 " + USER_CONFIG_KEY + " 不是可安全定位的裸键 true 值。",
      };
    }
    return {
      state: "already-enabled",
      content,
      hooksStatus: validation.value.hooksStatus,
    };
  }
  if (validation.value.target !== "missing") {
    return {
      state: "conflict",
      content,
      hooksStatus: validation.value.hooksStatus,
      reason: "现有 " + USER_CONFIG_KEY + " 不是唯一的 true 值。",
    };
  }
  const nextLines = [
    ...lines.slice(0, featuresEnd),
    USER_CONFIG_KEY + " = true",
    ...lines.slice(featuresEnd),
  ];
  return {
    state: "needs-write",
    content: renderLines(nextLines, normalized.eol, normalized.trailingNewline),
    hooksStatus: validation.value.hooksStatus,
  };
}

function parsePythonCommand(preferred: string): { command: string; args: string[] } | undefined {
  const trimmed = preferred.trim();
  if (!trimmed) return undefined;

  const quoted = trimmed.match(/^"([^"]+)"(?:\s+(.*))?$/);
  if (quoted) {
    return {
      command: quoted[1],
      args: quoted[2] ? quoted[2].trim().split(/\s+/) : [],
    };
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { command: trimmed, args: [] };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts.shift();
  return command ? { command, args: parts } : undefined;
}

function getPythonCandidates(preferred?: string): { command: string; args: string[] }[] {
  const candidates: { command: string; args: string[] }[] = [];
  if (preferred?.trim()) {
    const parsed = parsePythonCommand(preferred);
    if (parsed) candidates.push(parsed);
  }
  if (process.platform === "win32") candidates.push({ command: "py", args: ["-3"] });
  candidates.push({ command: "python3", args: [] }, { command: "python", args: [] });
  return candidates;
}

function runPython(
  script: string,
  args: string[],
  preferred?: string,
  input?: string,
): { ok: true; output: string } | { ok: false; message: string } {
  let lastMessage = "未找到可用的 Python 3。";
  for (const candidate of getPythonCandidates(preferred)) {
    try {
      const output = execFileSync(candidate.command, [...candidate.args, "-c", script, ...args], {
        encoding: "utf8",
        input,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      return { ok: true, output };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, message: lastMessage };
}

interface CcSwitchSnapshot {
  exists: boolean;
  content: string;
}

function readCcSwitchConfig(
  databasePath: string,
  pythonCommand?: string,
):
  | { available: true; snapshot: CcSwitchSnapshot }
  | { available: false; message: string } {
  const execution = runPython(CC_SWITCH_READ_SCRIPT, [databasePath], pythonCommand);
  if (!execution.ok) return { available: false, message: execution.message };
  try {
    const parsed = JSON.parse(execution.output) as {
      ok?: boolean;
      exists?: unknown;
      value?: unknown;
      error?: unknown;
    };
    if (!parsed.ok || typeof parsed.exists !== "boolean") {
      return {
        available: false,
        message: String(parsed.error ?? "无法读取 cc-switch 配置。"),
      };
    }
    return {
      available: true,
      snapshot: {
        exists: parsed.exists,
        content: typeof parsed.value === "string" ? parsed.value : "",
      },
    };
  } catch (error) {
    return {
      available: false,
      message: error instanceof Error ? error.message : "cc-switch 返回了无效结果。",
    };
  }
}

function writeCcSwitchConfig(
  databasePath: string,
  backupPath: string,
  content: string,
  expected: CcSwitchSnapshot,
  pythonCommand?: string,
): { ok: true } | { ok: false; conflict: boolean; message: string } {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const expectedContent = Buffer.from(expected.content, "utf8").toString("base64");
  const execution = runPython(
    CC_SWITCH_WRITE_SCRIPT,
    [
      databasePath,
      backupPath,
      encoded,
      expected.exists ? "1" : "0",
      expectedContent,
    ],
    pythonCommand,
  );
  if (!execution.ok) {
    return { ok: false, conflict: false, message: execution.message };
  }
  try {
    const parsed = JSON.parse(execution.output) as {
      ok?: boolean;
      conflict?: unknown;
      error?: unknown;
    };
    return parsed.ok
      ? { ok: true }
      : {
          ok: false,
          conflict: parsed.conflict === true,
          message: String(parsed.error ?? "无法写入 cc-switch 配置。"),
        };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      message: error instanceof Error ? error.message : "cc-switch 返回了无效结果。",
    };
  }
}

function getBackupPath(targetPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return targetPath + ".trellis-backup-" + timestamp + "-" + String(process.pid);
}

function printManualGuidance(
  target: string,
  reason: string,
  source?: "cc-switch" | "codex-config",
): void {
  console.warn("⚠️  未修改 Codex 用户级配置：" + reason);
  if (source === "cc-switch") {
    console.warn(
      "   请通过 cc-switch 的 Codex 通用配置（settings." +
        CC_SWITCH_KEY +
        "）在 [features] 中设置 " +
        USER_CONFIG_KEY +
        " = true。",
    );
    return;
  }
  console.warn("   请在 " + target + " 的 [features] 中设置 " + USER_CONFIG_KEY + " = true。");
}

function reportHooksFallback(status: CodexHooksStatus): void {
  if (status === "enabled") return;

  const reason =
    status === "disabled"
      ? "用户级配置中的 hooks feature 已关闭"
      : status === "missing"
        ? "未检测到已启用的 hooks feature"
        : "无法安全确认 hooks feature 状态";
  console.warn("⚠️  " + reason + "。");
  console.warn(
    "   hooks 自动注入不可用或尚未在 /hooks 中批准时，请遵循项目 AGENTS.md 并调用 $trellis-start。",
  );
}

function buildResult(
  status: CodexUserConfigStatus,
  source: "cc-switch" | "codex-config" | "undetermined",
  target: string,
  plan: ConfigPlan,
  backupPath?: string,
  message?: string,
): CodexUserConfigResult {
  const result = {
    status,
    source,
    target,
    backupPath,
    hooksStatus: plan.hooksStatus,
    message,
  };
  if (status !== "dry-run") reportHooksFallback(plan.hooksStatus);
  return result;
}

async function requestWriteConfirmation(
  source: "cc-switch" | "codex-config",
  target: string,
  backupPath: string,
  plan: ConfigPlan,
  options: EnsureCodexRequestUserInputOptions,
): Promise<"confirmed" | CodexUserConfigResult> {
  console.log("\nCodex 用户级设置检查：");
  console.log("  目标：" + target);
  console.log("  拟写入：[features]." + USER_CONFIG_KEY + " = true");
  console.log(
    "  拟备份：" +
      backupPath +
      "（" +
      (source === "cc-switch" ? "SQLite backup" : "原文件副本") +
      "）",
  );

  if (!options.interactive) {
    printManualGuidance(target, "当前为非交互模式，无法获得独立确认。", source);
    return buildResult("non-interactive", source, target, plan);
  }

  try {
    const answer = await inquirer.prompt<{ apply: boolean }>([
      {
        type: "confirm",
        name: "apply",
        message: "确认写入这项 Codex 用户级设置？",
        default: false,
      },
    ]);
    if (!answer.apply) {
      printManualGuidance(target, "用户拒绝写入。", source);
      return buildResult("declined", source, target, plan);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printManualGuidance(target, "无法显示独立确认提示：" + message, source);
    return buildResult("failed", source, target, plan, undefined, message);
  }

  return "confirmed";
}

async function ensureCodexConfigFile(
  home: string,
  options: EnsureCodexRequestUserInputOptions,
): Promise<CodexUserConfigResult> {
  const configPath = path.join(home, ".codex", "config.toml");
  let existing = "";
  try {
    if (existsSync(configPath)) existing = readFileSync(configPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const plan: ConfigPlan = {
      state: "malformed",
      content: "",
      hooksStatus: "unknown",
      reason: message,
    };
    printManualGuidance(configPath, message);
    return buildResult(
      "failed",
      "codex-config",
      configPath,
      plan,
      undefined,
      message,
    );
  }

  const plan = await planCodexRequestUserInputPatch(existing);
  if (plan.state === "already-enabled") {
    console.log("✓ Codex 用户级 default_mode_request_user_input 已启用。");
    return buildResult("already-enabled", "codex-config", configPath, plan);
  }
  if (plan.state === "conflict" || plan.state === "malformed") {
    printManualGuidance(configPath, plan.reason ?? "配置格式存在冲突。");
    return buildResult(
      "conflict",
      "codex-config",
      configPath,
      plan,
      undefined,
      plan.reason,
    );
  }

  const backupPath = getBackupPath(configPath);
  const confirmation = await requestWriteConfirmation(
    "codex-config",
    configPath,
    backupPath,
    plan,
    options,
  );
  if (confirmation !== "confirmed") return confirmation;

  let latest = "";
  try {
    if (existsSync(configPath)) latest = readFileSync(configPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printManualGuidance(configPath, message);
    return buildResult(
      "failed",
      "codex-config",
      configPath,
      plan,
      undefined,
      message,
    );
  }
  if (latest !== existing) {
    const latestPlan = await planCodexRequestUserInputPatch(latest);
    const message = "配置在确认期间发生变化，为避免覆盖已取消自动写入。";
    printManualGuidance(configPath, message);
    return buildResult(
      "failed",
      "codex-config",
      configPath,
      latestPlan,
      undefined,
      message,
    );
  }

  let backupCreated = false;
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    if (existsSync(configPath)) copyFileSync(configPath, backupPath, 0);
    else writeFileSync(backupPath, "", { encoding: "utf8", flag: "wx" });
    backupCreated = true;
    writeFileSync(configPath, plan.content, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printManualGuidance(configPath, message);
    return buildResult(
      "failed",
      "codex-config",
      configPath,
      plan,
      backupCreated ? backupPath : undefined,
      message,
    );
  }

  console.log("✓ 已补齐 Codex 用户级 default_mode_request_user_input 设置。\n");
  return buildResult("enabled", "codex-config", configPath, plan, backupPath);
}

export async function ensureCodexRequestUserInput(
  options: EnsureCodexRequestUserInputOptions,
): Promise<CodexUserConfigResult> {
  const home = options.homeDir ?? homedir();
  if (options.dryRun) {
    const ccSwitchPath = path.join(home, ".cc-switch", "cc-switch.db");
    const configPath = path.join(home, ".codex", "config.toml");
    console.log("\nCodex 用户级设置检查：");
    console.log("  目标：" + ccSwitchPath + "（优先）或 " + configPath);
    console.log("  拟写入：[features]." + USER_CONFIG_KEY + " = true");
    console.log("  拟备份：目标文件相邻的 .trellis-backup-<timestamp>-<pid>");
    console.log("  [Dry run] 不会读取、备份、写入配置或发起确认。\n");
    return {
      status: "dry-run",
      source: "undetermined",
      target: ccSwitchPath + " (preferred) or " + configPath,
      hooksStatus: "unknown",
    };
  }

  const databasePath = path.join(home, ".cc-switch", "cc-switch.db");
  if (existsSync(databasePath)) {
    const read = readCcSwitchConfig(databasePath, options.pythonCommand);
    if (read.available) {
      const plan = await planCodexRequestUserInputPatch(read.snapshot.content);
      const target = databasePath + " (settings." + CC_SWITCH_KEY + ")";
      if (plan.state === "already-enabled") {
        console.log("✓ Codex 用户级 default_mode_request_user_input 已启用。");
        return buildResult("already-enabled", "cc-switch", target, plan);
      }
      if (plan.state === "conflict" || plan.state === "malformed") {
        printManualGuidance(target, plan.reason ?? "配置格式存在冲突。", "cc-switch");
        return buildResult(
          "conflict",
          "cc-switch",
          target,
          plan,
          undefined,
          plan.reason,
        );
      }

      const backupPath = getBackupPath(databasePath);
      const confirmation = await requestWriteConfirmation(
        "cc-switch",
        target,
        backupPath,
        plan,
        options,
      );
      if (confirmation !== "confirmed") return confirmation;

      const latest = readCcSwitchConfig(databasePath, options.pythonCommand);
      if (!latest.available) {
        const message = "确认后无法重新读取 cc-switch 配置：" + latest.message;
        printManualGuidance(target, message, "cc-switch");
        return buildResult(
          "failed",
          "cc-switch",
          target,
          plan,
          undefined,
          message,
        );
      }
      if (
        latest.snapshot.exists !== read.snapshot.exists ||
        latest.snapshot.content !== read.snapshot.content
      ) {
        const latestPlan = await planCodexRequestUserInputPatch(
          latest.snapshot.content,
        );
        const message = "配置在确认期间发生变化，为避免覆盖已取消自动写入。";
        printManualGuidance(target, message, "cc-switch");
        return buildResult(
          "failed",
          "cc-switch",
          target,
          latestPlan,
          undefined,
          message,
        );
      }

      const written = writeCcSwitchConfig(
        databasePath,
        backupPath,
        plan.content,
        read.snapshot,
        options.pythonCommand,
      );
      if (written.ok) {
        console.log("✓ 已补齐 Codex 用户级 default_mode_request_user_input 设置。\n");
        return buildResult("enabled", "cc-switch", target, plan, backupPath);
      }

      if (written.conflict) {
        const message = "cc-switch 配置在确认后发生变化，为避免覆盖已取消自动写入。";
        printManualGuidance(target, message, "cc-switch");
        return buildResult(
          "failed",
          "cc-switch",
          target,
          plan,
          undefined,
          message,
        );
      }

      console.warn(
        "⚠️  无法写入 cc-switch 配置，将改用 ~/.codex/config.toml：" +
          written.message,
      );
      return ensureCodexConfigFile(home, options);
    }

    console.warn(
      "⚠️  无法读取 cc-switch 配置，将回退至 ~/.codex/config.toml：" +
        read.message,
    );
  }

  return ensureCodexConfigFile(home, options);
}
