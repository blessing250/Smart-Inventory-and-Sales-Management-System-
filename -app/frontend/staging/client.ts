export type Page<T> = { items: T[]; total: number; page: number; size: number };
export type Owner = { id: string; name: string; email: string };
export type Token = { accessToken: string; expiresIn: number };
export type Trend = { day: string; revenue_rwf: number; gross_profit_rwf: number };
export type Report = { title: string; total: number; columns: { key: string; label: string; unit: string }[];
  rows: Record<string, string | number | null>[]; totals: Record<string, number> };

export class StagingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function createStagingClient(fetcher: typeof fetch = fetch) {
  let token: Token | undefined;
  let validUntil = 0;
  let pending: Promise<void> | undefined;
  async function send(path: string, init: RequestInit = {}, access?: string) {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    if (access) headers.set('Authorization', `Bearer ${access}`);
    let response: Response;
    try {
      response = await fetcher(`/spring/api/v1/${path}`, { ...init, headers, cache: 'no-store', credentials: 'same-origin' });
    } catch {
      throw new StagingError('The connection was interrupted. Check your connection and retry.', 0);
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new StagingError(result.error ?? 'The staging request could not be completed.', response.status);
    }
    return response;
  }
  async function setToken(response: Response) {
    token = await response.json() as Token;
    validUntil = Date.now() + (token.expiresIn - 30) * 1000;
  }
  function renew() {
    pending ??= send('auth/browser-refresh', { method: 'POST' }).then(setToken).finally(() => { pending = undefined; });
    return pending;
  }
  async function request(path: string, init?: RequestInit) {
    if (!token || Date.now() >= validUntil) await renew();
    try {
      return await send(path, init, token?.accessToken);
    } catch (error) {
      // Only retry reads automatically. Writes keep the caller's operation reference for explicit retry.
      if (!(error instanceof StagingError) || error.status !== 401 || (init?.method && init.method !== 'GET')) throw error;
      await renew();
      return send(path, init, token?.accessToken);
    }
  }
  return {
    async recovery(path:'forgot-password'|'verify-reset'|'reset-password',body:object) {
      await send('auth/'+path,{method:'POST',body:JSON.stringify(body)});
      if(path==='reset-password'){token=undefined;validUntil=0;}
    },
    async login(email: string, password: string) {
      await setToken(await send('auth/browser-login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }));
    },
    async logout() {
      await send('auth/browser-logout', { method: 'POST' }, token?.accessToken);
      token = undefined;
      validUntil = 0;
    },
    async read<T>(path: string) { return await (await request(path)).json() as T; },
    async write<T>(path: string, body: object | FormData, method = 'POST') {
      const response=await request(path,{method,body:body instanceof FormData?body:JSON.stringify(body)});
      return (response.status===204?undefined:await response.json()) as T;
    },
    async download(path: string) { return (await request(path)).blob(); },
  };
}
