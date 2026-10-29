import { fc, test } from "@fast-check/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";

import { ApiError, customFetch } from "./fetcher";

const respondWith = (response: Response) => {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const failure = async (request: Promise<unknown>): Promise<ApiError> => {
  const error = await request.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

const Task = z.object({ task_id: z.string() });

describe("customFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("failed responses throw ApiError with the status and parsed body", () => {
    it("JSON validation error (422)", async () => {
      const detail = [{ loc: ["body", "ids", 0], msg: "Unknown id", type: "value_error" }];
      respondWith(json({ detail }, 422));

      const error = await failure(customFetch("/api/x/create", { schema: Task }));
      expect(error.status).toBe(422);
      expect(error.body).toEqual({ detail });
    });

    it("JSON error that doesn't match the success schema (503)", async () => {
      respondWith(json({ detail: "Not published yet" }, 503));

      const error = await failure(customFetch("/api/x/options", { schema: Task }));
      expect(error.status).toBe(503);
      expect(error.body).toEqual({ detail: "Not published yet" });
    });

    it("plain-text error from the proxy (429)", async () => {
      respondWith(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );

      const error = await failure(customFetch("/api/x/create", { schema: Task }));
      expect(error.status).toBe(429);
      expect(error.body).toBe("Too Many Requests");
    });

    it("HTML error page (502)", async () => {
      const page = "<html><body>Bad Gateway</body></html>";
      respondWith(new Response(page, { status: 502, headers: { "content-type": "text/html" } }));

      const error = await failure(customFetch("/api/x/create", { schema: Task }));
      expect(error.status).toBe(502);
      expect(error.body).toBe(page);
    });

    test.prop([fc.integer({ min: 400, max: 599 }), fc.string()])(
      "any error status with any text body",
      async (status, body) => {
        respondWith(new Response(body, { status, headers: { "content-type": "text/plain" } }));

        const error = await failure(customFetch("/x", { schema: Task }));
        expect(error.status).toBe(status);
        expect(error.body).toBe(body === "" ? undefined : body);
      },
    );
  });

  describe("successful responses", () => {
    it("return { data, status, headers } with the body validated", async () => {
      respondWith(json({ task_id: "abc", extra: "dropped" }, 202));

      const res = await customFetch<{ data: unknown; status: number; headers: Headers }>(
        "/api/x/create",
        { schema: Task },
      );
      expect(res.status).toBe(202);
      // Parsed by the schema, so unknown keys are stripped.
      expect(res.data).toEqual({ task_id: "abc" });
      expect(res.headers.get("content-type")).toBe("application/json");
    });

    it("throw the validation error when the body doesn't match the schema", async () => {
      respondWith(json({ id: 1 }, 200));

      await expect(customFetch("/api/x/create", { schema: Task })).rejects.toBeInstanceOf(
        ZodError,
      );
    });

    it("return the body as is without a schema", async () => {
      respondWith(new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } }));

      const res = await customFetch<{ data: unknown }>("/api/x/file", {});
      expect(res.data).toBe("%PDF-1.4");
    });

    it("have no data for an empty body", async () => {
      respondWith(new Response(null, { status: 204 }));

      const res = await customFetch<{ data: unknown; status: number }>("/x", { schema: Task.optional() });
      expect(res.status).toBe(204);
      expect(res.data).toBeUndefined();
    });
  });

  it("passes the request options to fetch, but not the schema", async () => {
    const fetchMock = respondWith(json({ task_id: "abc" }, 202));

    await customFetch("/api/x/create", { method: "POST", body: "{}", schema: Task });
    expect(fetchMock).toHaveBeenCalledWith("/api/x/create", { method: "POST", body: "{}" });
  });
});
