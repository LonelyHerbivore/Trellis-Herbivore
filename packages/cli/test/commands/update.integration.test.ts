/**
 * Integration tests for the update() command.
 *
 * Tests the full update flow in real temp directories with minimal mocking.
 * Only external dependencies are mocked: figlet, inquirer, child_process, fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";

// === External dependency mocks (hoisted by vitest) ===

vi.mock("figlet", () => ({
  default: { textSync: vi.fn(() => "TRELLIS") },
}));

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn().mockResolvedValue({ proceed: true }) },
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockImplementation((cmd: string) => {
    const py = process.platform === "win32" ? "python" : "python3";
    return cmd === `${py} --version` ? "Python 3.11.12" : "";
  }),
}));

vi.mock("../../src/utils/codex-user-config.js", () => ({
  ensureCodexRequestUserInput: vi.fn(),
}));

// === Imports ===

import { init } from "../../src/commands/init.js";
import { update } from "../../src/commands/update.js";
import { VERSION } from "../../src/constants/version.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../../src/constants/paths.js";
import { computeHash } from "../../src/utils/template-hash.js";
import { workflowMdTemplate } from "../../src/templates/trellis/index.js";
import { replacePythonCommandLiterals } from "../../src/configurators/shared.js";
import { ensureCodexRequestUserInput } from "../../src/utils/codex-user-config.js";
import { runWorkflowCommand } from "../../src/commands/workflow.js";

// A managed template file that update always handles (Python script)
const MANAGED_FILE = `${PATHS.SCRIPTS}/get_context.py`;
const CLAUDE_IMPLEMENT_AGENT = ".claude/agents/trellis-implement.md";
const CLAUDE_CODE_REVIEW_AGENT = ".claude/agents/trellis-code-review.md";
const CLAUDE_SUBAGENT_HOOK = ".claude/hooks/inject-subagent-context.py";

/** Remove a key from a hash object (avoids eslint no-dynamic-delete) */
function removeHashEntry<T>(
  obj: Record<string, T>,
  key: string,
): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key)) as Record<string, T>;
}

/**
 * Read the v2 hashes file and return the inner `hashes` map.
 * Tests manipulate this map then write it back via `writeHashesV2`.
 */
function readHashesV2(hashFile: string): Record<string, string> {
  const raw = JSON.parse(fs.readFileSync(hashFile, "utf-8")) as {
    __version?: number;
    hashes?: Record<string, string>;
  };
  return raw.hashes ?? {};
}

/** Write a v2-shaped hashes file. */
function writeHashesV2(hashFile: string, hashes: Record<string, string>): void {
  fs.writeFileSync(hashFile, JSON.stringify({ __version: 2, hashes }, null, 2));
}

function removeSubagentsSection(content: string): string {
  return content.replace(
    "\n## Subagents\n\n" +
      "- ALWAYS wait for all subagents to complete before yielding.\n" +
      "- Spawn subagents automatically when:\n" +
      "  - Parallelizable work (e.g., install + verify, npm test + typecheck, multiple tasks from plan)\n" +
      "  - Long-running or blocking tasks where a worker can run independently.\n" +
      "  - Isolation for risky changes or checks\n",
    "",
  );
}

