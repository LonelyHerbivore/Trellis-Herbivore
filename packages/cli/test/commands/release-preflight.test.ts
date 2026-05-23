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

function withTempBinScripts<T>(
  scripts: { name: string; body: string }[],
  run: (binDir: string) => T,
): T {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-release-preflight-bin-"),
  );
  for (const script of scripts) {
    fs.writeFileSync(path.join(tmpDir, script.name), script.body, {
      encoding: "utf-8",
      mode: 0o755,
    });
  }
  try {
    return run(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("release-preflight verify-packed-cli", () => {
  it("extracts the packed manifest via relative tar paths", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
    };
    const tarball = `${cliPkg.name}-${cliPkg.version}.tgz`;

    const pnpmBody =
      process.platform === "win32"
        ? `@echo off\r\nif "%1"=="pack" if "%2"=="--pack-destination" (\r\n  type nul > "%3\\${tarball}"\r\n  echo ${tarball}\r\n  exit /b 0\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "pack" ] && [ "$2" = "--pack-destination" ]; then\n  : > "$3/${tarball}"\n  printf '${tarball}\\n'\n  exit 0\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;
    const tarBody =
      process.platform === "win32"
        ? `@echo off\r\nif not "%1"=="-xzf" exit /b 1\r\nif not "%2"=="${tarball}" exit /b 1\r\nif not "%3"=="-C" exit /b 1\r\nif not "%4"=="extract" exit /b 1\r\nif not "%5"=="package/package.json" exit /b 1\r\nmkdir "extract\\package" >nul 2>nul\r\n> "extract\\package\\package.json" echo {"dependencies":{"${corePkg.name}":"${cliPkg.version}"}}\r\nexit /b 0\r\n`
        : `#!/bin/sh\nif [ "$1" != "-xzf" ] || [ "$2" != "${tarball}" ] || [ "$3" != "-C" ] || [ "$4" != "extract" ] || [ "$5" != "package/package.json" ]; then\n  printf 'unexpected args: %s\\n' "$*" >&2\n  exit 1\nfi\nmkdir -p extract/package\nprintf '{"dependencies":{"${corePkg.name}":"${cliPkg.version}"}}' > extract/package/package.json\n`;

    withTempBinScripts(
      [
        { name: process.platform === "win32" ? "pnpm.cmd" : "pnpm", body: pnpmBody },
        { name: process.platform === "win32" ? "tar.cmd" : "tar", body: tarBody },
      ],
      (binDir) => {
        const out = execFileSync(process.execPath, [scriptPath, "verify-packed-cli"], {
          cwd: repoRoot,
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        });
        expect(out).toContain("packed CLI pins");
      },
    );
  });

  it("accepts absolute tarball paths from pnpm pack output", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
    };
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-release-preflight-abs-"),
    );
    const tarball = path.join(tmpRoot, `${cliPkg.name}-${cliPkg.version}.tgz`);

    const pnpmBody =
      process.platform === "win32"
        ? `@echo off\r\nif "%1"=="pack" if "%2"=="--pack-destination" (\r\n  type nul > "${tarball.replace(/\//g, "\\")}"\r\n  echo ${tarball}\r\n  exit /b 0\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "pack" ] && [ "$2" = "--pack-destination" ]; then\n  : > "${tarball}"\n  printf '${tarball}\\n'\n  exit 0\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;
    const tarBody =
      process.platform === "win32"
        ? `@echo off\r\nif not "%1"=="-xzf" exit /b 1\r\nif not "%2"=="${path.basename(tarball)}" exit /b 1\r\nif not "%3"=="-C" exit /b 1\r\nif not "%4"=="extract" exit /b 1\r\nif not "%5"=="package/package.json" exit /b 1\r\nmkdir "extract\\package" >nul 2>nul\r\n> "extract\\package\\package.json" echo {"dependencies":{"${corePkg.name}":"${cliPkg.version}"}}\r\nexit /b 0\r\n`
        : `#!/bin/sh\nif [ "$1" != "-xzf" ] || [ "$2" != "${path.basename(tarball)}" ] || [ "$3" != "-C" ] || [ "$4" != "extract" ] || [ "$5" != "package/package.json" ]; then\n  printf 'unexpected args: %s\\n' "$*" >&2\n  exit 1\nfi\nmkdir -p extract/package\nprintf '{"dependencies":{"${corePkg.name}":"${cliPkg.version}"}}' > extract/package/package.json\n`;

    withTempBinScripts(
      [
        { name: process.platform === "win32" ? "pnpm.cmd" : "pnpm", body: pnpmBody },
        { name: process.platform === "win32" ? "tar.cmd" : "tar", body: tarBody },
      ],
      (binDir) => {
        try {
          const out = execFileSync(process.execPath, [scriptPath, "verify-packed-cli"], {
            cwd: repoRoot,
            encoding: "utf-8",
            env: {
              ...process.env,
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          });
          expect(out).toContain("packed CLI pins");
        } finally {
          fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
      },
    );
  });
});

