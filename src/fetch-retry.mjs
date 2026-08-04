export async function fetchWithRetry(
  url,
  options = {},
  { retries = 3, delayMs = 1200, label = "API" } = {}
) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      const retryable =
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ECONNREFUSED" ||
        /fetch failed/i.test(error.message);

      if (!retryable || attempt >= retries - 1) break;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }

  const detail = lastError?.message || "error de red";
  throw new Error(`${label}: ${detail}`);
}
