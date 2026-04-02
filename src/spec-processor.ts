import YAML from "yaml";

export interface ProcessedSpec {
  paths: Record<string, Record<string, OperationInfo>>;
}

export interface OperationInfo {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterInfo[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

export interface ParameterInfo {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: unknown;
}

/**
 * Parse a YAML OpenAPI spec, resolve all $ref pointers inline, and return a
 * compact JSON structure suitable for search.
 */
export function processSpec(yamlText: string): ProcessedSpec {
  const raw = YAML.parse(yamlText) as Record<string, unknown>;
  const resolved = resolveRefs(raw, raw, new Set<string>()) as Record<string, unknown>;
  return extractPaths(resolved);
}

/**
 * Extract unique domain names from the spec (from tags or path prefixes).
 * Returns sorted by endpoint count descending.
 */
export function extractDomains(yamlText: string): string[] {
  const raw = YAML.parse(yamlText);
  const counts = new Map<string, number>();

  for (const [path, methods] of Object.entries(raw.paths ?? {})) {
    for (const [method, op] of Object.entries(
      methods as Record<string, unknown>
    )) {
      if (method.startsWith("x-") || method === "parameters") continue;
      const operation = op as Record<string, unknown>;

      // Prefer tags, fall back to path prefix
      const tags = (operation.tags as string[]) ?? [];
      if (tags.length > 0) {
        for (const tag of tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      } else {
        const prefix = extractPathPrefix(path);
        if (prefix) {
          counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        }
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function extractPathPrefix(path: string): string | undefined {
  // /api/v3/reservations/{id}/ → reservations
  const match = path.match(/^\/api\/v3\/([^/]+)/);
  return match?.[1];
}

function extractPaths(spec: Record<string, unknown>): ProcessedSpec {
  const paths: ProcessedSpec["paths"] = {};
  const rawPaths = (spec.paths ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  for (const [path, methods] of Object.entries(rawPaths)) {
    paths[path] = {};
    for (const [method, op] of Object.entries(methods)) {
      if (method.startsWith("x-") || method === "parameters") continue;
      const operation = op as Record<string, unknown>;

      paths[path][method.toUpperCase()] = {
        operationId: operation.operationId as string | undefined,
        summary: operation.summary as string | undefined,
        description: operation.description as string | undefined,
        tags: operation.tags as string[] | undefined,
        parameters: (operation.parameters as ParameterInfo[]) ?? [],
        requestBody: operation.requestBody ?? undefined,
        responses: operation.responses as Record<string, unknown> | undefined,
      };
    }
  }

  return { paths };
}

function resolveRefs(
  obj: unknown,
  root: Record<string, unknown>,
  seen: Set<string>
): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRefs(item, root, seen));
  }

  const record = obj as Record<string, unknown>;
  if ("$ref" in record && typeof record.$ref === "string") {
    const refPath = record.$ref;

    if (seen.has(refPath)) {
      return { $circular: refPath };
    }

    const resolved = followRef(refPath, root);
    if (resolved === undefined) {
      return { $unresolved: refPath };
    }

    // Clone seen set per branch to avoid false circular detection
    const branchSeen = new Set(seen);
    branchSeen.add(refPath);
    return resolveRefs(resolved, root, branchSeen);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = resolveRefs(value, root, seen);
  }
  return result;
}

function followRef(
  ref: string,
  root: Record<string, unknown>
): unknown | undefined {
  // #/components/schemas/Reservation → ["components", "schemas", "Reservation"]
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");

  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
