/**
 * Markdown templates for Trellis workflow
 *
 * These are GENERIC templates for new projects.
 * Structure templates use .md.txt extension as they are generic templates.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read a template file from src/templates/markdown/
 */
function readLocalTemplate(filename: string): string {
  const filePath = join(__dirname, filename);
  return readFileSync(filePath, "utf-8");
}

// =============================================================================
// Root files for new projects
// =============================================================================

const rootInstructionsContent: string = readLocalTemplate(
  "root-instructions.md",
);

const rootInstructionsEol = rootInstructionsContent.includes("\r\n")
  ? "\r\n"
  : "\n";
const managedFooter =
  "Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.";
const TRELLIS_BLOCK_START = "<!-- TRELLIS:START -->";
const TRELLIS_BLOCK_END = "<!-- TRELLIS:END -->";

export function getTrellisManagedBlock(content: string): string | null {
  const start = content.indexOf(TRELLIS_BLOCK_START);
  if (start === -1) return null;

  const end = content.indexOf(TRELLIS_BLOCK_END, start);
  if (end === -1) return null;

  return content.slice(start, end + TRELLIS_BLOCK_END.length);
}

export function replaceTrellisManagedBlock(
  existingContent: string,
  templateContent: string,
): string | null {
  const existingStart = existingContent.indexOf(TRELLIS_BLOCK_START);
  if (existingStart === -1) return null;

  const existingEnd = existingContent.indexOf(TRELLIS_BLOCK_END, existingStart);
  if (existingEnd === -1) return null;

  const templateBlock = getTrellisManagedBlock(templateContent);
  if (!templateBlock) return null;

  return (
    existingContent.slice(0, existingStart) +
    templateBlock +
    existingContent.slice(existingEnd + TRELLIS_BLOCK_END.length)
  );
}

export const agentsMdContent: string = rootInstructionsContent.replace(
  managedFooter,
  "Codex fallback: if Trellis context was not injected (for example hooks are disabled or unapproved), invoke `$trellis-start` once before Trellis-managed work." +
    rootInstructionsEol +
    rootInstructionsEol +
    managedFooter,
);
export const claudeMdContent: string = rootInstructionsContent;

// Workspace index template (developer work records)
export const workspaceIndexContent: string =
  readLocalTemplate("workspace-index.md");

// Backwards compatibility alias
export const agentProgressIndexContent = workspaceIndexContent;

// Gitignore (template file - .gitignore is ignored by npm)
export const workflowGitignoreContent: string =
  readLocalTemplate("gitignore.txt");

// =============================================================================
// Structure templates (generic templates from .txt files)
// These are NOT dogfooded - they are generic templates for new projects
// =============================================================================

// Backend structure (multi-doc format)
export const backendIndexContent: string = readLocalTemplate(
  "spec/backend/index.md.txt",
);
export const backendDirectoryStructureContent: string = readLocalTemplate(
  "spec/backend/directory-structure.md.txt",
);
export const backendDatabaseGuidelinesContent: string = readLocalTemplate(
  "spec/backend/database-guidelines.md.txt",
);
export const backendLoggingGuidelinesContent: string = readLocalTemplate(
  "spec/backend/logging-guidelines.md.txt",
);
export const backendQualityGuidelinesContent: string = readLocalTemplate(
  "spec/backend/quality-guidelines.md.txt",
);
export const backendErrorHandlingContent: string = readLocalTemplate(
  "spec/backend/error-handling.md.txt",
);

// Frontend structure (multi-doc format)
export const frontendIndexContent: string = readLocalTemplate(
  "spec/frontend/index.md.txt",
);
export const frontendDirectoryStructureContent: string = readLocalTemplate(
  "spec/frontend/directory-structure.md.txt",
);
export const frontendTypeSafetyContent: string = readLocalTemplate(
  "spec/frontend/type-safety.md.txt",
);
export const frontendHookGuidelinesContent: string = readLocalTemplate(
  "spec/frontend/hook-guidelines.md.txt",
);
export const frontendComponentGuidelinesContent: string = readLocalTemplate(
  "spec/frontend/component-guidelines.md.txt",
);
export const frontendQualityGuidelinesContent: string = readLocalTemplate(
  "spec/frontend/quality-guidelines.md.txt",
);
export const frontendStateManagementContent: string = readLocalTemplate(
  "spec/frontend/state-management.md.txt",
);

// Guides structure
export const guidesIndexContent: string = readLocalTemplate(
  "spec/guides/index.md.txt",
);
export const guidesCrossLayerThinkingGuideContent: string = readLocalTemplate(
  "spec/guides/cross-layer-thinking-guide.md.txt",
);
export const guidesCodeReuseThinkingGuideContent: string = readLocalTemplate(
  "spec/guides/code-reuse-thinking-guide.md.txt",
);
