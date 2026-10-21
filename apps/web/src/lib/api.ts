import { getSupabase } from './supabase';

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public issues: FieldIssue[] = [],
  ) {
    super(message);
  }
}

interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

/** The signed-in user's Supabase access token, refreshed by the client when it is close to expiring. */
async function accessToken(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Where the API lives. Empty (local development): call the Next.js same-origin proxy, which forwards /api/* to the
 * Express API. In production NEXT_PUBLIC_API_URL is the API's own address and the browser calls it directly, which keeps
 * large uploads (resumes) off the web host's proxy; the API's CORS (WEB_ORIGIN) allows this site.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/** Calls the API with the signed-in user's access token. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const hasBody = init.body !== undefined;
  const token = await accessToken();
  const headers: Record<string, string> = {};
  if (hasBody && !isForm) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      headers,
      body: hasBody ? (isForm ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
    issues?: FieldIssue[];
  } | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? 'Something went wrong. Please try again.',
      data?.code,
      data?.issues ?? [],
    );
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}
