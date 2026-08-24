import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { execFileSync } from "node:child_process";

const childProcessActual = vi.hoisted(() => ({
  execFileSync: undefined as
    | typeof import("node:child_process").execFileSync
    | undefined,
}));

const fsWriteFailure = vi.hoisted(() => ({
  targetPath: undefined as string | undefined,
  code: undefined as "EACCES" | "EPERM" | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = ((
    filePath: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    writeOptions?: fs.WriteFileOptions,
  ) => {
    if (String(filePath) === fsWriteFailure.targetPath) {
      const error = new Error(
        (fsWriteFailure.code ?? "EACCES") + ": permission denied",
      ) as NodeJS.ErrnoException;
      error.code = fsWriteFailure.code ?? "EACCES";
      throw error;
    }
    return actual.writeFileSync(filePath, data, writeOptions);
  }) as typeof actual.writeFileSync;

  return {
    ...actual,
    writeFileSync,
    default: { ...actual.default, writeFileSync },
  };
});

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  childProcessActual.execFileSync = actual.execFileSync;
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import {
  ensureCodexRequestUserInput,
  planCodexRequestUserInputPatch,
} from "../../src/utils/codex-user-config.js";

const noop = (): void => undefined;

function mockPythonResponses(
  readContent: string,
  writeResponse: string,
): void {
  vi.mocked(execFileSync).mockImplementation(
    ((_command: string, args: readonly string[] = []) => {
      const scriptIndex = args.indexOf("-c");
      const script = scriptIndex >= 0 ? args[scriptIndex + 1] : "";
      if (script.includes("BEGIN IMMEDIATE")) return writeResponse;
      if (script.includes("SELECT value FROM settings")) {
        return JSON.stringify({ ok: true, exists: true, value: readContent });
      }
      throw new Error("unexpected Python script");
    }) as typeof execFileSync,
  );
}

describe("planCodexRequestUserInputPatch", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("adds the setting to an empty config", async () => {
    const plan = await planCodexRequestUserInputPatch("");

    expect(plan.state).toBe("needs-write");
    expect(plan.content).toBe(
      "[features]\ndefault_mode_request_user_input = true\n",
    );
    expect(plan.hooksStatus).toBe("missing");
  });

  it("validates TOML without invoking Python", async () => {
    const plan = await planCodexRequestUserInputPatch(
      "[features]\nhooks = false\n",
    );

    expect(plan).toMatchObject({
      state: "needs-write",
      hooksStatus: "disabled",
    });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("preserves CRLF, comments, other features, and array tables", async () => {
    const content =
      "# user setting\r\n" +
      "[features]\r\n" +
      "hooks = true\r\n" +
      "other_feature = false # keep\r\n" +
      "\r\n" +
      "[[agents]]\r\n" +
      "name = \"review\"\r\n";
    const plan = await planCodexRequestUserInputPatch(content);

    expect(plan.state).toBe("needs-write");
    expect(plan.hooksStatus).toBe("enabled");
    expect(plan.content).toBe(
      "# user setting\r\n" +
        "[features]\r\n" +
        "hooks = true\r\n" +
        "other_feature = false # keep\r\n" +
        "\r\n" +
        "default_mode_request_user_input = true\r\n" +
        "[[agents]]\r\n" +
        "name = \"review\"\r\n",
    );
  });

  it("accepts unrelated dotted and quoted tables before adding a features section", async () => {
    const content =
      String.raw`["projects\U0001F600"]
trust_level = "trusted"
` +
      "\n" +
      "[profiles.foo]\n" +
      'mode = "review"\n';
    const plan = await planCodexRequestUserInputPatch(content);

    expect(plan.state).toBe("needs-write");
    expect(plan.content).toBe(
      content + "\n[features]\ndefault_mode_request_user_input = true\n",
    );
  });

  it("recognizes true and rejects ambiguous features ownership without changing content", async () => {
    expect(
      (await planCodexRequestUserInputPatch(
        "[features]\ndefault_mode_request_user_input = true\n"
      )).state,
    ).toBe("already-enabled");

    for (const content of [
      "[features]\ndefault_mode_request_user_input = false\n",
      '["features"]\nother = true\n',
      "[features.default_mode_request_user_input]\nvalue = true\n",
      "[[features.default_mode_request_user_input]]\nvalue = true\n",
      "[features]\ndefault_mode_request_user_input.child = true\n",
      "features.default_mode_request_user_input.child = true\n",
      "features.hooks = true\n",
      '[features]\n"default_mode_request_user_input" = true\n',
      "features = { hooks = true }\n",
    ]) {
      const plan = await planCodexRequestUserInputPatch(content);
      expect(["malformed", "conflict"]).toContain(plan.state);
      expect(plan.content).toBe(content);
    }

    const quotedKeyContent = '[features]\n"default_mode_request_user_input" = true\n';
    const quotedKeyPlan = await planCodexRequestUserInputPatch(quotedKeyContent);
    expect(quotedKeyPlan.state).toBe("conflict");
    expect(quotedKeyPlan.content).toBe(quotedKeyContent);
  });

  it("rejects syntax errors and editor-unsafe multiline values", async () => {
    for (const content of [
      "[features\nx = true\n",
      "not valid = =\n",
      'other = "unterminated\n',
      "other = # comment\n",
      "other = true trailing\n",
      "other = { invalid\n",
      "notes = \"\"\"\nvalid = text\n\"\"\"\n[features]\nother = true\n",
      "items = [\n  \"value\",\n]\n[features]\nother = true\n",
    ]) {
      const plan = await planCodexRequestUserInputPatch(content);
      expect(plan.state).toBe("malformed");
      expect(plan.content).toBe(content);
    }
  });
});

describe("ensureCodexRequestUserInput", () => {
  let homeDir: string;

  function configPath(): string {
    return path.join(homeDir, ".codex", "config.toml");
  }

  function options(
    overrides: {
      dryRun?: boolean;
      interactive?: boolean;
      pythonCommand?: string;
    } = {},
  ) {
    return {
      homeDir,
      pythonCommand: overrides.pythonCommand ?? "fake-python",
      interactive: overrides.interactive ?? true,
      dryRun: overrides.dryRun,
    };
  }

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-codex-user-config-"));
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "warn").mockImplementation(noop);
    vi.mocked(inquirer.prompt).mockReset();
    vi.mocked(inquirer.prompt).mockResolvedValue({ apply: true });
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("writes a missing TOML config only after confirmation and creates a backup", async () => {
    const result = await ensureCodexRequestUserInput(options());

    expect(result.status).toBe("enabled");
    expect(result.source).toBe("codex-config");
    expect(fs.readFileSync(configPath(), "utf8")).toBe(
      "[features]\ndefault_mode_request_user_input = true\n",
    );
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath ?? "")).toBe(true);
    expect(inquirer.prompt).toHaveBeenCalledOnce();
  });

  it("shares one confirmation for overlapping checks in the same home", async () => {
    let markPromptReady!: () => void;
    let resolvePrompt!: (answer: { apply: boolean }) => void;
    const promptReady = new Promise<void>((resolve) => {
      markPromptReady = resolve;
    });
    const promptAnswer = new Promise<{ apply: boolean }>((resolve) => {
      resolvePrompt = resolve;
    });
    vi.mocked(inquirer.prompt).mockImplementationOnce(
      (() => {
        markPromptReady();
        return promptAnswer;
      }) as typeof inquirer.prompt,
    );

    const first = ensureCodexRequestUserInput(options());
    await promptReady;
    const second = ensureCodexRequestUserInput(options());
    resolvePrompt({ apply: true });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(inquirer.prompt).toHaveBeenCalledOnce();
  });

  it("uses an absolute Windows Python override as one cc-switch executable", async () => {
    const pythonCommand = "C:\\Program Files\\Python312\\python.exe";
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    mockPythonResponses("[features]\nhooks = false\n", JSON.stringify({ ok: true }));

    await ensureCodexRequestUserInput(options({ pythonCommand }));

    const firstCall = vi.mocked(execFileSync).mock.calls[0];
    expect(firstCall?.[0]).toBe(pythonCommand);
    expect(firstCall?.[1]).toEqual(expect.arrayContaining(["-c"]));
  });

  it("does not write when confirmation is declined or unavailable", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ apply: false });
    const declined = await ensureCodexRequestUserInput(options());

    expect(declined.status).toBe("declined");
    expect(declined.backupPath).toBeUndefined();
    expect(fs.existsSync(configPath())).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("拟备份"));

    const nonInteractive = await ensureCodexRequestUserInput(
      options({ interactive: false }),
    );
    expect(nonInteractive.status).toBe("non-interactive");
    expect(nonInteractive.backupPath).toBeUndefined();
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("keeps cc-switch as the source and gives its settings guidance when confirmation is declined or unavailable", async () => {
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    mockPythonResponses("[features]\nhooks = false\n", JSON.stringify({ ok: true }));
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ apply: false });

    const declined = await ensureCodexRequestUserInput(options());

    expect(declined).toMatchObject({
      status: "declined",
      source: "cc-switch",
      backupPath: undefined,
    });
    expect(fs.existsSync(configPath())).toBe(false);
    expect(
      fs
        .readdirSync(path.dirname(databasePath))
        .some((file) => file.startsWith("cc-switch.db.trellis-backup-")),
    ).toBe(false);
    const declinedWarnings = vi.mocked(console.warn).mock.calls.flat().join("\n");
    expect(declinedWarnings).toContain("settings.common_config_codex");
    expect(declinedWarnings).not.toContain("cc-switch.db 的 [features]");

    vi.mocked(console.warn).mockClear();
    const nonInteractive = await ensureCodexRequestUserInput(
      options({ interactive: false }),
    );

    expect(nonInteractive).toMatchObject({
      status: "non-interactive",
      source: "cc-switch",
      backupPath: undefined,
    });
    expect(fs.existsSync(configPath())).toBe(false);
    expect(
      fs
        .readdirSync(path.dirname(databasePath))
        .some((file) => file.startsWith("cc-switch.db.trellis-backup-")),
    ).toBe(false);
    const nonInteractiveWarnings = vi.mocked(console.warn).mock.calls
      .flat()
      .join("\n");
    expect(nonInteractiveWarnings).toContain("settings.common_config_codex");
    expect(nonInteractiveWarnings).not.toContain("cc-switch.db 的 [features]");
  });

  it("does not prompt, back up, or write when the setting is already enabled", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    const originalContent =
      "[features]\ndefault_mode_request_user_input = true\nhooks = true\n";
    fs.writeFileSync(configPath(), originalContent);
    const filesBefore = fs.readdirSync(path.dirname(configPath())).sort();

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "already-enabled",
      source: "codex-config",
      backupPath: undefined,
      hooksStatus: "enabled",
    });
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(fs.readFileSync(configPath(), "utf8")).toBe(originalContent);
    expect(fs.readdirSync(path.dirname(configPath())).sort()).toEqual(filesBefore);
  });

  it("degrades to manual guidance when the confirmation prompt fails", async () => {
    vi.mocked(inquirer.prompt).mockRejectedValueOnce(
      new Error("stdin unavailable"),
    );

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "failed",
      source: "codex-config",
      message: "stdin unavailable",
    });
    expect(fs.existsSync(configPath())).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("无法显示独立确认提示：stdin unavailable"),
    );
  });

  it("does not overwrite a config changed during confirmation", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), "[features]\nhooks = false\n");
    const changedContent =
      "[features]\nhooks = true\nother_feature = false\n";
    vi.mocked(inquirer.prompt).mockImplementationOnce(
      (() => {
        fs.writeFileSync(configPath(), changedContent);
        return Promise.resolve({ apply: true });
      }) as typeof inquirer.prompt,
    );

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "failed",
      source: "codex-config",
      backupPath: undefined,
    });
    expect(fs.readFileSync(configPath(), "utf8")).toBe(changedContent);
  });

  it("does not require Python to validate a TOML config", async () => {
    vi.mocked(execFileSync).mockImplementation((() => {
      throw new Error("Python unavailable");
    }) as typeof execFileSync);

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "enabled",
      source: "codex-config",
      hooksStatus: "missing",
    });
    expect(inquirer.prompt).toHaveBeenCalledOnce();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fs.readFileSync(configPath(), "utf8")).toContain(
      "default_mode_request_user_input = true",
    );
  });

  it("reports dry-run without reading, confirming, backing up, or writing", async () => {
    const result = await ensureCodexRequestUserInput(options({ dryRun: true }));

    expect(result).toMatchObject({
      status: "dry-run",
      source: "undetermined",
      hooksStatus: "unknown",
    });
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(homeDir, ".codex"))).toBe(false);
  });

  it("reports a config write failure without overwriting the user path", async () => {
    fs.writeFileSync(path.join(homeDir, ".codex"), "not a directory");

    const result = await ensureCodexRequestUserInput(options());

    expect(result.status).toBe("failed");
    expect(result.source).toBe("codex-config");
    expect(result.backupPath).toBeUndefined();
    expect(fs.readdirSync(homeDir)).toEqual([".codex"]);
    expect(inquirer.prompt).toHaveBeenCalledOnce();
  });

  it.each(["EACCES", "EPERM"])(
    "degrades to manual guidance when a %s write leaves TOML unchanged",
    async (code) => {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      const originalContent = "[features]\nhooks = false\n";
      fs.writeFileSync(configPath(), originalContent);
      fsWriteFailure.targetPath = configPath();
      fsWriteFailure.code = code;

      const result = await ensureCodexRequestUserInput(options());

      expect(result).toMatchObject({
        status: "failed",
        source: "codex-config",
        hooksStatus: "disabled",
      });
      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath ?? "")).toBe(true);
      expect(fs.readFileSync(configPath(), "utf8")).toBe(originalContent);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(code));
    },
  );

  it("prefers cc-switch when it can be written", async () => {
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    mockPythonResponses("[features]\nhooks = true\n", JSON.stringify({ ok: true }));

    const result = await ensureCodexRequestUserInput(options());

    expect(result.status).toBe("enabled");
    expect(result.source).toBe("cc-switch");
    expect(result.hooksStatus).toBe("enabled");
    expect(fs.existsSync(configPath())).toBe(false);
    expect(inquirer.prompt).toHaveBeenCalledOnce();
  });

  it("does not overwrite cc-switch content changed during confirmation", async () => {
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    const originalContent = "[features]\nhooks = false\n";
    const changedContent = "[features]\nhooks = true\nother_feature = false\n";
    let reads = 0;
    let writeAttempted = false;
    vi.mocked(execFileSync).mockImplementation(
      ((_command: string, args: readonly string[] = []) => {
        const scriptIndex = args.indexOf("-c");
        const script = scriptIndex >= 0 ? args[scriptIndex + 1] : "";
        if (script.includes("BEGIN IMMEDIATE")) {
          writeAttempted = true;
          return JSON.stringify({ ok: true });
        }
        if (script.includes("SELECT value FROM settings")) {
          const value = reads === 0 ? originalContent : changedContent;
          reads += 1;
          return JSON.stringify({ ok: true, exists: true, value });
        }
        throw new Error("unexpected Python script");
      }) as typeof execFileSync,
    );

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "failed",
      source: "cc-switch",
      backupPath: undefined,
    });
    expect(writeAttempted).toBe(false);
    expect(reads).toBe(2);
  });

  it("does not fall back when cc-switch compare-and-set detects a late conflict", async () => {
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    mockPythonResponses(
      ["[features]", "hooks = false", ""].join("\n"),
      JSON.stringify({
        ok: false,
        conflict: true,
        error: "cc-switch 配置在确认后发生变化",
      }),
    );

    const result = await ensureCodexRequestUserInput(options());

    expect(result).toMatchObject({
      status: "failed",
      source: "cc-switch",
      backupPath: undefined,
    });
    expect(inquirer.prompt).toHaveBeenCalledOnce();
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("writes and protects cc-switch with real SQLite on Windows", async () => {
    if (process.platform !== "win32") return;

    const actualExecFileSync = childProcessActual.execFileSync;
    if (!actualExecFileSync) {
      throw new Error("真实 child_process.execFileSync 不可用。");
    }

    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const runPython = (script: string, args: string[] = []): string =>
      String(
        actualExecFileSync(
          "py",
          ["-3", "-c", script, ...args],
          { encoding: "utf8", stdio: "pipe" },
        ),
      );
    const writeDatabase = (content: string): void => {
      runPython(
        "import sqlite3, sys; connection = sqlite3.connect(sys.argv[1]); connection.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'); connection.execute('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ('common_config_codex', sys.argv[2])); connection.commit(); connection.close()",
        [databasePath, content],
      );
    };
    const readDatabase = (): string =>
      runPython(
        "import sqlite3, sys; connection = sqlite3.connect(sys.argv[1]); print(connection.execute('SELECT value FROM settings WHERE key = ?', ('common_config_codex',)).fetchone()[0]); connection.close()",
        [databasePath],
      ).replaceAll("\r\n", "\n").trim();

    writeDatabase("[features]\nhooks = false\n");
    vi.mocked(execFileSync).mockImplementation(
      ((command: string, args: readonly string[] = [], options) =>
        actualExecFileSync(command, args, options)) as typeof execFileSync,
    );
    const enabled = await ensureCodexRequestUserInput(
      options({ pythonCommand: "py -3" }),
    );

    expect(enabled).toMatchObject({ status: "enabled", source: "cc-switch" });
    expect(fs.existsSync(enabled.backupPath ?? "")).toBe(true);
    expect(readDatabase()).toContain("default_mode_request_user_input = true");

    writeDatabase("[features]\nhooks = false\n");
    const backupFilesBefore = fs
      .readdirSync(path.dirname(databasePath))
      .filter((file) => file.startsWith("cc-switch.db.trellis-backup-"))
      .sort();
    let mutateBeforeWrite = true;
    vi.mocked(execFileSync).mockImplementation(
      ((command: string, args: readonly string[] = [], options) => {
        const scriptIndex = args.indexOf("-c");
        const script = scriptIndex >= 0 ? String(args[scriptIndex + 1]) : "";
        if (mutateBeforeWrite && script.includes("BEGIN IMMEDIATE")) {
          writeDatabase("[features]\nhooks = true\n");
          mutateBeforeWrite = false;
        }
        return actualExecFileSync(command, args, options);
      }) as typeof execFileSync,
    );
    const conflict = await ensureCodexRequestUserInput(
      options({ pythonCommand: "py -3" }),
    );

    expect(conflict).toMatchObject({
      status: "failed",
      source: "cc-switch",
      backupPath: undefined,
    });
    expect(readDatabase()).toBe("[features]\nhooks = true");
    expect(
      fs
        .readdirSync(path.dirname(databasePath))
        .filter((file) => file.startsWith("cc-switch.db.trellis-backup-"))
        .sort(),
    ).toEqual(backupFilesBefore);
  });

  it.each(["SQLite backup failed", "SQLite write failed"])(

    "falls back from cc-switch when %s",
    async (failure) => {
      const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.writeFileSync(databasePath, "placeholder");
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), "[features]\nhooks = false\n");
      mockPythonResponses(
        "[features]\nhooks = false\n",
        JSON.stringify({ ok: false, error: failure }),
      );

      const result = await ensureCodexRequestUserInput(options());

      expect(result.status).toBe("enabled");
      expect(result.source).toBe("codex-config");
      expect(fs.readFileSync(configPath(), "utf8")).toContain(
        "default_mode_request_user_input = true",
      );
      expect(inquirer.prompt).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("$trellis-start"),
      );
    },
  );

  it("falls back to TOML when cc-switch cannot be read", async () => {
    const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "placeholder");
    vi.mocked(execFileSync).mockImplementation(
      (() => {
        throw new Error("Python unavailable");
      }) as typeof execFileSync,
    );

    const result = await ensureCodexRequestUserInput(options());

    expect(result.status).toBe("enabled");
    expect(result.source).toBe("codex-config");
    expect(fs.readFileSync(configPath(), "utf8")).toContain(
      "default_mode_request_user_input = true",
    );
  });

  it.each([
    ["malformed", "[features\nother = true\n"],
    ["conflicting", "[features]\ndefault_mode_request_user_input = false\n"],
  ])(
    "does not fall back from cc-switch when its config is %s",
    async (_label, content) => {
      const databasePath = path.join(homeDir, ".cc-switch", "cc-switch.db");
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.writeFileSync(databasePath, "placeholder");
      mockPythonResponses(content, JSON.stringify({ ok: true }));

      const result = await ensureCodexRequestUserInput(options());

      expect(result).toMatchObject({ status: "conflict", source: "cc-switch" });
      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(fs.existsSync(configPath())).toBe(false);
      expect(execFileSync).toHaveBeenCalledOnce();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("settings.common_config_codex"),
      );
    },
  );
});
