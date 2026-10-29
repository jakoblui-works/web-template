import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Request failed with ${status}`);
    this.name = "ApiError";
  }
}

export const customFetch = async <T>(
  url: string,
  options: RequestInit & { schema?: ZodType },
): Promise<T> => {
  const { schema, ...rest } = options;
  const res = await fetch(url, rest);

  const text = await res.text();
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const body: unknown = !text ? undefined : isJson ? JSON.parse(text) : text;

  if (!res.ok) throw new ApiError(res.status, body);

  const data = schema ? schema.parse(body) : body;
  return { data, status: res.status, headers: res.headers } as T;
};

/**
 * The error type Orval gives the generated hooks (it picks up this export from the mutator file).
 * `customFetch` throws an `ApiError` for any non-2xx, whatever error body the spec declares, and
 * network failures or invalid success bodies throw other errors, so this is honestly just `Error`:
 * narrow with `instanceof ApiError`.
 */
// The parameter is required: Orval writes ErrorType<…>.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type ErrorType<_SpecErrorBody> = Error;
