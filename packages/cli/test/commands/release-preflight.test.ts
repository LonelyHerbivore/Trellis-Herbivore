import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../");
const scriptPath = path.join(
  repoRoot,
  "packages/cli/scripts/release-preflight.js",
);
const cliPkgPath = path.join(repoRoot, "packages/cli/package.json");
const corePkgPath = path.join(repoRoot, "packages/core/package.json");


function withTempRegistryScript<T>(
  body: string,
  run: (mockPath: string) => T,
): T {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-release-preflight-"),
  );
  const mockPath = path.join(tmpDir, process.platform === "win32" ? "npm.cmd" : "npm");
  fs.writeFileSync(mockPath, body, { encoding: "utf-8", mode: 0o755 });
  try {
    return run(mockPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("release-preflight verify-published-cli-manifest", () => {
  it("passes when published CLI metadata pins core to exact version", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
    };

    const body =
      process.platform === "win32"
        ? `@echo off\r\nif "%1"=="view" if "%2"=="${cliPkg.name}@${cliPkg.version}" if "%3"=="dependencies" (\r\n  echo {"${corePkg.name}":"${cliPkg.version}"}\r\n  exit /b 0\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "view" ] && [ "$2" = "${cliPkg.name}@${cliPkg.version}" ] && [ "$3" = "dependencies" ]; then\n  printf '{"${corePkg.name}":"${cliPkg.version}"}'\n  exit 0\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;

    withTempRegistryScript(body, (mockPath) => {
      const out = execFileSync(
        process.execPath,
        [scriptPath, "verify-published-cli-manifest"],
        {
          cwd: repoRoot,
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${path.dirname(mockPath)}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      expect(out).toContain("published CLI metadata pins");
    });
  });

  it("fails when published CLI metadata still contains workspace dependency", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
    };

    const body =
      process.platform === "win32"
        ? `@echo off\r\nif "%1"=="view" if "%2"=="${cliPkg.name}@${cliPkg.version}" if "%3"=="dependencies" (\r\n  echo {"${corePkg.name}":"workspace:*"}\r\n  exit /b 0\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "view" ] && [ "$2" = "${cliPkg.name}@${cliPkg.version}" ] && [ "$3" = "dependencies" ]; then\n  printf '{"${corePkg.name}":"workspace:*"}'\n  exit 0\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;

    withTempRegistryScript(body, (mockPath) => {
      expect(() =>
        execFileSync(
          process.execPath,
          [scriptPath, "verify-published-cli-manifest"],
          {
            cwd: repoRoot,
            encoding: "utf-8",
            env: {
              ...process.env,
              PATH: `${path.dirname(mockPath)}${path.delimiter}${process.env.PATH ?? ""}`,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      ).toThrowError(/published CLI metadata.*workspace:\*/s);
    });
  });
});
