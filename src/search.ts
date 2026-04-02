import type { ProcessedSpec, OperationInfo } from "./spec-processor";
import { truncateResponse } from "./truncate";

interface SearchResult {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
  }>;
  requestBody?: unknown;
  successResponse?: unknown;
}

const METHOD_SYNONYMS: Record<string, string[]> = {
  GET: ["list", "get", "read", "fetch", "retrieve", "show", "find"],
  POST: ["create", "add", "new", "make", "post", "send"],
  PUT: ["replace", "set", "put"],
  PATCH: ["update", "change", "modify", "edit", "patch"],
  DELETE: ["delete", "remove", "destroy", "drop"],
};

const MAX_RESULTS = 10;

export function searchSpec(spec: ProcessedSpec, query: string): string {
  const tokens = tokenize(query);
  const scored: Array<{ score: number; result: SearchResult }> = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    const pathSegments = path.toLowerCase().split("/").filter(Boolean);

    for (const [method, op] of Object.entries(methods)) {
      const score = scoreOperation(tokens, method, pathSegments, op);
      if (score > 0) {
        scored.push({
          score,
          result: formatResult(method, path, op),
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, MAX_RESULTS).map((s) => s.result);

  if (results.length === 0) {
    return "No matching endpoints found. Try different keywords, e.g. 'reservations', 'rentals', 'pricing', 'missions'.";
  }

  return truncateResponse(results);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,._\-/]+/)
    .filter((t) => t.length > 1);
}

function scoreOperation(
  tokens: string[],
  method: string,
  pathSegments: string[],
  op: OperationInfo
): number {
  let score = 0;
  const opId = (op.operationId ?? "").toLowerCase();
  const summary = (op.summary ?? "").toLowerCase();
  const description = (op.description ?? "").toLowerCase();
  const tags = (op.tags ?? []).map((t) => t.toLowerCase());

  for (const token of tokens) {
    // Path segments (weight 3)
    if (pathSegments.some((seg) => seg.includes(token) || token.includes(seg))) {
      score += 3;
    }

    // Tags (weight 3)
    if (tags.some((tag) => tag.includes(token) || token.includes(tag))) {
      score += 3;
    }

    // Operation ID (weight 2)
    if (opId.includes(token)) {
      score += 2;
    }

    // Summary (weight 2)
    if (summary.includes(token)) {
      score += 2;
    }

    // Description (weight 1)
    if (description.includes(token)) {
      score += 1;
    }

    // HTTP method synonyms (weight 1)
    const synonyms = METHOD_SYNONYMS[method] ?? [];
    if (synonyms.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function formatResult(
  method: string,
  path: string,
  op: OperationInfo
): SearchResult {
  const result: SearchResult = { method, path };

  if (op.operationId) result.operationId = op.operationId;
  if (op.summary) result.summary = op.summary;
  if (op.tags?.length) result.tags = op.tags;

  if (op.parameters?.length) {
    result.parameters = op.parameters.map((p) => ({
      name: p.name,
      in: p.in,
      ...(p.required ? { required: true } : {}),
      ...(p.description ? { description: p.description } : {}),
    }));
  }

  if (op.requestBody) result.requestBody = op.requestBody;

  // Include only the success response schema (200 or 201)
  const successKey = op.responses?.["200"]
    ? "200"
    : op.responses?.["201"]
      ? "201"
      : undefined;
  if (successKey && op.responses?.[successKey]) {
    result.successResponse = op.responses[successKey];
  }

  return result;
}
