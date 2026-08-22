import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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
  const mockPath = path.join(
    tmpDir,
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
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
        {
          name: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          body: pnpmBody,
        },
        {
          name: process.platform === "win32" ? "tar.cmd" : "tar",
          body: tarBody,
        },
      ],
      (binDir) => {
        const out = execFileSync(
          process.execPath,
          [scriptPath, "verify-packed-cli"],
          {
            cwd: repoRoot,
            encoding: "utf-8",
            env: {
              ...process.env,
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          },
        );
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
        {
          name: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          body: pnpmBody,
        },
        {
          name: process.platform === "win32" ? "tar.cmd" : "tar",
          body: tarBody,
        },
      ],
      (binDir) => {
        try {
          const out = execFileSync(
            process.execPath,
            [scriptPath, "verify-packed-cli"],
            {
              cwd: repoRoot,
              encoding: "utf-8",
              env: {
                ...process.env,
                PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
              },
            },
          );
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

describe("release-preflight pack-publish-artifacts", () => {
  it("keeps publish tarballs outside the repository checkout", () => {
    const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
      name: string;
      version: string;
    };
    const existingPackDirs = fs
      .readdirSync(repoRoot)
      .filter((entry) => entry.startsWith(".publish-pack-"));
    const pnpmBody =
      process.platform === "win32"
        ? `@echo off\r\nif not "%1"=="pack" exit /b 1\r\nif not "%2"=="--pack-destination" exit /b 1\r\nnode -e "const fs=require('node:fs'); const path=require('node:path'); const pkg=JSON.parse(fs.readFileSync(path.join(process.cwd(),'package.json'),'utf8')); const output=path.join(process.argv[1], pkg.name+'-'+pkg.version+'.tgz'); fs.writeFileSync(output, ''); process.stdout.write(output+'\\r\\n');" "%3"\r\n`
        : `#!/bin/sh\nif [ "$1" != "pack" ] || [ "$2" != "--pack-destination" ]; then exit 1; fi\nnode -e "const fs=require('node:fs'); const path=require('node:path'); const pkg=JSON.parse(fs.readFileSync(path.join(process.cwd(),'package.json'),'utf8')); const output=path.join(process.argv[1], pkg.name+'-'+pkg.version+'.tgz'); fs.writeFileSync(output, ''); process.stdout.write(output+'\\n');" "$3"\n`;

    withTempBinScripts(
      [
        {
          name: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          body: pnpmBody,
        },
      ],
      (binDir) => {
        const out = execFileSync(
          process.execPath,
          [scriptPath, "pack-publish-artifacts"],
          {
            cwd: repoRoot,
            encoding: "utf-8",
            env: {
              ...process.env,
              PATH: binDir + path.delimiter + (process.env.PATH ?? ""),
            },
          },
        );
        const result = JSON.parse(out) as {
          core: { tarball: string };
          cli: { tarball: string };
        };
        expect(path.dirname(result.core.tarball)).not.toBe(repoRoot);
        expect(path.dirname(result.cli.tarball)).not.toBe(repoRoot);
        expect(path.basename(result.core.tarball)).toBe(
          corePkg.name + "-" + corePkg.version + ".tgz",
        );
        expect(path.basename(result.cli.tarball)).toBe(
          cliPkg.name + "-" + cliPkg.version + ".tgz",
        );
        expect(fs.existsSync(result.core.tarball)).toBe(true);
        expect(fs.existsSync(result.cli.tarball)).toBe(true);
        fs.rmSync(path.dirname(result.core.tarball), {
          recursive: true,
          force: true,
        });
        expect(
          fs
            .readdirSync(repoRoot)
            .filter((entry) => entry.startsWith(".publish-pack-")),
        ).toEqual(existingPackDirs);
      },
    );
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
        expect(out).toContain(
          `${cliPkg.name}@${cliPkg.version} visible on npm tag`,
        );
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
    const counterPath = path.join(
      os.tmpdir(),
      `trellis-release-preflight-counter-${process.pid}-${Date.now()}.txt`,
    );

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

describe("release tarball clean-install", () => {
  it(
    "installs CLI/core tgz in a clean consumer and exercises both platforms",
    { timeout: 180000 },
    () => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const cliPackage = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
        name: string;
        version: string;
      };
      const corePackage = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")) as {
        name: string;
        version: string;
      };
      const consumerEnv = { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false" };
      delete consumerEnv.NODE_PATH;
      delete consumerEnv.NODE_OPTIONS;
      const repoRootToken = fs
        .realpathSync(repoRoot)
        .replaceAll("\\", "/")
        .toLowerCase();
      const forbiddenTokens = [
        "matt-skills-main",
        "d:/trellis",
        "c:/users/asus",
        repoRootToken,
        repoRootToken.replace(/^([a-z]):/, "/$1"),
      ];
      const pathForbiddenTokens = [
        "matt-skills-main",
        repoRootToken,
        repoRootToken.replace(/^([a-z]):/, "/$1"),
      ];
      const assertNoConsumerDevelopmentPaths = (root: string): void => {
        const stack = [root];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          const normalizedPath = current.replaceAll("\\", "/").toLowerCase();
          for (const token of pathForbiddenTokens) {
            expect(normalizedPath).not.toContain(token);
          }
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
              stack.push(fullPath);
              continue;
            }
            if (!entry.isFile()) continue;
            const bytes = fs.readFileSync(fullPath);
            const content = bytes.toString("utf-8");
            if (!bytes.includes(0)) {
              const normalized = content.replaceAll("\\", "/").toLowerCase();
              for (const token of forbiddenTokens) {
                expect(normalized).not.toContain(token);
              }
              expect(content).not.toMatch(/\r(?!\n)/);
            }
          }
        }
      };
      const runNpm = (args: string[], cwd: string): void => {
        execFileSync(npm, args, {
          cwd,
          stdio: "pipe",
          shell: process.platform === "win32",
          env: consumerEnv,
        });
      };
      const runPackageManager = (args: string[], cwd: string): void => {
        execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
          cwd,
          stdio: "pipe",
          shell: process.platform === "win32",
        });
      };
      const packDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "trellis-tarball-pack-"),
      );
      const consumerRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "trellis-clean-consumer-"),
      );
      const globalPrefix = path.join(consumerRoot, "global-prefix");
      const globalNodeModules =
        process.platform === "win32"
          ? path.join(globalPrefix, "node_modules")
          : path.join(globalPrefix, "lib", "node_modules");
      const globalCliRoot = path.join(globalNodeModules, cliPackage.name);
      const runBinary = (cwd: string, args: string[]): string =>
        execFileSync(
          process.execPath,
          [
            path.join(
              consumerRoot,
              "node_modules",
              cliPackage.name,
              "bin",
              "trellis.js",
            ),
            ...args,
          ],
          {
            cwd,
            encoding: "utf-8",
            env: consumerEnv,
          },
        );
      const runGlobalBinary = (cwd: string, args: string[]): string => {
        const entry = path.join(globalCliRoot, "bin", "trellis.js");
        return execFileSync(process.execPath, [entry, ...args], {
          cwd,
          encoding: "utf-8",
          env: consumerEnv,
        });
      };

      try {
        runPackageManager(["build"], repoRoot);
        runPackageManager(
          ["pack", "--pack-destination", packDir],
          path.join(repoRoot, "packages/core"),
        );
        runPackageManager(
          ["pack", "--pack-destination", packDir],
          path.join(repoRoot, "packages/cli"),
        );
        const manifestOutput = execFileSync(
          process.execPath,
          [scriptPath, "verify-tarball-manifest"],
          { cwd: repoRoot, encoding: "utf-8", env: consumerEnv },
        );
        expect(manifestOutput).toContain("tarballs contain runtime assets");
        const tarballs = fs
          .readdirSync(packDir)
          .filter((name) => name.endsWith(".tgz"));
        const coreTarballName = tarballs.find((name) =>
          name.startsWith(`${corePackage.name}-`),
        );
        const cliTarballName = tarballs.find(
          (name) =>
            name.startsWith(`${cliPackage.name}-`) &&
            !name.startsWith(`${corePackage.name}-`),
        );
        expect(coreTarballName).toBeDefined();
        expect(cliTarballName).toBeDefined();
        expect(cliTarballName).not.toBe(coreTarballName);
        const coreTarball = path.join(packDir, coreTarballName as string);
        const cliTarball = path.join(packDir, cliTarballName as string);
        expect(fs.existsSync(coreTarball)).toBe(true);
        expect(fs.existsSync(cliTarball)).toBe(true);

        runNpm(["init", "-y"], consumerRoot);
        const runtimeCoreTarball = path.join(
          consumerRoot,
          "artifacts",
          coreTarballName as string,
        );
        const runtimeCliTarball = path.join(
          consumerRoot,
          "artifacts",
          cliTarballName as string,
        );
        fs.mkdirSync(path.dirname(runtimeCoreTarball), { recursive: true });
        fs.copyFileSync(coreTarball, runtimeCoreTarball);
        fs.copyFileSync(cliTarball, runtimeCliTarball);
        expect(runtimeCoreTarball).not.toContain(repoRoot);
        expect(runtimeCliTarball).not.toContain(repoRoot);
        runNpm(
          [
            "install",
            "--global",
            "--prefix",
            globalPrefix,
            "--no-audit",
            "--no-fund",
            runtimeCoreTarball,
            runtimeCliTarball,
          ],
          consumerRoot,
        );
        const globalCliEntry = path.join(globalCliRoot, "bin", "trellis.js");
        expect(fs.existsSync(globalCliEntry)).toBe(true);
        assertNoConsumerDevelopmentPaths(globalCliRoot);
        const globalClaude = path.join(consumerRoot, "global-claude");
        const globalCodex = path.join(consumerRoot, "global-codex");
        fs.mkdirSync(globalClaude, { recursive: true });
        fs.mkdirSync(globalCodex, { recursive: true });
        runGlobalBinary(globalClaude, ["init", "--claude", "--yes"]);
        runGlobalBinary(globalCodex, ["init", "--codex", "--yes"]);
        runGlobalBinary(globalClaude, ["update", "--migrate", "--force"]);
        expect(fs.existsSync(path.join(globalClaude, "CLAUDE.md"))).toBe(true);
        expect(fs.existsSync(path.join(globalClaude, "AGENTS.md"))).toBe(true);
        expect(fs.existsSync(path.join(globalClaude, ".trellis", "workflow.md"))).toBe(
          true,
        );
        expect(fs.existsSync(path.join(globalCodex, "AGENTS.md"))).toBe(true);
        runNpm(
          [
            "install",
            "--no-audit",
            "--no-fund",
            `./artifacts/${coreTarballName}`,
            `./artifacts/${cliTarballName}`,
          ],
          consumerRoot,
        );
        const installedCliRoot = path.join(
          consumerRoot,
          "node_modules",
          cliPackage.name,
        );
        const installedCoreRoot = path.join(
          consumerRoot,
          "node_modules",
          corePackage.name,
        );
        expect(fs.realpathSync(installedCliRoot)).toContain(
          fs.realpathSync(consumerRoot),
        );
        expect(fs.realpathSync(installedCoreRoot)).toContain(
          fs.realpathSync(consumerRoot),
        );
        expect(fs.realpathSync(installedCliRoot)).not.toContain(
          fs.realpathSync(repoRoot),
        );
        expect(fs.realpathSync(installedCoreRoot)).not.toContain(
          fs.realpathSync(repoRoot),
        );
        assertNoConsumerDevelopmentPaths(installedCliRoot);
        assertNoConsumerDevelopmentPaths(installedCoreRoot);

        const claudeOnly = path.join(consumerRoot, "claude-only");
        const codexOnly = path.join(consumerRoot, "codex-only");
        const mixed = path.join(consumerRoot, "mixed");
        for (const dir of [claudeOnly, codexOnly, mixed])
          fs.mkdirSync(dir, { recursive: true });
        runBinary(claudeOnly, ["init", "--claude", "--yes"]);
        runBinary(codexOnly, ["init", "--codex", "--yes"]);
        runBinary(mixed, ["init", "--claude", "--codex", "--yes"]);
        runBinary(claudeOnly, ["init", "--codex", "--yes"]);
        runBinary(codexOnly, ["init", "--claude", "--yes"]);
        runBinary(mixed, ["update", "--migrate", "--force"]);

        expect(fs.existsSync(path.join(claudeOnly, "CLAUDE.md"))).toBe(true);
        expect(
          fs.existsSync(
            path.join(
              claudeOnly,
              ".codex",
              "agents",
              "trellis-code-review.toml",
            ),
          ),
        ).toBe(true);
        expect(fs.existsSync(path.join(codexOnly, "AGENTS.md"))).toBe(true);
        expect(
          fs.existsSync(
            path.join(codexOnly, ".claude", "agents", "trellis-code-review.md"),
          ),
        ).toBe(true);
        expect(fs.existsSync(path.join(mixed, "CLAUDE.md"))).toBe(true);
        expect(fs.existsSync(path.join(mixed, "AGENTS.md"))).toBe(true);
        expect(fs.existsSync(path.join(mixed, ".trellis", "workflow.md"))).toBe(
          true,
        );

        const taskScript = path.join(mixed, ".trellis", "scripts", "task.py");
        const contextScript = path.join(
          mixed,
          ".trellis",
          "scripts",
          "get_context.py",
        );
        const python = process.platform === "win32" ? "py" : "python3";
        const runTask = (args: string[]): string =>
          execFileSync(
            python,
            process.platform === "win32"
              ? ["-3", taskScript, ...args]
              : [taskScript, ...args],
            {
              cwd: mixed,
              encoding: "utf-8",
              env: { ...consumerEnv, TRELLIS_CONTEXT_ID: "tarball-e2e" },
            },
          );
        const runPhase = (step: string): string =>
          execFileSync(
            python,
            process.platform === "win32"
              ? ["-3", contextScript, "--mode", "phase", "--step", step]
              : [contextScript, "--mode", "phase", "--step", step],
            {
              cwd: mixed,
              encoding: "utf-8",
              env: { ...consumerEnv, TRELLIS_CONTEXT_ID: "tarball-e2e" },
            },
          );

        runTask([
          "create",
          "tarball smoke",
          "--slug",
          "tarball-smoke",
          "--assignee",
          "codex",
        ]);
        const tasksRoot = path.join(mixed, ".trellis", "tasks");
        const taskDirName = fs
          .readdirSync(tasksRoot)
          .find((name) => name.includes("tarball-smoke"));
        expect(taskDirName).toBeDefined();
        const taskDir = path.join(tasksRoot, taskDirName as string);
        const taskJsonPath = path.join(taskDir, "task.json");
        const taskRecord = JSON.parse(
          fs.readFileSync(taskJsonPath, "utf-8"),
        ) as Record<string, unknown>;
        expect(taskRecord.status).toBe("planning");
        expect(runTask(["current", "--source"])).toContain("tarball-smoke");
        runTask([
          "add-context",
          taskDir,
          "implement",
          ".trellis/workflow.md",
          "workflow phase contract",
        ]);
        runTask([
          "add-context",
          taskDir,
          "check",
          ".trellis/workflow.md",
          "workflow validation",
        ]);
        expect(runPhase("1.1")).toContain("Requirement exploration");
        expect(runPhase("1.4")).toContain("Activate task");
        taskRecord.worktree_path = mixed;
        taskRecord.workflow = {
          contract: "explicit-selection-v1",
          host: "codex",
          execution_mode: "main-session",
          worktree_mode: "current-checkout",
          development_flow: "default",
          review_gates: {
            enabled: [
              "spec-review",
              "code-review",
              "code-architecture-review",
              "merge-review",
            ],
            disabled: [],
            runs: {
              "spec-review": {
                status: "pending",
                attempts: 0,
                report_path: null,
              },
              "code-review": {
                status: "pending",
                attempts: 0,
                report_path: null,
              },
              "code-architecture-review": {
                status: "pending",
                attempts: 0,
                report_path: null,
              },
              "merge-review": {
                status: "pending",
                attempts: 0,
                report_path: null,
              },
            },
          },
        };
        fs.writeFileSync(
          taskJsonPath,
          JSON.stringify(taskRecord, null, 2) + "\n",
          "utf-8",
        );
        fs.writeFileSync(
          path.join(taskDir, "prd.md"),
          "# Tarball smoke PRD\n\n## Acceptance\n\n- clean install works\n",
          "utf-8",
        );
        fs.writeFileSync(
          path.join(taskDir, "design.md"),
          "# Strategy\n\nDefault flow, current checkout, Codex main session.\n",
          "utf-8",
        );
        fs.writeFileSync(
          path.join(taskDir, "implement.md"),
          "# Implement\n\nTask -> planning -> strategy -> implement -> reviews -> merge-review -> final validation.\n",
          "utf-8",
        );
        expect(runTask(["validate", taskDir])).toContain(
          "All validations passed",
        );
        expect(runTask(["finish"])).toContain("Cleared current task");
        expect(runTask(["start", taskDir])).toContain("Status: planning");
        expect(runTask(["current"])).toContain("tarball-smoke");
        expect(runPhase("2.1")).toContain("Implement");

        taskRecord.status = "in_progress";
        const reportsDir = path.join(taskDir, "reports");
        fs.mkdirSync(reportsDir, { recursive: true });
        for (const gate of [
          "spec-review",
          "code-review",
          "code-architecture-review",
          "merge-review",
        ]) {
          fs.writeFileSync(
            path.join(reportsDir, gate + ".md"),
            "# " + gate + "\n\n结论：PASS。\n",
            "utf-8",
          );
          (
            taskRecord.workflow as {
              review_gates: { runs: Record<string, unknown> };
            }
          ).review_gates.runs[gate] = {
            status: "PASS",
            attempts: 1,
            report_path: "reports/" + gate + ".md",
          };
          fs.writeFileSync(
            taskJsonPath,
            JSON.stringify(taskRecord, null, 2) + "\n",
            "utf-8",
          );
          expect(runTask(["validate", taskDir])).toContain(
            "All validations passed",
          );
        }
        expect(runPhase("3.1")).toContain("Quality verification");
        expect(runPhase("3.5")).toContain("Merge & Final Verification");
        const archiveOutput = runTask(["archive", taskDir, "--no-commit"]);
        expect(archiveOutput).toContain(".trellis/tasks/archive/");
        expect(fs.existsSync(taskDir)).toBe(false);

        for (const generatedPath of [
          path.join(mixed, "AGENTS.md"),
          path.join(mixed, "CLAUDE.md"),
          path.join(mixed, ".trellis", "workflow.md"),
        ]) {
          const generated = fs.readFileSync(generatedPath, "utf-8");
          const normalized = generated.replaceAll("\\", "/").toLowerCase();
          for (const token of forbiddenTokens) {
            expect(normalized).not.toContain(token);
          }
          expect(generated).toMatch(/\n/);
          expect(generated).not.toMatch(/\r(?!\n)/);
        }
      } finally {
        fs.rmSync(packDir, { recursive: true, force: true });
        fs.rmSync(consumerRoot, { recursive: true, force: true });
      }
    },
  );
});

describe("check-docs-changelog", () => {
  it("skips when docs-site is absent from the checkout", () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-check-docs-changelog-"),
    );
    const cliDir = path.join(tmpRoot, "packages", "cli");
    const scriptsDir = path.join(cliDir, "scripts");
    const checkScriptPath = path.join(scriptsDir, "check-docs-changelog.js");

    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(cliDir, "package.json"),
      JSON.stringify({ version: "0.6.0-beta.23" }, null, 2),
      "utf-8",
    );
    fs.copyFileSync(
      path.join(repoRoot, "packages/cli/scripts/check-docs-changelog.js"),
      checkScriptPath,
    );
    fs.copyFileSync(
      path.join(repoRoot, "packages/cli/scripts/bump-versions.js"),
      path.join(scriptsDir, "bump-versions.js"),
    );

    try {
      const result = spawnSync(
        process.execPath,
        [checkScriptPath, "--type", "beta"],
        {
          cwd: tmpRoot,
          encoding: "utf-8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("docs-site/");
      expect(result.stderr).toContain("skipping changelog guard");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
