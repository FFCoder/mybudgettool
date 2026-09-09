import { timingSafeEqual, createHash } from "node:crypto";
import { AppError, month } from "../shared/domain";
import type { Store } from "./store";
export function createApiHandler(
  store: Store,
  token: string,
): (req: Request) => Promise<Response> {
  if (token.length < 24)
    throw new Error("API_TOKEN must contain at least 24 characters");
  return async (req) => {
    const json = (v: unknown, status = 200) =>
      Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
    try {
      const expected = Buffer.from(`Bearer ${token}`);
      const supplied = Buffer.from(req.headers.get("authorization") ?? "");
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new AppError(
          "unauthorized",
          "A valid bearer token is required",
          401,
        );
      const url = new URL(req.url);
      if (url.pathname === "/api/state" && req.method === "GET") {
        const m = url.searchParams.get("month");
        if (m !== null) month(m);
        return json(await store.read(m ?? undefined));
      }
      if (url.pathname === "/api/commands" && req.method === "POST") {
        if (!req.headers.get("content-type")?.startsWith("application/json"))
          throw new AppError(
            "validation",
            "Content-Type must be application/json",
            415,
          );
        const key = req.headers.get("idempotency-key");
        if (!key || key.length > 200 || !/^[-\w.:]+$/.test(key))
          throw new AppError(
            "validation",
            "Idempotency-Key header is required (1–200 letters, numbers, dash, dot, colon, underscore)",
          );
        const reader = req.body?.getReader();
        let text = "";
        let size = 0;
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 1000000) {
              await reader.cancel();
              throw new AppError(
                "validation",
                "Request body is too large",
                413,
              );
            }
            text += decoder.decode(part.value, { stream: true });
          }
          text += decoder.decode();
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          throw new AppError("validation", "Invalid JSON body");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new AppError("validation", "Expected command object");
        const canonical = (v: any): string =>
          v === null || typeof v !== "object"
            ? JSON.stringify(v)
            : Array.isArray(v)
              ? "[" + v.map(canonical).join(",") + "]"
              : "{" +
                Object.keys(v)
                  .sort()
                  .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
                  .join(",") +
                "}";
        const fingerprint = createHash("sha256")
          .update(canonical(body))
          .digest("hex");
        return json(
          await store.execute(body.operation, body.input, key, fingerprint),
        );
      }
      throw new AppError("not_found", "API route not found", 404);
    } catch (error) {
      if (error instanceof AppError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      console.error("API error", error);
      return json(
        {
          error: {
            code: "internal_error",
            message:
              "Unable to complete request. Check server logs and database connection.",
          },
        },
        500,
      );
    }
  };
}
