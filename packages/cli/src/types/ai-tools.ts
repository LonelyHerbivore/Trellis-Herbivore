/**
 * AI Tool Types and Registry
 *
 * Defines supported AI coding tools and which command templates they can use.
 */

/**
 * Supported AI coding tools
 */
export type AITool =
  | "claude-code"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "windsurf"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "pi";

/**
 * Template directory categories
 */
export type TemplateDir =
  | "common"
  | "claude"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "windsurf"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "pi";

/**
 * CLI flag names for platform selection (e.g., --claude, --cursor, --kilo, --kiro, --gemini, --antigravity)
 * Must match keys in InitOptions (src/commands/init.ts)
 */
export type CliFlag =
  | "claude"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "windsurf"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "pi";

/**
 * Template context for placeholder resolution.
 * Controls how common templates are rendered per platform.
 */
export interface TemplateContext {
  /** Prefix for cross-referencing other commands/skills */
  cmdRefPrefix: "/trellis:" | "/trellis-" | "$" | "/";
  /** Description of AI executor actions shown in role tables */
  executorAI:
    | "Bash scripts or Task calls"
    | "Bash scripts or tool calls"
    | "Bash scripts or file reads";
  /** Label for user-invocable actions */
  userActionLabel: "Slash commands" | "Skills" | "Workflows" | "Prompts";
  /** Platform supports spawning sub-agents with isolated context */
  agentCapable: boolean;
  /** Platform has hook system (SessionStart, PreToolUse) */
  hasHooks: boolean;
}

/** Template context with the CLI flag materialized from the platform registry. */
export interface PlatformTemplateContext extends TemplateContext {
  cliFlag: CliFlag;
}

/**
 * Configuration for an AI tool
 */
export interface AIToolConfig {
  /** Display name of the tool */
  name: string;
  /** Command template directory names to include */
  templateDirs: TemplateDir[];
  /** Config directory name in the project root (e.g., ".claude") */
  configDir: string;
  /**
   * Whether the platform supports the shared `.agents/skills/` layer
   * (agentskills.io open standard). When true, `.agents/skills` is added
   * to the platform's managed paths automatically.
   */
  supportsAgentSkills?: boolean;
  /** Additional managed paths beyond configDir (e.g., .github/hooks for Copilot) */
  extraManagedPaths?: string[];
  /** CLI flag name for --flag options (e.g., "claude" for --claude) */
  cliFlag: CliFlag;
  /** Whether this platform is exposed by the user-facing `trellis init`. */
  initEnabled: boolean;
  /** Whether this tool is checked by default in interactive init prompt */
  defaultChecked: boolean;
  /** Whether this tool uses Python hooks (affects Windows encoding detection) */
  hasPythonHooks: boolean;
  /** Template context for placeholder resolution in common templates */
  templateContext: TemplateContext;
}

/**
 * Registry of all supported AI tools and their configurations.
 * This is the single source of truth for platform data.
 *
 * When adding a new platform, add an entry here and create:
 * 1. src/configurators/{platform}.ts — configure function
 * 2. src/templates/{platform}/ — template files
 * 3. Register in src/configurators/index.ts — PLATFORM_FUNCTIONS
 * 4. The public init flag is derived from `initEnabled` and `cliFlag`.
 */
