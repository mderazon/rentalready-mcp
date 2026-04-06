const MAX_CHARS = 48000; // ~12K tokens

export function truncateResponse(data: unknown): string {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);

  if (text.length <= MAX_CHARS) {
    return text;
  }

  return (
    text.slice(0, MAX_CHARS) +
    "\n\n--- RESPONSE TRUNCATED ---\n" +
    "The response was too large. Use pagination parameters (e.g. page, page_size) " +
    "or more specific filters to get smaller results."
  );
}
