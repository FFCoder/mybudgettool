export class CliError extends Error {
  constructor(message: string, readonly code = "CLI_ERROR", readonly status?: number) { super(message); }
}

export type ParsedArgs = { words: string[]; options: Record<string, string>; help: boolean };
export function parseArgs(args: string[]): ParsedArgs {
  const words: string[] = [];
  const options: Record<string, string> = {};
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    const [key, ...inline] = arg.slice(2).split("=");
    if (!["url", "token", "data", "key"].includes(key!)) throw new CliError(`Unknown option --${key}`);
    const value = inline.length ? inline.join("=") : args[++i];
    if (value === undefined || value.startsWith("--")) throw new CliError(`Option --${key} needs a value`);
    if (Object.hasOwn(options, key!)) throw new CliError(`Duplicate option --${key}`);
    options[key!] = value;
  }
  return { words, options, help };
}

export type ApiCommand = { method: string; path: string; body?: unknown };
export async function callApi(command: ApiCommand, options: Record<string, string>, env: Record<string, string | undefined>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const token = options.token ?? env.BUDGET_API_TOKEN ?? env.API_TOKEN;
  if (!token) throw new CliError("Set BUDGET_API_TOKEN (or API_TOKEN), or pass --token", "AUTH_REQUIRED");
  let base: URL;
  try { base = new URL(options.url ?? env.BUDGET_API_URL ?? "http://localhost:3000"); }
  catch { throw new CliError("API URL must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new CliError("API URL must be HTTP(S) without credentials, query, or fragment");
  if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) && env.BUDGET_ALLOW_HTTP !== "1") throw new CliError("Use HTTPS for remote API connections to protect your token. For a trusted private network only, explicitly set BUDGET_ALLOW_HTTP=1");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (command.body !== undefined) headers["Content-Type"] = "application/json";
  if (command.method !== "GET") {
    if (!options.key) throw new CliError("Mutations require --key <unique-operation-key>; reuse the same key and data when retrying", "IDEMPOTENCY_KEY_REQUIRED");
    headers["Idempotency-Key"] = options.key;
  }
  let response: Response;
  try {
    response = await fetcher(`${base.href.replace(/\/$/, "")}${command.path}`, {
      method: command.method, headers, body: command.body === undefined ? undefined : JSON.stringify(command.body), redirect: "error", signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new CliError("API request failed. Check URL and server availability; retry mutations with the same --key and data", "CONNECTION_ERROR"); }
  let payload: any;
  try { payload = await response.json(); } catch { throw new CliError(`API returned a non-JSON response (HTTP ${response.status})`, "INVALID_RESPONSE", response.status); }
  if (!response.ok) throw new CliError(payload?.error?.message ?? payload?.message ?? `API request failed (HTTP ${response.status})`, payload?.error?.code ?? "API_ERROR", response.status);
  return payload;
}