describe("release-preflight npm-tag", () => {
  it("always prints latest", () => {
    const out = execFileSync(process.execPath, [scriptPath, "npm-tag"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    expect(out.trim()).toBe("latest");
  });
});

describe("release-preflight publish-plan", () => {
  it("always plans npm publishes with latest", () => {
    const body =
      process.platform === "win32"
        ? `@echo off\r\nif "%1"=="view" (\r\n  echo npm ERR! code E404 1>&2\r\n  echo npm ERR! 404 Not Found 1>&2\r\n  exit /b 1\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "view" ]; then\n  printf 'npm ERR! code E404\nnpm ERR! 404 Not Found\n' >&2\n  exit 1\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;

    withTempRegistryScript(body, (mockPath) => {
      const out = execFileSync(
        process.execPath,
        [scriptPath, "publish-plan", "--json"],
        {
          cwd: repoRoot,
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${path.dirname(mockPath)}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      const plan = JSON.parse(out) as { tag: string };
      expect(plan.tag).toBe("latest");
    });
  });
});

describe("release-preflight verify-npm", () => {
  it("retries until package version and dist-tag become visible", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const tag = "latest";
    const counterPath = path.join(
      os.tmpdir(),
      `trellis-release-preflight-npm-counter-${process.pid}-${Date.now()}.txt`,
    );

    const body =
      process.platform === "win32"
        ? `@echo off\r\nsetlocal EnableDelayedExpansion\r\nif "%1"=="view" (\r\n  set COUNT=0\r\n  if exist "${counterPath}" set /p COUNT=<"${counterPath}"\r\n  set /a COUNT=!COUNT!+1\r\n  > "${counterPath}" echo !COUNT!\r\n  if "%2"=="${cliPkg.name}@${cliPkg.version}" if "%3"=="version" (\r\n    if !COUNT! LSS 3 (\r\n      echo null\r\n      exit /b 0\r\n    )\r\n    echo "${cliPkg.version}"\r\n    exit /b 0\r\n  )\r\n  if "%2"=="${cliPkg.name}@${tag}" if "%3"=="version" (\r\n    if !COUNT! LSS 4 (\r\n      echo null\r\n      exit /b 0\r\n    )\r\n    echo "${cliPkg.version}"\r\n    exit /b 0\r\n  )\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "view" ]; then\n  count=0\n  if [ -f '${counterPath}' ]; then\n    count=$(cat '${counterPath}')\n  fi\n  count=$((count + 1))\n  printf '%s' "$count" > '${counterPath}'\n  if [ "$2" = "${cliPkg.name}@${cliPkg.version}" ] && [ "$3" = "version" ]; then\n    if [ "$count" -lt 3 ]; then\n      printf 'null'\n      exit 0\n    fi\n    printf '"${cliPkg.version}"'\n    exit 0\n  fi\n  if [ "$2" = "${cliPkg.name}@${tag}" ] && [ "$3" = "version" ]; then\n    if [ "$count" -lt 4 ]; then\n      printf 'null'\n      exit 0\n    fi\n    printf '"${cliPkg.version}"'\n    exit 0\n  fi\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;

    withTempRegistryScript(body, (mockPath) => {
      try {
        const out = execFileSync(
          process.execPath,
          [scriptPath, "verify-npm", "--package", "cli"],
          {
            cwd: repoRoot,
            encoding: "utf-8",
            env: {
              ...process.env,
              PATH: `${path.dirname(mockPath)}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          },
        );
        expect(out).toContain(`${cliPkg.name}@${cliPkg.version} visible on npm tag`);
      } finally {
        fs.rmSync(counterPath, { force: true });
      }
    });
  }, 30000);
});

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

  it("retries until published CLI metadata becomes visible", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
    };
    const counterPath = path.join(os.tmpdir(), `trellis-release-preflight-counter-${process.pid}-${Date.now()}.txt`);

    const body =
      process.platform === "win32"
        ? `@echo off\r\nsetlocal EnableDelayedExpansion\r\nif "%1"=="view" if "%2"=="${cliPkg.name}@${cliPkg.version}" if "%3"=="dependencies" (\r\n  set COUNT=0\r\n  if exist "${counterPath}" set /p COUNT=<"${counterPath}"\r\n  set /a COUNT=!COUNT!+1\r\n  > "${counterPath}" echo !COUNT!\r\n  if !COUNT! LSS 3 (\r\n    echo {}\r\n    exit /b 0\r\n  )\r\n  echo {"${corePkg.name}":"${cliPkg.version}"}\r\n  exit /b 0\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 1\r\n`
        : `#!/bin/sh\nif [ "$1" = "view" ] && [ "$2" = "${cliPkg.name}@${cliPkg.version}" ] && [ "$3" = "dependencies" ]; then\n  count=0\n  if [ -f '${counterPath}' ]; then\n    count=$(cat '${counterPath}')\n  fi\n  count=$((count + 1))\n  printf '%s' "$count" > '${counterPath}'\n  if [ "$count" -lt 3 ]; then\n    printf '{}'\n    exit 0\n  fi\n  printf '{"${corePkg.name}":"${cliPkg.version}"}'\n  exit 0\nfi\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 1\n`;

    withTempRegistryScript(body, (mockPath) => {
      try {
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
      } finally {
        fs.rmSync(counterPath, { force: true });
      }
    });
  }, 30000);

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
