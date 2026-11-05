let pendingMutations = 0;
let mutationVersion = 0;

/** Lets background reads defer during writes and reject reads overlapping a new write. */
export function getMutationState() { return { pending: pendingMutations, version: mutationVersion }; }

/** Sends an authenticated same-origin request to the Tayori API and returns its JSON response. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase());
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (mutation) headers.set("Origin", location.origin);
  if (mutation) { pendingMutations++; mutationVersion++; }
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" });
    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      try { code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? code; } catch { /* keep status */ }
      throw new Error(code);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    if (mutation) pendingMutations--;
  }
}