export const AI_TOOLS: Record<AITool, AIToolConfig> = {
  "claude-code": {
    name: "Claude Code",
    templateDirs: ["common", "claude"],
    configDir: ".claude",
    cliFlag: "claude",
    initEnabled: true,
    defaultChecked: true,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
  cursor: {
    name: "Cursor",
    templateDirs: ["common", "cursor"],
    configDir: ".cursor",
    cliFlag: "cursor",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
  opencode: {
    name: "OpenCode",
    templateDirs: ["common", "opencode"],
    configDir: ".opencode",
    cliFlag: "opencode",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: false,
    },
  },
  codex: {
    name: "Codex",
    templateDirs: ["common", "codex"],
    configDir: ".codex",
    supportsAgentSkills: true,
    cliFlag: "codex",
    initEnabled: true,
    defaultChecked: true,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Skills",
      agentCapable: true,
      hasHooks: false,
    },
  },
  kilo: {
    name: "Kilo CLI",
    templateDirs: ["common", "kilo"],
    configDir: ".kilocode",
    cliFlag: "kilo",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or file reads",
      userActionLabel: "Workflows",
      agentCapable: false,
      hasHooks: false,
    },
  },
  kiro: {
    name: "Kiro Code",
    templateDirs: ["common", "kiro"],
    configDir: ".kiro/skills",
    extraManagedPaths: [".kiro/agents", ".kiro/hooks"],
    cliFlag: "kiro",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Skills",
      agentCapable: true,
      hasHooks: true,
    },
  },
  gemini: {
    name: "Gemini CLI",
    templateDirs: ["common", "gemini"],
    configDir: ".gemini",
    supportsAgentSkills: true,
    cliFlag: "gemini",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
  antigravity: {
    name: "Antigravity",
    templateDirs: ["common", "antigravity"],
    configDir: ".agent/workflows",
    extraManagedPaths: [".agent/skills"],
    cliFlag: "antigravity",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/",
      executorAI: "Bash scripts or file reads",
      userActionLabel: "Workflows",
      agentCapable: false,
      hasHooks: false,
    },
  },
  windsurf: {
    name: "Windsurf",
    templateDirs: ["common", "windsurf"],
    configDir: ".windsurf/workflows",
    extraManagedPaths: [".windsurf/skills"],
    cliFlag: "windsurf",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      executorAI: "Bash scripts or file reads",
      userActionLabel: "Workflows",
      agentCapable: false,
      hasHooks: false,
    },
  },
  qoder: {
    name: "Qoder",
    templateDirs: ["common", "qoder"],
    configDir: ".qoder",
    cliFlag: "qoder",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Skills",
      agentCapable: true,
      hasHooks: true,
    },
  },
  codebuddy: {
    name: "CodeBuddy",
    templateDirs: ["common", "codebuddy"],
    configDir: ".codebuddy",
    cliFlag: "codebuddy",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
  copilot: {
    name: "GitHub Copilot",
    templateDirs: ["common", "copilot"],
    configDir: ".github/copilot",
    extraManagedPaths: [
      ".github/agents",
      ".github/hooks",
      ".github/prompts",
      ".github/skills",
    ],
    cliFlag: "copilot",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Prompts",
      agentCapable: true,
      hasHooks: true,
    },
  },
  droid: {
    name: "Factory Droid",
    templateDirs: ["common", "droid"],
    configDir: ".factory",
    cliFlag: "droid",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      executorAI: "Bash scripts or Task calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
  pi: {
    name: "Pi Agent",
    templateDirs: ["common", "pi"],
    configDir: ".pi",
    cliFlag: "pi",
    initEnabled: false,
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      executorAI: "Bash scripts or tool calls",
      userActionLabel: "Slash commands",
      agentCapable: true,
      hasHooks: true,
    },
  },
};

/**
 * Get the configuration for a specific AI tool
 */
export function getToolConfig(tool: AITool): AIToolConfig {
  return AI_TOOLS[tool];
}

/**
 * Get all managed paths for a specific tool.
 */
export function getManagedPaths(tool: AITool): string[] {
  const config = AI_TOOLS[tool];
  const paths = [config.configDir];
  if (config.supportsAgentSkills) {
    paths.push(".agents/skills");
  }
  if (config.extraManagedPaths) {
    paths.push(...config.extraManagedPaths);
  }
  return paths;
}

/**
 * Get template directories for a specific tool
 */
export function getTemplateDirs(tool: AITool): TemplateDir[] {
  return AI_TOOLS[tool].templateDirs;
}

/** Materialize render context from registry-owned platform metadata. */
export function getTemplateContext(tool: AITool): PlatformTemplateContext {
  return {
    ...AI_TOOLS[tool].templateContext,
    cliFlag: AI_TOOLS[tool].cliFlag,
  };
}
