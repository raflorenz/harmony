// ---------------------------------------------------------------------------
// Policy Layer – WORKFLOW.md Loader (Spec Section 5)
// ---------------------------------------------------------------------------
import { readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "chokidar";
import * as yaml from "js-yaml";
import type { WorkflowDefinition } from "../tracker/types";

// ---- Error types -----------------------------------------------------------

export class WorkflowLoadError extends Error {
  constructor(
    public readonly type:
      | "missing_workflow_file"
      | "workflow_front_matter_not_a_map"
      | "workflow_parse_error",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowLoadError";
  }
}

// ---- Front-matter parsing --------------------------------------------------

const FRONT_MATTER_FENCE = "---";

interface ParsedDocument {
  config: Record<string, unknown>;
  promptTemplate: string;
}

/**
 * Splits a workflow document into its YAML front-matter config and prompt body.
 *
 * Rules (per spec Section 5):
 *  - If the file starts with '---', everything until the next '---' is YAML.
 *  - The remaining lines become the prompt body.
 *  - If there is no front matter, the entire file is the prompt body and
 *    config defaults to an empty object.
 *  - The YAML front matter must decode to a map/object; any other type
 *    (string, array, null) is an error.
 *  - The prompt body is trimmed of leading/trailing whitespace.
 */
function parseWorkflowDocument(raw: string): ParsedDocument {
  const lines = raw.split(/\r?\n/);

  // No front matter – entire file is the prompt template.
  if (lines[0]?.trimEnd() !== FRONT_MATTER_FENCE) {
    return {
      config: {},
      promptTemplate: raw.trim(),
    };
  }

  // Find the closing fence (skip the opening '---' at index 0).
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === FRONT_MATTER_FENCE) {
      closingIndex = i;
      break;
    }
  }

  // If there is no closing fence, treat the entire file as prompt body with
  // no config (graceful degradation).
  if (closingIndex === -1) {
    return {
      config: {},
      promptTemplate: raw.trim(),
    };
  }

  const yamlBlock = lines.slice(1, closingIndex).join("\n");
  const promptBody = lines.slice(closingIndex + 1).join("\n").trim();

  // Parse the YAML block.
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlBlock);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown YAML parse error";
    throw new WorkflowLoadError("workflow_parse_error", message);
  }

  // An empty YAML block (all blank lines) decodes to `undefined` / `null`.
  // Treat that as an empty config rather than an error.
  if (parsed === undefined || parsed === null) {
    return {
      config: {},
      promptTemplate: promptBody,
    };
  }

  // The YAML value MUST be a plain object (map).  Arrays, strings, numbers,
  // etc. are rejected.
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowLoadError(
      "workflow_front_matter_not_a_map",
      `Workflow front matter must be a YAML map, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }

  return {
    config: parsed as Record<string, unknown>,
    promptTemplate: promptBody,
  };
}

// ---- Public API ------------------------------------------------------------

/**
 * Load and parse a WORKFLOW.md file into a {@link WorkflowDefinition}.
 *
 * @param filePath  Absolute or relative path to the workflow file.
 * @returns A promise that resolves to the parsed definition.
 * @throws {WorkflowLoadError} with `type` indicating the failure reason.
 */
export async function loadWorkflow(
  filePath: string,
): Promise<WorkflowDefinition> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    throw new WorkflowLoadError(
      "missing_workflow_file",
      `Cannot read workflow file: ${filePath}`,
    );
  }

  const { config, promptTemplate } = parseWorkflowDocument(raw);
  return { config, promptTemplate };
}

/**
 * Watch a workflow file for changes and invoke a callback with the updated
 * definition whenever the file is written.
 *
 * Invalid reloads (parse errors, missing file, etc.) are caught so the watcher
 * remains active.  The last known-good definition is *not* re-emitted on
 * failure – consumers keep whichever version they received last.
 *
 * @param filePath  Path to the workflow file to watch.
 * @param onChange  Called with the new definition on every successful reload.
 * @returns The underlying {@link FSWatcher} so callers can `.close()` it.
 */
export function watchWorkflow(
  filePath: string,
  onChange: (def: WorkflowDefinition) => void,
): FSWatcher {
  const watcher = watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  const handleChange = async (): Promise<void> => {
    try {
      const def = await loadWorkflow(filePath);
      onChange(def);
    } catch (err) {
      // Spec: invalid reloads must not crash; emit error and keep last good
      // config.  We log to stderr so the event is observable without
      // propagating the exception.
      const message =
        err instanceof Error ? err.message : "Unknown reload error";
      console.error(
        `[workflow-loader] failed to reload ${filePath}: ${message}`,
      );
    }
  };

  watcher.on("change", handleChange);

  return watcher;
}