describe("update() integration", () => {
  let tmpDir: string;

  /** Initialize a fresh project in tmpDir */
  async function setupProject(): Promise<void> {
    await init({ yes: true, force: true });
  }

  function projectFile(relativePath: string): string {
    return path.join(tmpDir, relativePath);
  }

  function hashFilePath(): string {
    return projectFile(`${DIR_NAMES.WORKFLOW}/.template-hashes.json`);
  }

  function versionFilePath(): string {
    return projectFile(`${DIR_NAMES.WORKFLOW}/.version`);
  }

  function readProjectFile(relativePath: string): string {
    return fs.readFileSync(projectFile(relativePath), "utf-8");
  }

  function writeProjectFile(relativePath: string, content: string): void {
    const fullPath = projectFile(relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  /**
   * Stage a project as if an older Trellis version installed pristine template
   * files, then the current CLI is about to update it. The hash file records
   * the older pristine content so update() must treat those files as
   * auto-update candidates.
   */
  function stageVersionedUpgradeProject(options: {
    fromVersion: string;
    pristineTemplates?: Record<string, string>;
    userModifiedTemplates?: Record<string, string>;
  }): void {
    fs.writeFileSync(versionFilePath(), options.fromVersion);

    const hashes = readHashesV2(hashFilePath());
    for (const [relativePath, content] of Object.entries(
      options.pristineTemplates ?? {},
    )) {
      writeProjectFile(relativePath, content);
      hashes[relativePath] = computeHash(content);
    }
    writeHashesV2(hashFilePath(), hashes);

    for (const [relativePath, content] of Object.entries(
      options.userModifiedTemplates ?? {},
    )) {
      writeProjectFile(relativePath, content);
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-update-int-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const noop = () => {};
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.mocked(ensureCodexRequestUserInput).mockReset();
    vi.mocked(ensureCodexRequestUserInput).mockResolvedValue({
      status: "already-enabled",
      source: "codex-config",
      target: "test-user-config",
      hooksStatus: "enabled",
    });
    // Mock fetch for npm registry
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/index.json")) {
          return new Response(
            JSON.stringify({
              version: 1,
              templates: [
                {
                  id: "tdd",
                  type: "workflow",
                  name: "TDD Workflow",
                  path: "workflows/tdd/workflow.md",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("workflows/tdd/workflow.md")) {
          return new Response("# TDD Workflow\\n\\nred -> green -> refactor\\n", {
            status: 200,
          });
        }
        return {
          ok: true,
          json: () => Promise.resolve({ version: VERSION }),
        };
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("#1 same version update is a true no-op (zero file changes, no backup)", async () => {
    await setupProject();

    // Full snapshot before update
    const snapshotBefore = new Map<string, string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else
          snapshotBefore.set(
            path.relative(tmpDir, full),
            fs.readFileSync(full, "utf-8"),
          );
      }
    };
    walk(tmpDir);

    await update({});

    // Full snapshot after update
    const snapshotAfter = new Map<string, string>();
    const walk2 = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk2(full);
        else
          snapshotAfter.set(
            path.relative(tmpDir, full),
            fs.readFileSync(full, "utf-8"),
          );
      }
    };
    walk2(tmpDir);

    // No files added or removed
    const addedFiles = [...snapshotAfter.keys()].filter(
      (k) => !snapshotBefore.has(k),
    );
    const removedFiles = [...snapshotBefore.keys()].filter(
      (k) => !snapshotAfter.has(k),
    );
    expect(addedFiles).toEqual([]);
    expect(removedFiles).toEqual([]);

    // No file contents changed
    const changedFiles: string[] = [];
    for (const [filePath, content] of snapshotBefore) {
      if (snapshotAfter.get(filePath) !== content) {
        changedFiles.push(filePath);
      }
    }
    expect(changedFiles).toEqual([]);

    // No backup directory created
    const entries = fs.readdirSync(path.join(tmpDir, DIR_NAMES.WORKFLOW));
    expect(entries.filter((e) => e.startsWith(".backup-")).length).toBe(0);
  });


  it("#1a Codex same-version update still checks the user config", async () => {
    await init({ yes: true, force: true, codex: true });
    vi.mocked(ensureCodexRequestUserInput).mockClear();

    await update({});

    expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
    expect(ensureCodexRequestUserInput).toHaveBeenCalledWith({
      interactive: process.stdin.isTTY === true,
      dryRun: undefined,
    });
  });

  it("#1b Codex dry run delegates the no-write user config check", async () => {
    await init({ yes: true, force: true, codex: true });
    vi.mocked(ensureCodexRequestUserInput).mockClear();

    await update({ dryRun: true });

    expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
    expect(ensureCodexRequestUserInput).toHaveBeenCalledWith({
      interactive: process.stdin.isTTY === true,
      dryRun: true,
    });
  });

  it("#1d treats an undefined TTY marker as non-interactive", async () => {
    await init({ yes: true, force: true, codex: true });
    vi.mocked(ensureCodexRequestUserInput).mockClear();
    const ttyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: undefined,
    });

    try {
      await update({ force: true });

      expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
      expect(ensureCodexRequestUserInput).toHaveBeenCalledWith({
        interactive: false,
        dryRun: undefined,
      });
    } finally {
      if (ttyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  it("#1e keeps the project update when the user config check fails", async () => {
    await init({ yes: true, force: true, codex: true });
    fs.writeFileSync(versionFilePath(), "0.0.1");
    vi.mocked(ensureCodexRequestUserInput).mockClear();
    vi.mocked(ensureCodexRequestUserInput).mockResolvedValueOnce({
      status: "failed",
      source: "codex-config",
      target: "test-user-config",
      hooksStatus: "unknown",
      message: "stdin unavailable",
    });

    await update({ force: true });

    expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
    expect(fs.readFileSync(versionFilePath(), "utf-8")).toBe(VERSION);
  });

  it("#1c Claude-only update does not check Codex user config", async () => {
    await init({ yes: true, force: true, claude: true });
    const userSession = projectFile(".codex/sessions/2026/user.jsonl");
    fs.mkdirSync(path.dirname(userSession), { recursive: true });
    fs.writeFileSync(userSession, "user-owned Codex runtime data\n");
    vi.mocked(ensureCodexRequestUserInput).mockClear();

    await update({ force: true });

    expect(ensureCodexRequestUserInput).not.toHaveBeenCalled();
    expect(readProjectFile(FILE_NAMES.AGENTS)).not.toContain(
      "Codex fallback: if Trellis context was not injected",
    );
    expect(readProjectFile(FILE_NAMES.CLAUDE)).not.toContain(
      "Codex fallback: if Trellis context was not injected",
    );
    expect(fs.readFileSync(userSession, "utf-8")).toBe(
      "user-owned Codex runtime data\n",
    );
  });

  it("#1b update silently creates trellis-switch.json for existing developers", async () => {
    await setupProject();

    const developerDir = path.join(tmpDir, ".trellis", "workspace", "testuser");
    fs.mkdirSync(developerDir, { recursive: true });
    const switchPath = path.join(developerDir, "trellis-switch.json");
    if (fs.existsSync(switchPath)) fs.unlinkSync(switchPath);

    await update({});

    expect(fs.existsSync(switchPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(switchPath, "utf-8"))).toEqual({
      enabled: true,
    });
  });

  it("#2 dry run makes no file changes even when changes exist", async () => {
    await setupProject();

    // Delete hash + file to simulate a truly new template file
    const target = path.join(tmpDir, MANAGED_FILE);
    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = removeHashEntry(
      readHashesV2(hashFile),
      MANAGED_FILE,
    ) as Record<string, string>;
    writeHashesV2(hashFile, hashes);
    fs.unlinkSync(target);

    await update({ dryRun: true });

    // File should still be missing (dry run didn't recreate it)
    expect(fs.existsSync(target)).toBe(false);
    // No backup directory created
    const entries = fs.readdirSync(path.join(tmpDir, DIR_NAMES.WORKFLOW));
    expect(entries.filter((e) => e.startsWith(".backup-")).length).toBe(0);
  });

  it("#3 user-deleted file (with stored hash) is not re-added on update", async () => {
    await setupProject();

    const target = path.join(tmpDir, MANAGED_FILE);
    expect(fs.existsSync(target)).toBe(true);

    // Delete it (simulating user deletion; hash still exists in .template-hashes.json)
    fs.unlinkSync(target);
    expect(fs.existsSync(target)).toBe(false);

    await update({ force: true });

    // File should NOT be re-created (user deleted it, hash still exists)
    expect(fs.existsSync(target)).toBe(false);
  });

  it("#4 auto-updates file when template changed but user did not modify", async () => {
    await setupProject();

    const targetRelative = MANAGED_FILE;
    const targetFull = path.join(tmpDir, targetRelative);
    const templateContent = fs.readFileSync(targetFull, "utf-8");

    // Simulate "old template version": change file + update hash to match
    const oldContent = "# Old version of script\n";
    fs.writeFileSync(targetFull, oldContent);

    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = readHashesV2(hashFile);
    hashes[targetRelative] = computeHash(oldContent);
    writeHashesV2(hashFile, hashes);

    await update({ force: true });

    // File should be auto-updated back to current template
    expect(fs.readFileSync(targetFull, "utf-8")).toBe(templateContent);
  });

  it("#4b auto-updates Claude implement agent when the installed template is older but unmodified", async () => {
    await init({ yes: true, force: true, claude: true });

    const targetFull = projectFile(CLAUDE_IMPLEMENT_AGENT);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    const oldContent = templateContent.replace(
      "permissionMode: acceptEdits\n",
      "",
    );
    fs.writeFileSync(targetFull, oldContent);

    const hashes = readHashesV2(hashFilePath());
    hashes[CLAUDE_IMPLEMENT_AGENT] = computeHash(oldContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({});

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(templateContent);
  });

  it("#4ba auto-updates an unmodified Claude review agent from Opus to Sonnet", async () => {
    await init({ yes: true, force: true, claude: true });

    const targetFull = projectFile(CLAUDE_CODE_REVIEW_AGENT);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    const oldContent = templateContent.replace(
      /model: sonnet(\r?\n)/,
      "model: opus$1",
    );
    fs.writeFileSync(targetFull, oldContent);

    const hashes = readHashesV2(hashFilePath());
    hashes[CLAUDE_CODE_REVIEW_AGENT] = computeHash(oldContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({});

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(templateContent);
    expect(readHashesV2(hashFilePath())[CLAUDE_CODE_REVIEW_AGENT]).toBe(
      computeHash(templateContent),
    );
  });

  it("#4bb auto-updates the Claude subagent hook when the installed template is older but unmodified", async () => {
    await init({ yes: true, force: true, claude: true });

    const targetFull = projectFile(CLAUDE_SUBAGENT_HOOK);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    const oldContent = templateContent.replace(
      'AGENT_MERGE_REVIEW = "trellis-merge-review"\n',
      "",
    );
    fs.writeFileSync(targetFull, oldContent);

    const hashes = readHashesV2(hashFilePath());
    hashes[CLAUDE_SUBAGENT_HOOK] = computeHash(oldContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({});

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(templateContent);
  });

  it.each([FILE_NAMES.AGENTS, FILE_NAMES.CLAUDE])(
    "#4c auto-updates legacy untracked %s and preserves outside content",
    async (targetRelative) => {
      await setupProject();

      const targetFull = path.join(tmpDir, targetRelative);
      const templateContent = fs.readFileSync(targetFull, "utf-8");
      const oldContent = removeSubagentsSection(templateContent);
      const existingContent = `# Local instructions\n\n${oldContent}\n\n## Project Notes\n\nKeep this.`;
      const expectedContent = `# Local instructions\n\n${templateContent}\n\n## Project Notes\n\nKeep this.`;

      fs.writeFileSync(targetFull, existingContent);

      const hashFile = path.join(
        tmpDir,
        DIR_NAMES.WORKFLOW,
        ".template-hashes.json",
      );
      const hashes = removeHashEntry(
        readHashesV2(hashFile),
        targetRelative,
      ) as Record<string, string>;
      writeHashesV2(hashFile, hashes);

      await update({});

      expect(fs.readFileSync(targetFull, "utf-8")).toBe(expectedContent);
      expect(readHashesV2(hashFile)[targetRelative]).toBe(
        computeHash(expectedContent),
      );
    },
  );

  it("#4c preserves user-modified untracked AGENTS.md managed block", async () => {
    await setupProject();

    const targetRelative = FILE_NAMES.AGENTS;
    const targetFull = path.join(tmpDir, targetRelative);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    const modifiedOldContent = removeSubagentsSection(templateContent).replace(
      "# Trellis Instructions",
      "# Custom Trellis Instructions",
    );
    fs.writeFileSync(targetFull, modifiedOldContent);

    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = removeHashEntry(
      readHashesV2(hashFile),
      targetRelative,
    ) as Record<string, string>;
    writeHashesV2(hashFile, hashes);

    await update({ skipAll: true });

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(modifiedOldContent);
  });

  it("#4d preserves user AGENTS.md without TRELLIS markers by appending the managed block", async () => {
    await setupProject();

    const targetRelative = FILE_NAMES.AGENTS;
    const targetFull = path.join(tmpDir, targetRelative);
    const templateContent = fs.readFileSync(targetFull, "utf-8");

    // User has a hand-written AGENTS.md with no TRELLIS:START/END markers at
    // all (predates 0.5.0-beta.18 or was authored by hand). Pre-fix behavior
    // would clobber this content; post-fix should append the managed block.
    const userContent = "# Project notes\n\nThings the team agreed on.\n";
    fs.writeFileSync(targetFull, userContent);

    await update({ force: true });

    const result = fs.readFileSync(targetFull, "utf-8");
    expect(result).toContain("# Project notes");
    expect(result).toContain("Things the team agreed on.");
    expect(result).toContain("<!-- TRELLIS:START -->");
    expect(result).toContain("<!-- TRELLIS:END -->");
    // Managed block should sit AFTER the user content, not replace it.
    expect(result.indexOf("# Project notes")).toBeLessThan(
      result.indexOf("<!-- TRELLIS:START -->"),
    );
    // Tail equals the canonical template (force-applied managed block).
    expect(result.endsWith(templateContent.trimEnd() + "\n")).toBe(true);
  });

  it("#4e updates the Claude managed block while preserving outside content", async () => {
    await setupProject();

    const targetRelative = FILE_NAMES.CLAUDE;
    const templateContent = readProjectFile(targetRelative);
    const oldContent = templateContent.replace(
      "These instructions are for AI assistants working in this project.\n",
      "These are older project instructions.\n",
    );
    const existingContent = `# Local instructions\n\n${oldContent}\n\n## Project Notes\n\nKeep this.`;
    const expectedContent = `# Local instructions\n\n${templateContent}\n\n## Project Notes\n\nKeep this.`;
    writeProjectFile(targetRelative, existingContent);

    const hashes = readHashesV2(hashFilePath());
    hashes[targetRelative] = computeHash(existingContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({});

    expect(readProjectFile(targetRelative)).toBe(expectedContent);
  });

  it("#4f preserves a user-modified Claude managed block", async () => {
    await setupProject();

    const targetRelative = FILE_NAMES.CLAUDE;
    const targetFull = projectFile(targetRelative);
    const templateContent = readProjectFile(targetRelative);
    const modifiedContent = templateContent.replace(
      "# Trellis Instructions",
      "# Custom Claude Instructions",
    );
    fs.writeFileSync(targetFull, modifiedContent);

    await update({ skipAll: true });

    expect(readProjectFile(targetRelative)).toBe(modifiedContent);
  });

  it("#4g appends the Claude managed block to a user file without markers", async () => {
    await setupProject();

    const targetRelative = FILE_NAMES.CLAUDE;
    const targetFull = projectFile(targetRelative);
    const templateContent = readProjectFile(targetRelative);
    const userContent = "# Project notes\n\nKeep this file.\n";
    fs.writeFileSync(targetFull, userContent);

    await update({ force: true });

    const result = readProjectFile(targetRelative);
    expect(result).toContain("# Project notes");
    expect(result).toContain("Keep this file.");
    expect(result).toContain("<!-- TRELLIS:START -->");
    expect(result).toContain("<!-- TRELLIS:END -->");
    expect(result.indexOf("# Project notes")).toBeLessThan(
      result.indexOf("<!-- TRELLIS:START -->"),
    );
    expect(result.endsWith(templateContent.trimEnd() + "\n")).toBe(true);
  });

  it("#4h does not add CLAUDE.md when updating a Codex-only project", async () => {
    await init({ yes: true, force: true, codex: true });
    vi.mocked(ensureCodexRequestUserInput).mockClear();

    expect(fs.existsSync(projectFile(FILE_NAMES.CLAUDE))).toBe(false);
    fs.writeFileSync(versionFilePath(), "0.0.1");

    await update({ force: true });

    expect(fs.existsSync(projectFile(FILE_NAMES.CLAUDE))).toBe(false);
    expect(readProjectFile(FILE_NAMES.AGENTS)).toContain(
      "Codex fallback: if Trellis context was not injected",
    );
    expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
    expect(ensureCodexRequestUserInput).toHaveBeenCalledWith({
      interactive: process.stdin.isTTY === true,
      dryRun: undefined,
    });
  });

  it("#4i updates Claude and Codex templates without touching runtime data", async () => {
    await init({ yes: true, force: true, claude: true, codex: true });

    const claudeAgent = ".claude/agents/trellis-check.md";
    const codexAgent = ".codex/agents/trellis-check.toml";
    const claudeTemplate = readProjectFile(claudeAgent);
    const codexTemplate = readProjectFile(codexAgent);
    const oldClaudeAgent = `${claudeTemplate}\n<!-- older template -->\n`;
    const oldCodexAgent = `${codexTemplate}\n# older template\n`;
    writeProjectFile(claudeAgent, oldClaudeAgent);
    writeProjectFile(codexAgent, oldCodexAgent);

    const hashes = readHashesV2(hashFilePath());
    hashes[claudeAgent] = computeHash(oldClaudeAgent);
    hashes[codexAgent] = computeHash(oldCodexAgent);
    writeHashesV2(hashFilePath(), hashes);

    const claudeRuntime = ".claude/projects/user-session.jsonl";
    const codexRuntime = ".codex/sessions/user-session.jsonl";
    writeProjectFile(claudeRuntime, "claude runtime\n");
    writeProjectFile(codexRuntime, "codex runtime\n");

    await update({});

    expect(readProjectFile(claudeAgent)).toBe(claudeTemplate);
    expect(readProjectFile(codexAgent)).toBe(codexTemplate);
    expect(readProjectFile(claudeRuntime)).toBe("claude runtime\n");
    expect(readProjectFile(codexRuntime)).toBe("codex runtime\n");
  });

  it("#4j upgrades legacy Codex only when Codex command skills are tracked", async () => {
    await init({ yes: true, force: true, codex: true });

    fs.rmSync(projectFile(".codex"), { recursive: true, force: true });
    const legacyHashes = Object.fromEntries(
      Object.entries(readHashesV2(hashFilePath())).filter(
        ([relativePath]) => !relativePath.startsWith(".codex/"),
      ),
    );
    writeHashesV2(hashFilePath(), legacyHashes);
    fs.writeFileSync(versionFilePath(), "0.4.0-beta.8");
    vi.mocked(ensureCodexRequestUserInput).mockClear();

    await update({ force: true });

    expect(
      fs.existsSync(projectFile(".codex/agents/trellis-check.toml")),
    ).toBe(true);
    expect(fs.existsSync(projectFile(".codex/hooks.json"))).toBe(true);
    expect(
      fs.existsSync(projectFile(".codex/agents/trellis-code-review.toml")),
    ).toBe(true);
    expect(ensureCodexRequestUserInput).toHaveBeenCalledOnce();
  });

  it("#4k shared Gemini skills do not trigger a Codex legacy upgrade", async () => {
    await init({ yes: true, force: true, gemini: true });

    expect(fs.existsSync(projectFile(".agents/skills"))).toBe(true);
    expect(fs.existsSync(projectFile(".codex"))).toBe(false);

    await update({ force: true });

    expect(fs.existsSync(projectFile(".codex"))).toBe(false);
  });

  it("#5 force overwrites user-modified files", async () => {
    await setupProject();

    const targetFull = path.join(tmpDir, MANAGED_FILE);
    const templateContent = fs.readFileSync(targetFull, "utf-8");

    // User modifies file (hash won't match)
    fs.writeFileSync(targetFull, "user customized content");

    await update({ force: true });

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(templateContent);
  });

  it("#5b force mode does not prompt for final confirmation", async () => {
    await setupProject();

    const targetFull = path.join(tmpDir, MANAGED_FILE);
    fs.writeFileSync(targetFull, "user customized content");
    vi.mocked(inquirer.prompt).mockClear();

    await update({ force: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it("#6 skipAll preserves user-modified files", async () => {
    await setupProject();

    const targetFull = path.join(tmpDir, MANAGED_FILE);
    fs.writeFileSync(targetFull, "user customized content");

    await update({ skipAll: true });

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(
      "user customized content",
    );
  });

  it("#6a preserves a user-customized Claude agent and its existing hash on non-force update", async () => {
    await init({ yes: true, force: true, claude: true });

    const targetFull = projectFile(CLAUDE_CODE_REVIEW_AGENT);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    const userContent = templateContent.replace(
      /model: sonnet(\r?\n)/,
      "model: haiku$1",
    );
    const originalHash = readHashesV2(hashFilePath())[CLAUDE_CODE_REVIEW_AGENT];
    fs.writeFileSync(targetFull, userContent);

    await update({ skipAll: true });

    expect(fs.readFileSync(targetFull, "utf-8")).toBe(userContent);
    expect(readHashesV2(hashFilePath())[CLAUDE_CODE_REVIEW_AGENT]).toBe(
      originalHash,
    );
    expect(originalHash).not.toBe(computeHash(userContent));
  });

  it("#7 createNew creates .new copy without overwriting original", async () => {
    await setupProject();

    const targetFull = path.join(tmpDir, MANAGED_FILE);
    const templateContent = fs.readFileSync(targetFull, "utf-8");
    fs.writeFileSync(targetFull, "user customized content");

    await update({ createNew: true });

    // Original preserved
    expect(fs.readFileSync(targetFull, "utf-8")).toBe(
      "user customized content",
    );
    // .new file created with template content
    const newFile = targetFull + ".new";
    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.readFileSync(newFile, "utf-8")).toBe(templateContent);
  });

  it("#8 updates version file after successful update", async () => {
    await setupProject();

    // Simulate older project version
    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, "0.0.1");

    await update({ force: true });

    // Version is updated even when no file changes are needed
    expect(fs.readFileSync(versionPath, "utf-8")).toBe(VERSION);
  });

  it("#9 creates backup directory before applying changes", async () => {
    await setupProject();

    // Simulate "old template version": change file + update hash to match
    // This triggers auto-update (template changed, user didn't modify)
    const targetFull = path.join(tmpDir, MANAGED_FILE);
    const oldContent = "# Old version of script\n";
    fs.writeFileSync(targetFull, oldContent);
    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = readHashesV2(hashFile);
    hashes[MANAGED_FILE] = computeHash(oldContent);
    writeHashesV2(hashFile, hashes);

    await update({ force: true });

    const entries = fs.readdirSync(path.join(tmpDir, DIR_NAMES.WORKFLOW));
    const backupDirs = entries.filter((e) => e.startsWith(".backup-"));
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);
  });

  it("#10 downgrade protection prevents update when CLI is older", async () => {
    await setupProject();

    // Set project version to future
    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, "99.99.99");

    await update({});

    // Version should NOT be changed
    expect(fs.readFileSync(versionPath, "utf-8")).toBe("99.99.99");
  });

  it("#11 allowDowngrade permits update when CLI is older", async () => {
    await setupProject();

    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, "99.99.99");

    // Remove hash entry + file to simulate a truly new template file
    const target = path.join(tmpDir, MANAGED_FILE);
    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = removeHashEntry(
      readHashesV2(hashFile),
      MANAGED_FILE,
    ) as Record<string, string>;
    writeHashesV2(hashFile, hashes);
    fs.unlinkSync(target);

    await update({ allowDowngrade: true, force: true });

    // File recreated (truly new — no stored hash)
    expect(fs.existsSync(target)).toBe(true);
    // Version updated to current
    expect(fs.readFileSync(versionPath, "utf-8")).toBe(VERSION);
  });

  it("#12 prerelease→stable upgrade with no file changes still updates .version", async () => {
    await setupProject();

    // Simulate a project at rc.6 (identical templates, just different version stamp)
    const versionPath = versionFilePath();
    fs.writeFileSync(versionPath, "0.3.0-rc.6");

    await update({});

    // .version must be updated to the current CLI version
    expect(fs.readFileSync(versionPath, "utf-8")).toBe(VERSION);
  });

  it("#12b versioned upgrade scenario applies auto-updates, additive config sections, and modified-file skips", async () => {
    await setupProject();

    const expectedWorkflow = replacePythonCommandLiterals(workflowMdTemplate);
    const expectedGetContext = readProjectFile(MANAGED_FILE);
    const userModifiedScript = `${PATHS.SCRIPTS}/add_session.py`;
    const userModifiedScriptContent = "# user customized add_session.py\n";
    const oldConfigWithoutSessionAutoCommit =
      "max_journal_lines: 2000\n\n" +
      "# Local 0.5.10 config customization that must survive update.\n";
    const oldWorkflow =
      "# Workflow\n\n" +
      "## Phase Index\n\n" +
      "[workflow-state:in_progress]\nlegacy body\n[/workflow-state:in_progress]\n\n" +
      "#### 2.1 Implement `[required · repeatable]`\n\n" +
      "[Codex]\nSpawn the implement sub-agent:\n[/Codex]\n\n" +
      "[Kilo, Antigravity, Windsurf]\n" +
      "1. Load the `trellis-before-dev` skill to read project guidelines\n" +
      "[/Kilo, Antigravity, Windsurf]\n";

    stageVersionedUpgradeProject({
      fromVersion: "0.5.10",
      pristineTemplates: {
        [PATHS.WORKFLOW_GUIDE_FILE]: oldWorkflow,
        [MANAGED_FILE]: "# old get_context.py from installed template\n",
      },
      userModifiedTemplates: {
        [`${DIR_NAMES.WORKFLOW}/config.yaml`]:
          oldConfigWithoutSessionAutoCommit,
        [userModifiedScript]: userModifiedScriptContent,
      },
    });

    await update({ skipAll: true });

    expect(fs.readFileSync(versionFilePath(), "utf-8")).toBe(VERSION);

    // Hash-tracked pristine templates from the older install are whole-file
    // auto-updated to the current packaged template.
    expect(readProjectFile(PATHS.WORKFLOW_GUIDE_FILE)).toBe(expectedWorkflow);
    expect(readProjectFile(MANAGED_FILE)).toBe(expectedGetContext);
    expect(readProjectFile(PATHS.WORKFLOW_GUIDE_FILE)).toContain(
      "[codex-inline, Kilo, Antigravity, Windsurf]",
    );
    expect(readProjectFile(PATHS.WORKFLOW_GUIDE_FILE)).not.toContain(
      "[Codex]",
    );

    // Version-specific additive config sections still apply to a user-modified
    // config.yaml, while preserving the local content around the append.
    const updatedConfig = readProjectFile(`${DIR_NAMES.WORKFLOW}/config.yaml`);
    expect(updatedConfig).toContain(
      "Local 0.5.10 config customization that must survive update.",
    );
    expect(updatedConfig).toContain("Session Auto-Commit");
    expect(updatedConfig).toContain("session_auto_commit: true");

    // User-modified template files are skipped under skipAll and their hashes
    // are not rewritten to bless the local modification as a template.
    expect(readProjectFile(userModifiedScript)).toBe(
      userModifiedScriptContent,
    );
    const hashes = readHashesV2(hashFilePath());
    expect(hashes[PATHS.WORKFLOW_GUIDE_FILE]).toBe(
      computeHash(expectedWorkflow),
    );
    expect(hashes[MANAGED_FILE]).toBe(computeHash(expectedGetContext));
    expect(hashes[userModifiedScript]).not.toBe(
      computeHash(userModifiedScriptContent),
    );
  });

  it("#13 user-edited spec/guides files are preserved after update with force", async () => {
    await setupProject();

    // User customizes a spec guides file
    const guidesIndex = path.join(tmpDir, PATHS.SPEC, "guides", "index.md");
    expect(fs.existsSync(guidesIndex)).toBe(true);
    const customContent = "# My Custom Guides\n\nEdited by user.\n";
    fs.writeFileSync(guidesIndex, customContent);

    await update({ force: true });

    // User's customized content must be preserved (update should not touch spec/)
    expect(fs.readFileSync(guidesIndex, "utf-8")).toBe(customContent);
  });

  it("#14 deleted spec directory is NOT recreated by update", async () => {
    await setupProject();

    // User deletes the entire spec directory
    const specDir = path.join(tmpDir, PATHS.SPEC);
    fs.rmSync(specDir, { recursive: true, force: true });
    expect(fs.existsSync(specDir)).toBe(false);

    await update({ force: true });

    // spec/ directory should NOT be recreated by update
    expect(fs.existsSync(specDir)).toBe(false);
  });

  it("#15 truly new file (no stored hash) is still added", async () => {
    await setupProject();

    // The hash file should exist
    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = removeHashEntry(
      readHashesV2(hashFile),
      MANAGED_FILE,
    ) as Record<string, string>;

    // Remove a hash entry AND the file (simulates a truly new template)
    const targetPath = path.join(tmpDir, MANAGED_FILE);
    writeHashesV2(hashFile, hashes);
    fs.unlinkSync(targetPath);

    // Run update
    await update({ force: true });

    // File SHOULD be created (no hash = truly new)
    expect(fs.existsSync(targetPath)).toBe(true);
  });

  it("#16 config.yaml update.skip prevents file from being updated", async () => {
    await setupProject();

    // Pick a managed template file
    const targetPath = path.join(tmpDir, MANAGED_FILE);

    // Add skip config
    const configPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml");
    const configContent = fs.readFileSync(configPath, "utf-8");
    fs.writeFileSync(
      configPath,
      configContent + `\nupdate:\n  skip:\n    - ${MANAGED_FILE}\n`,
    );

    // Modify the file so it would normally trigger a change
    fs.writeFileSync(targetPath, "# modified by user\n");

    // Run update
    await update({ force: true });

    // File should NOT be overwritten (it's in skip list)
    expect(fs.readFileSync(targetPath, "utf-8")).toBe("# modified by user\n");
  });

  it("#17 config.yaml update.skip with directory path skips all files under it", async () => {
    await setupProject();

    // Add skip config for the scripts/common/ directory
    const configPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml");
    const configContent = fs.readFileSync(configPath, "utf-8");
    const skipDir = `${PATHS.SCRIPTS}/common/`;
    fs.writeFileSync(
      configPath,
      configContent + `\nupdate:\n  skip:\n    - ${skipDir}\n`,
    );

    // Modify a file under the skipped directory
    const targetPath = path.join(tmpDir, PATHS.SCRIPTS, "common", "paths.py");
    expect(fs.existsSync(targetPath)).toBe(true);
    fs.writeFileSync(targetPath, "# user modified paths.py\n");

    // Run update
    await update({ force: true });

    // File should NOT be overwritten (its directory is in skip list)
    expect(fs.readFileSync(targetPath, "utf-8")).toBe(
      "# user modified paths.py\n",
    );
  });

  it("#18 safe-file-delete preserves user-modified deprecated file", async () => {
    await setupProject();

    // Create a deprecated file that exists in the 0.4.0-beta.1 safe-file-delete manifest
    // but with user-modified content (hash won't match allowed_hashes)
    const deprecatedDir = path.join(tmpDir, ".claude", "commands", "trellis");
    fs.mkdirSync(deprecatedDir, { recursive: true });
    const deprecatedFile = path.join(deprecatedDir, "before-backend-dev.md");
    const userContent =
      "# My customized before-backend-dev command\nUser edited this.\n";
    fs.writeFileSync(deprecatedFile, userContent);

    await update({ force: true });

    // File should be preserved (hash doesn't match allowed_hashes)
    expect(fs.existsSync(deprecatedFile)).toBe(true);
    expect(fs.readFileSync(deprecatedFile, "utf-8")).toBe(userContent);
  });

  it("#19 safe-file-delete handles missing deprecated files without crash", async () => {
    await setupProject();

    // Simulate upgrading from an old version — deprecated files don't exist
    // The manifest has safe-file-delete entries for .claude/commands/trellis/before-backend-dev.md etc.
    // but init() doesn't create them (templates removed). update() should not crash.
    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, "0.3.7");

    // This should complete without errors even though deprecated files don't exist
    await update({ force: true });

    // Version updated successfully
    expect(fs.readFileSync(versionPath, "utf-8")).toBe(VERSION);
  });

  // Original template content for check-backend.md (deleted in 0.4.0-beta.1).
  // Hash: 4e81a28d681ea770f780df55a212fd504ce21ee49b44ba16023b74b5c243cef3
  const ORIGINAL_CHECK_BACKEND_CONTENT = [
    "Check if the code you just wrote follows the backend development guidelines.",
    "",
    "Execute these steps:",
    "1. Run `git status` to see modified files",
    "2. Read `.trellis/spec/backend/index.md` to understand which guidelines apply",
    "3. Based on what you changed, read the relevant guideline files:",
    "   - Database changes → `.trellis/spec/backend/database-guidelines.md`",
    "   - Error handling → `.trellis/spec/backend/error-handling.md`",
    "   - Logging changes → `.trellis/spec/backend/logging-guidelines.md`",
    "   - Type changes → `.trellis/spec/backend/type-safety.md`",
    "   - Any changes → `.trellis/spec/backend/quality-guidelines.md`",
    "4. Review your code against the guidelines",
    "5. Report any violations and fix them if found",
    "",
  ].join("\n");

  it("#20 safe-file-delete respects update.skip for deprecated files", async () => {
    await setupProject();

    // Sanity: content hash must match the manifest's allowed_hashes
    expect(computeHash(ORIGINAL_CHECK_BACKEND_CONTENT)).toBe(
      "4e81a28d681ea770f780df55a212fd504ce21ee49b44ba16023b74b5c243cef3",
    );

    // Create a deprecated file with original content (hash matches allowed_hashes)
    // Without update.skip, collectSafeFileDeletes() would delete this file.
    const deprecatedDir = path.join(tmpDir, ".claude", "commands", "trellis");
    fs.mkdirSync(deprecatedDir, { recursive: true });
    const deprecatedFile = path.join(deprecatedDir, "check-backend.md");
    fs.writeFileSync(deprecatedFile, ORIGINAL_CHECK_BACKEND_CONTENT);

    // Add the deprecated file's directory to update.skip
    const configPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml");
    const configContent = fs.readFileSync(configPath, "utf-8");
    fs.writeFileSync(
      configPath,
      configContent + `\nupdate:\n  skip:\n    - .claude/commands/trellis/\n`,
    );

    await update({ force: true });

    // File should be preserved (directory is in update.skip, overriding safe-file-delete)
    expect(fs.existsSync(deprecatedFile)).toBe(true);
    expect(fs.readFileSync(deprecatedFile, "utf-8")).toBe(
      ORIGINAL_CHECK_BACKEND_CONTENT,
    );
  });

  it("#21 safe-file-delete deletes file when hash matches allowed_hashes", async () => {
    await setupProject();

    // Sanity: content hash must match the manifest's allowed_hashes
    expect(computeHash(ORIGINAL_CHECK_BACKEND_CONTENT)).toBe(
      "4e81a28d681ea770f780df55a212fd504ce21ee49b44ba16023b74b5c243cef3",
    );

    // Create deprecated file with original content (hash matches allowed_hashes)
    const deprecatedDir = path.join(tmpDir, ".claude", "commands", "trellis");
    fs.mkdirSync(deprecatedDir, { recursive: true });
    const deprecatedFile = path.join(deprecatedDir, "check-backend.md");
    fs.writeFileSync(deprecatedFile, ORIGINAL_CHECK_BACKEND_CONTENT);

    await update({ force: true });

    // File should be DELETED (hash matched allowed_hashes, no update.skip protection)
    expect(fs.existsSync(deprecatedFile)).toBe(false);
  });

  it("#22 preserves existing Claude statusLine config and hook file on update", async () => {
    await init({ yes: true, force: true, claude: true });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const statusLinePath = path.join(
      tmpDir,
      ".claude",
      "hooks",
      "statusline.py",
    );
    const expectedPythonCmd =
      process.platform === "win32" ? "python" : "python3";
    const statusLineConfig = {
      type: "command",
      command: `${expectedPythonCmd} .claude/hooks/statusline.py`,
    };

    const settings = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8"),
    ) as Record<string, unknown>;
    settings.statusLine = statusLineConfig;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    fs.writeFileSync(statusLinePath, "# existing local statusline\n");

    await update({ force: true });

    expect(fs.existsSync(statusLinePath)).toBe(true);
    const updatedSettings = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8"),
    ) as Record<string, unknown>;
    expect(updatedSettings.statusLine).toEqual(statusLineConfig);
    expect(updatedSettings.hooks).toBeDefined();
  });

  // --- Breaking-change migration gate (v0.5.0-beta.0+) ---
  // Gate: if upgrading from a version that spans a breaking manifest with
  // recommendMigrate=true, `update` must be invoked with --migrate (or --dry-run
  // for preview). Without either, exit 1 with a clear error.

  /** Simulate a 0.4.0 project by writing a legacy command file that the manifest renames */
  function stageLegacy040Project(): void {
    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, "0.4.0");
    // Create one legacy file that matches a `rename` entry in 0.5.0-beta.0 manifest.
    // Without this, classifyMigrations finds no work → early-exit before gate.
    const legacyDir = path.join(tmpDir, ".claude", "commands", "trellis");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "before-dev.md"), "legacy content");
  }

  /** Delete the post-init target so classifyMigrations hits the "new doesn't exist"
   *  branch and respects `isTemplateModified` on the source (→ confirm bucket). */
  function clearMigrationTarget(): void {
    fs.rmSync(path.join(tmpDir, ".claude/skills/trellis-before-dev"), {
      recursive: true,
      force: true,
    });
  }

  it("#22 breaking-change gate exits 1 when --migrate is missing", async () => {
    await setupProject();
    stageLegacy040Project();

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await update({});

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("#23 breaking-change gate allows --dry-run without --migrate", async () => {
    await setupProject();
    stageLegacy040Project();

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await update({ dryRun: true });

    // Gate must not fire for preview mode (users need to inspect before migrating)
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("#24 breaking-change gate allows --migrate to proceed", async () => {
    await setupProject();
    stageLegacy040Project();

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await update({ migrate: true, force: true });

    // Gate passes when --migrate is present; update proceeds to completion
    expect(exitSpy).not.toHaveBeenCalled();
    // Version must advance to current CLI after the migrate run
    const versionPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, ".version");
    expect(fs.readFileSync(versionPath, "utf-8")).toBe(VERSION);
  });

  // The [b] Backup-rename path in the confirm prompt promises "keeps a .backup
  // copy". Previously it was identical to [r] (both relied on the full project
  // snapshot). We now write an INLINE .backup next to the new path so users can
  // diff/merge their customizations without digging through .trellis/.backup-*/.
  /** Install a mock that returns a specific migration choice for the per-file prompt
   *  and {proceed: true} for the top-level confirm. Resolves the flakiness of
   *  matching on `name` field in the dynamic import path. */
  async function installChoiceMock(
    choice: "rename" | "backup-rename" | "skip",
  ) {
    const inquirer = (await import("inquirer")).default;
    vi.mocked(inquirer.prompt).mockImplementation(((questions: unknown) => {
      const q = Array.isArray(questions) ? questions[0] : questions;
      const name = (q as { name?: string }).name;
      if (name === "choice") return Promise.resolve({ choice });
      return Promise.resolve({ proceed: true });
    }) as never);
  }

  // The [b] Backup-rename path in the confirm prompt promises "keeps a .backup
  // copy". Previously it was identical to [r] (both relied on the full project
  // snapshot). We now write an INLINE .backup next to the new path so users can
  // diff/merge their customizations without digging through .trellis/.backup-*/.
  it("#25 backup-rename leaves inline <new-path>.backup with original content", async () => {
    await setupProject();
    stageLegacy040Project();
    clearMigrationTarget();

    // User-modified content that differs from the 0.5 template (forces confirm)
    const legacyPath = path.join(
      tmpDir,
      ".claude/commands/trellis/before-dev.md",
    );
    const userContent = "## My custom before-dev notes\nEdited by user.\n";
    fs.writeFileSync(legacyPath, userContent);

    await installChoiceMock("backup-rename");

    await update({ migrate: true });

    // After migration:
    //   - new-path exists (rename completed)
    //   - new-path.backup exists with the user's content (inline preservation)
    //   - old-path is gone
    const newPath = path.join(
      tmpDir,
      ".claude/skills/trellis-before-dev/SKILL.md",
    );
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(newPath + ".backup")).toBe(true);
    expect(fs.readFileSync(newPath + ".backup", "utf-8")).toBe(userContent);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("#26 rename-anyway does NOT leave an inline .backup (relies on project snapshot)", async () => {
    await setupProject();
    stageLegacy040Project();
    clearMigrationTarget();

    const legacyPath = path.join(
      tmpDir,
      ".claude/commands/trellis/before-dev.md",
    );
    fs.writeFileSync(legacyPath, "## user edits\n");

    await installChoiceMock("rename");

    await update({ migrate: true });

    const newPath = path.join(
      tmpDir,
      ".claude/skills/trellis-before-dev/SKILL.md",
    );
    expect(fs.existsSync(newPath)).toBe(true);
    // No inline .backup — the full-project snapshot under .trellis/.backup-*
    // is the single source of recovery for this mode.
    expect(fs.existsSync(newPath + ".backup")).toBe(false);
  });

  it("#27 backup skips managed node_modules dependency trees", async () => {
    await setupProject();

    const opencodeRoot = path.join(tmpDir, ".opencode");
    fs.mkdirSync(path.join(opencodeRoot, "node_modules", "zod"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(opencodeRoot, "package.json"), "{}\n");
    fs.writeFileSync(
      path.join(opencodeRoot, "node_modules", "zod", "index.js"),
      "module.exports = {};\n",
    );

    // Trigger an update that creates a backup.
    const targetFull = path.join(tmpDir, MANAGED_FILE);
    fs.writeFileSync(targetFull, "user customized content");

    await update({ force: true });

    const entries = fs.readdirSync(path.join(tmpDir, DIR_NAMES.WORKFLOW));
    const backupDirs = entries.filter((e) => e.startsWith(".backup-"));
    expect(backupDirs.length).toBe(1);

    const backupDir = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      backupDirs[0] as string,
    );
    expect(
      fs.existsSync(path.join(backupDir, ".opencode", "package.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(backupDir, ".opencode", "node_modules")),
    ).toBe(false);
  });

  it("#workflow-md-r4 updates workflow.md as one runtime template when hash-tracked", async () => {
    await setupProject();

    const workflowPath = path.join(tmpDir, PATHS.WORKFLOW_GUIDE_FILE);
    const staleWorkflow =
      "# Workflow\n\n" +
      "## Phase Index\n\n" +
      "[workflow-state:in_progress]\nlegacy body\n[/workflow-state:in_progress]\n\n" +
      "#### 2.1 Implement `[required · repeatable]`\n\n" +
      "[Codex]\nSpawn the implement sub-agent:\n[/Codex]\n\n" +
      "[Kilo, Antigravity, Windsurf]\n" +
      "1. Load the `trellis-before-dev` skill to read project guidelines\n" +
      "[/Kilo, Antigravity, Windsurf]\n";

    fs.writeFileSync(workflowPath, staleWorkflow, "utf-8");

    // Simulate an older installed workflow.md that is still pristine relative
    // to the version that installed it. Update must replace the whole file:
    // platform markers outside [workflow-state:*] blocks are runtime-parsed too.
    const hashFile = path.join(
      tmpDir,
      DIR_NAMES.WORKFLOW,
      ".template-hashes.json",
    );
    const hashes = readHashesV2(hashFile);
    hashes[PATHS.WORKFLOW_GUIDE_FILE] = computeHash(staleWorkflow);
    writeHashesV2(hashFile, hashes);

    await update({ force: true });

    const updated = fs.readFileSync(workflowPath, "utf-8");
    expect(updated).toBe(replacePythonCommandLiterals(workflowMdTemplate));
    expect(updated).toContain("[codex-sub-agent]");
    expect(updated).toContain("[codex-inline, Kilo, Antigravity, Windsurf]");
    expect(updated).not.toContain("[Codex]");
    expect(updated).not.toContain("[Kilo, Antigravity, Windsurf]");
    expect(updated).not.toContain("legacy body");

    expect(readHashesV2(hashFile)[PATHS.WORKFLOW_GUIDE_FILE]).toBe(
      computeHash(updated),
    );
  });

  it("#phase7 version-jump fixture migrates legacy skills and agents while adding review agents", async () => {
    await init({ yes: true, force: true, claude: true, codex: true });

    const sharedSkillNames = [
      ["before-dev", "trellis-before-dev"],
      ["brainstorm", "trellis-brainstorm"],
      ["break-loop", "trellis-break-loop"],
      ["check", "trellis-check"],
      ["update-spec", "trellis-update-spec"],
      ["finish-work", "trellis-finish-work"],
    ] as const;
    let hashes = readHashesV2(hashFilePath());
    for (const [legacyName, currentName] of sharedSkillNames) {
      const currentPath = ".agents/skills/" + currentName + "/SKILL.md";
      const legacyPath = ".agents/skills/" + legacyName + "/SKILL.md";
      const content = readProjectFile(currentPath);
      writeProjectFile(legacyPath, content);
      fs.rmSync(projectFile(".agents/skills/" + currentName), {
        recursive: true,
        force: true,
      });
      hashes[legacyPath] = computeHash(content);
      hashes = removeHashEntry(hashes, currentPath);
    }

    for (const agentName of ["implement", "check", "research"]) {
      const currentPath = ".codex/agents/trellis-" + agentName + ".toml";
      const legacyPath = ".codex/agents/" + agentName + ".toml";
      const content = readProjectFile(currentPath);
      writeProjectFile(legacyPath, content);
      fs.rmSync(projectFile(currentPath), { force: true });
      hashes[legacyPath] = computeHash(content);
      hashes = removeHashEntry(hashes, currentPath);
    }

    const customAgents = "# local agent notes\n";
    writeProjectFile(".codex/agents/local.toml", customAgents);
    const customEntry = "\n\n# User-owned entry\n";
    writeProjectFile("AGENTS.md", readProjectFile("AGENTS.md") + customEntry);
    writeProjectFile(".trellis/.version", "0.4.0-beta.8");
    writeHashesV2(hashFilePath(), hashes);

    await update({ migrate: true, force: true });

    for (const [, currentName] of sharedSkillNames) {
      expect(fs.existsSync(projectFile(".agents/skills/" + currentName + "/SKILL.md"))).toBe(true);
    }
    for (const agentName of ["implement", "check", "research"]) {
      expect(fs.existsSync(projectFile(".codex/agents/trellis-" + agentName + ".toml"))).toBe(true);
      expect(fs.existsSync(projectFile(".codex/agents/" + agentName + ".toml"))).toBe(false);
    }
    for (const agentName of [
      "spec-review",
      "code-review",
      "code-architecture-review",
      "merge-review",
    ]) {
      expect(fs.existsSync(projectFile(".codex/agents/trellis-" + agentName + ".toml"))).toBe(true);
    }
    expect(fs.existsSync(projectFile(".codex/agents/local.toml"))).toBe(true);
    expect(readProjectFile("AGENTS.md")).toContain("# User-owned entry");
    expect(readProjectFile(".trellis/.version")).toBe(VERSION);
  });

  it("#phase7 version-jump dry-run leaves legacy migration files untouched", async () => {
    await setupProject();
    const source = ".claude/commands/trellis/before-dev.md";
    const target = ".claude/skills/trellis-before-dev/SKILL.md";
    const sourceContent = "legacy before-dev command\n";
    writeProjectFile(source, sourceContent);
    fs.rmSync(projectFile(target), { recursive: true, force: true });
    writeProjectFile(".trellis/.version", "0.4.0");

    await update({ dryRun: true });

    expect(readProjectFile(source)).toBe(sourceContent);
    expect(fs.existsSync(projectFile(target))).toBe(false);
    expect(readProjectFile(".trellis/.version")).toBe("0.4.0");
    expect(
      fs.readdirSync(projectFile(DIR_NAMES.WORKFLOW)).some((name) =>
        name.startsWith(".backup-"),
      ),
    ).toBe(false);
  });

  it("#phase7 mixed Claude+Codex update preserves ownership and adds dispatch mode", async () => {
    await init({ yes: true, force: true, claude: true, codex: true });

    const claudeEntry = "\n\n# User Claude instructions\n";
    const claudePath = FILE_NAMES.CLAUDE;
    writeProjectFile(claudePath, readProjectFile(claudePath) + claudeEntry);
    const hooksPath = ".codex/hooks.json";
    const customHooks = "{\"hooks\":{\"UserPromptSubmit\":[]}}\n";
    writeProjectFile(hooksPath, customHooks);
    const foreignSkillPath = ".agents/skills/gemini-custom/SKILL.md";
    writeProjectFile(foreignSkillPath, "foreign tool skill\n");
    const runtimePath = ".codex/sessions/mixed-runtime.jsonl";
    writeProjectFile(runtimePath, "mixed runtime\n");
    writeProjectFile(
      ".trellis/config.yaml",
      "max_journal_lines: 2000\n\n# local mixed project config\n",
    );
    writeProjectFile(".trellis/.version", "0.5.6");

    const removedReviewAgent = ".codex/agents/trellis-code-review.toml";
    fs.rmSync(projectFile(removedReviewAgent), { force: true });
    let hashes = readHashesV2(hashFilePath());
    hashes = removeHashEntry(hashes, removedReviewAgent);
    writeHashesV2(hashFilePath(), hashes);

    await update({ skipAll: true });

    expect(readProjectFile(claudePath)).toContain(claudeEntry);
    expect(readProjectFile(hooksPath)).toBe(customHooks);
    expect(readProjectFile(foreignSkillPath)).toBe("foreign tool skill\n");
    expect(readProjectFile(runtimePath)).toBe("mixed runtime\n");
    expect(readProjectFile(".trellis/config.yaml")).toContain(
      "dispatch_mode",
    );
    const reviewAgent = readProjectFile(removedReviewAgent);
    expect(reviewAgent).toContain("Only the main session dispatches Trellis agents");
    expect(reviewAgent).toContain("return FAIL");
  });

  it("#phase7 migration conflicts preserve a user-owned target under --force", async () => {
    await init({ yes: true, force: true, codex: true });

    const source = ".codex/agents/implement.toml";
    const target = ".codex/agents/trellis-implement.toml";
    const sourceContent = "legacy implement agent\n";
    const targetContent = "user-owned target agent\n";
    writeProjectFile(source, sourceContent);
    writeProjectFile(target, targetContent);
    writeProjectFile(".trellis/.version", "0.5.0-beta.4");
    const hashes = readHashesV2(hashFilePath());
    hashes[source] = computeHash(sourceContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({ migrate: true, force: true });

    expect(readProjectFile(source)).toBe(sourceContent);
    expect(readProjectFile(target)).toBe(targetContent);
  });

  it("#phase7 preserves user data in rename-dir targets", async () => {
    await setupProject();

    const sourcePath = ".trellis/agent-traces/legacy-trace.md";
    const targetPath = ".trellis/workspace/testuser/journal-1.md";
    writeProjectFile(sourcePath, "legacy trace\n");
    writeProjectFile(targetPath, "user workspace data\n");
    writeProjectFile(".trellis/.version", "0.1.0");

    await update({ migrate: true, force: true, skipAll: true });

    expect(readProjectFile(sourcePath)).toBe("legacy trace\n");
    expect(readProjectFile(targetPath)).toBe("user workspace data\n");
  });
  it("#phase7 conflict-only migration is not skipped by the no-op path", async () => {
    await init({ yes: true, force: true, codex: true });

    const source = ".codex/agents/implement.toml";
    const target = ".codex/agents/trellis-implement.toml";
    const sourceContent = "legacy implement agent\n";
    const targetContent = "user-owned target agent\n";
    writeProjectFile(source, sourceContent);
    writeProjectFile(target, targetContent);
    writeProjectFile(".trellis/.version", "0.5.0-beta.4");
    const hashes = readHashesV2(hashFilePath());
    hashes[source] = computeHash(sourceContent);
    hashes[target] = computeHash(targetContent);
    writeHashesV2(hashFilePath(), hashes);

    await update({ migrate: true, force: true });

    expect(readProjectFile(source)).toBe(sourceContent);
    expect(readProjectFile(target)).toBe(targetContent);
    expect(readProjectFile(".trellis/.version")).toBe(VERSION);
  });

  it("#phase7 failed migration restores managed files and preserves runtime data", async () => {
    await init({ yes: true, force: true, claude: true, codex: true });

    const source = ".codex/agents/implement.toml";
    const target = ".codex/agents/trellis-implement.toml";
    const source2 = ".codex/agents/check.toml";
    const target2 = ".codex/agents/trellis-check.toml";
    const sourceContent = "legacy implement agent\n";
    const sourceContent2 = "legacy check agent\n";
    const runtimePath = ".codex/sessions/runtime.jsonl";
    const orphanManifestPath = ".codex/sessions/manifest-only.jsonl";
    const orphanManifestHash = computeHash("orphan manifest\n");
    const workspacePath = ".trellis/workspace/testuser/journal-1.md";
    const taskPath = ".trellis/tasks/user-task/task.json";
    const specPath = ".trellis/spec/custom.md";
    writeProjectFile(source, sourceContent);
    writeProjectFile(source2, sourceContent2);
    fs.rmSync(projectFile(target), { force: true });
    fs.rmSync(projectFile(target2), { force: true });
    writeProjectFile(runtimePath, "runtime state before\n");
    writeProjectFile(workspacePath, "workspace state before\n");
    writeProjectFile(taskPath, "{\"status\":\"in_progress\"}\n");
    writeProjectFile(specPath, "user spec\n");
    writeProjectFile(".trellis/.version", "0.5.0-beta.4");
    let hashes = readHashesV2(hashFilePath());
    hashes[source] = computeHash(sourceContent);
    hashes[source2] = computeHash(sourceContent2);
    hashes[orphanManifestPath] = orphanManifestHash;
    hashes = removeHashEntry(hashes, target);
    hashes = removeHashEntry(hashes, target2);
    writeHashesV2(hashFilePath(), hashes);

    const realRenameSync = fs.renameSync;
    let renameCalls = 0;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      renameCalls++;
      if (renameCalls === 2) {
        writeProjectFile(runtimePath, "runtime state during\n");
        writeProjectFile(workspacePath, "workspace state during\n");
        throw new Error("injected migration failure");
      }
      return realRenameSync(...args);
    });
    try {
      await expect(update({ migrate: true, force: true })).rejects.toThrow(
        "injected migration failure",
      );
    } finally {
      renameSpy.mockRestore();
    }

    expect(renameCalls).toBeGreaterThanOrEqual(2);
    expect(readProjectFile(source)).toBe(sourceContent);
    expect(readProjectFile(source2)).toBe(sourceContent2);
    expect(fs.existsSync(projectFile(target))).toBe(false);
    expect(fs.existsSync(projectFile(target2))).toBe(false);
    expect(readProjectFile(runtimePath)).toBe("runtime state during\n");
    expect(readProjectFile(workspacePath)).toBe("workspace state during\n");
    expect(readProjectFile(taskPath)).toBe("{\"status\":\"in_progress\"}\n");
    expect(readProjectFile(specPath)).toBe("user spec\n");
    expect(readHashesV2(hashFilePath())[orphanManifestPath]).toBe(
      orphanManifestHash,
    );
    expect(readProjectFile(".trellis/.version")).toBe("0.5.0-beta.4");
    expect(
      fs.readdirSync(projectFile(DIR_NAMES.WORKFLOW)).some((name) =>
        name.startsWith(".backup-"),
      ),
    ).toBe(true);
    const backupDirName = fs
      .readdirSync(projectFile(DIR_NAMES.WORKFLOW))
      .find((name) => name.startsWith(".backup-"));
    expect(backupDirName).toBeDefined();
    if (backupDirName) {
      expect(
        fs.existsSync(
          path.join(
            projectFile(DIR_NAMES.WORKFLOW),
            backupDirName,
            ".codex/sessions/runtime.jsonl",
          ),
        ),
      ).toBe(false);
    }
  });

  it("#phase7 persists orphan manifest pruning on a no-op update", async () => {
    await setupProject();

    const runtimePath = ".codex/sessions/no-op-runtime.jsonl";
    const orphanPath = ".codex/sessions/no-op-orphan.jsonl";
    const orphanHash = computeHash("orphan manifest\n");
    writeProjectFile(runtimePath, "runtime data\n");
    const hashes = readHashesV2(hashFilePath());
    hashes[orphanPath] = orphanHash;
    writeHashesV2(hashFilePath(), hashes);

    await update({});

    expect(readProjectFile(runtimePath)).toBe("runtime data\n");
    expect(readHashesV2(hashFilePath())[orphanPath]).toBeUndefined();
  });

  it("#phase7 refuses to update a root instruction symlink", async () => {
    await setupProject();

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-update-link-"));
    const outsidePath = path.join(outsideDir, "AGENTS.md");
    const externalContent = "external user instructions\n";
    fs.writeFileSync(outsidePath, externalContent, "utf-8");
    const rootPath = projectFile(FILE_NAMES.AGENTS);
    fs.rmSync(rootPath, { force: true });
    try {
      fs.symlinkSync(outsidePath, rootPath, "file");
    } catch {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      await expect(update({ skipAll: true })).rejects.toThrow(
        "Refusing to update symlink path",
      );
      expect(fs.readFileSync(outsidePath, "utf-8")).toBe(externalContent);
      expect(fs.lstatSync(rootPath).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
  it("#phase7 refuses to update a managed root symlink", async () => {
    await init({ yes: true, force: true, codex: true });

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-managed-root-"));
    const codexRoot = projectFile(".codex");
    fs.rmSync(codexRoot, { recursive: true, force: true });
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(outsideDir, codexRoot, linkType);
    } catch {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      await expect(update({ skipAll: true })).rejects.toThrow(
        "Refusing to update symlink managed root",
      );
      expect(fs.lstatSync(codexRoot).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("#phase7 rejects a pre-existing backup symlink", async () => {
    await setupProject();

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-backup-link-"));
    const backupTimestamp = new Date("2026-08-22T13:40:00.000Z");
    vi.setSystemTime(backupTimestamp);
    const backupName =
      ".backup-" +
      backupTimestamp.toISOString().replace(/[:.]/g, "-").slice(0, 23);
    const backupPath = projectFile(path.join(DIR_NAMES.WORKFLOW, backupName));
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(outsideDir, backupPath, linkType);
    } catch {
      vi.useRealTimers();
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      writeProjectFile(MANAGED_FILE, "user modified before backup\n");
      await expect(update({ force: true })).rejects.toThrow(
        "Backup path is not a directory",
      );
      expect(fs.lstatSync(backupPath).isSymbolicLink()).toBe(true);
    } finally {
      vi.useRealTimers();
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
  it("#phase7 non-native workflow remains user-managed after update", async () => {
    await setupProject();
    await runWorkflowCommand({ template: "tdd", force: true });

    const workflowPath = PATHS.WORKFLOW_GUIDE_FILE;
    const customWorkflow = readProjectFile(workflowPath);
    expect(readHashesV2(hashFilePath())[workflowPath]).toBeUndefined();

    await update({ skipAll: true });

    expect(readProjectFile(workflowPath)).toBe(customWorkflow);
    expect(readHashesV2(hashFilePath())[workflowPath]).toBeUndefined();
  });
});
