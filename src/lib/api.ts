import { loadConfig } from './config';
import type { UserRole } from '@/types';

const TOKEN_KEY = 'kasir.auth.token.v1';

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

export interface QueryResult<T = unknown> {
  data: T | null;
  error: ApiError | null;
}

interface AuthUser {
  id: string;
  email: string;
  /** Diisi server; sumber kebenaran toko aktif untuk sesi ini. */
  store_id?: string | null;
  role?: string | null;
}

interface AuthSession {
  access_token: string;
  token_type: 'bearer';
  user: AuthUser;
  expires_at?: number;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  store_id: string | null;
  created_at: string;
}

export interface AdminAuditLog {
  id: string;
  store_id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminSystemStats {
  users: {
    total: number;
    roles: Record<string, number>;
  };
  products: {
    total: number;
    active: number;
    low_stock: number;
    empty: number;
  };
  orders: {
    today_count: number;
    today_sales: number;
    unpaid_count: number;
  };
  shifts: {
    open: number;
  };
  audit: {
    latest_at: string | null;
  };
}

type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'INITIAL_SESSION';
type AuthListener = (event: AuthEvent, session: AuthSession | null) => void | Promise<void>;

interface QueryFilter {
  type: 'eq' | 'in' | 'not_in';
  column: string;
  value?: unknown;
  values?: unknown[];
}

interface QueryOrder {
  column: string;
  ascending: boolean;
}

interface QueryPayload {
  table: string;
  action: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  columns: string;
  filters: QueryFilter[];
  orderBy: QueryOrder | null;
  limit: number | null;
  payload: unknown;
  returning: boolean;
  single: boolean;
  maybeSingle: boolean;
}

export class KasirApiClient {
  readonly apiBaseUrl: string;
  private listeners = new Set<AuthListener>();

  auth = {
    signUp: async (args: {
      email: string;
      password: string;
      options?: { data?: { full_name?: string }; emailRedirectTo?: string };
    }) => {
      const { data, error } = await requestJson<{ user: AuthUser; session: AuthSession }>(
        this.apiBaseUrl,
        '/api/auth/signup',
        {
          method: 'POST',
          body: {
            email: args.email,
            password: args.password,
            full_name: args.options?.data?.full_name,
          },
          auth: false,
        },
      );
      if (error) return { data: { user: null, session: null }, error };
      if (data?.session) {
        saveToken(data.session.access_token);
        await this.emit('SIGNED_IN', data.session);
      }
      return { data: data ?? { user: null, session: null }, error: null };
    },

    signInWithPassword: async (args: { email: string; password: string }) => {
      const { data, error } = await requestJson<{ user: AuthUser; session: AuthSession }>(
        this.apiBaseUrl,
        '/api/auth/signin',
        { method: 'POST', body: args, auth: false },
      );
      if (error) return { data: { user: null, session: null }, error };
      if (data?.session) {
        saveToken(data.session.access_token);
        await this.emit('SIGNED_IN', data.session);
      }
      return { data: data ?? { user: null, session: null }, error: null };
    },

    signOut: async () => {
      removeToken();
      await this.emit('SIGNED_OUT', null);
      return { error: null };
    },

    getSession: async () => {
      const token = loadToken();
      if (!token) return { data: { session: null }, error: null };
      const { data, error } = await requestJson<{ session: AuthSession }>(
        this.apiBaseUrl,
        '/api/auth/session',
        { method: 'GET' },
      );
      if (error) {
        // Hanya buang token kalau server BENAR-BENAR menolaknya. Sebelumnya
        // error apa pun (termasuk jaringan putus sesaat atau server sibuk)
        // ikut menghapus token, sehingga pengguna tiba-tiba terlempar ke
        // halaman login di tengah pemakaian.
        if (error.status === 401 || error.status === 403) removeToken();
        return { data: { session: null }, error };
      }
      return { data: { session: data?.session ?? null }, error: null };
    },

    getUser: async () => {
      const token = loadToken();
      if (!token) return { data: { user: null }, error: null };
      const { data, error } = await requestJson<{ user: AuthUser }>(
        this.apiBaseUrl,
        '/api/auth/user',
        { method: 'GET' },
      );
      if (error) return { data: { user: null }, error };
      return { data: { user: data?.user ?? null }, error: null };
    },

    onAuthStateChange: (listener: AuthListener) => {
      this.listeners.add(listener);
      void this.auth.getSession().then(({ data }) => listener('INITIAL_SESSION', data.session));
      return {
        data: {
          subscription: {
            unsubscribe: () => this.listeners.delete(listener),
          },
        },
      };
    },
  };

  admin = {
    listUsers: async (): Promise<QueryResult<AdminUser[]>> => {
      const { data, error } = await requestJson<{ data: AdminUser[] }>(
        this.apiBaseUrl,
        '/api/admin/users',
        { method: 'GET' },
      );
      return { data: data?.data ?? null, error };
    },

    createUser: async (payload: {
      email: string;
      password: string;
      full_name: string;
      role: UserRole;
    }): Promise<QueryResult<AdminUser>> => {
      const { data, error } = await requestJson<{ data: AdminUser }>(
        this.apiBaseUrl,
        '/api/admin/users',
        { method: 'POST', body: payload },
      );
      return { data: data?.data ?? null, error };
    },

    updateUser: async (
      id: string,
      payload: Partial<{
        email: string;
        password: string;
        full_name: string;
        role: UserRole;
      }>,
    ): Promise<QueryResult<AdminUser>> => {
      const { data, error } = await requestJson<{ data: AdminUser }>(
        this.apiBaseUrl,
        `/api/admin/users/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: payload },
      );
      return { data: data?.data ?? null, error };
    },

    deleteUser: async (id: string): Promise<QueryResult<null>> => {
      const { data, error } = await requestJson<{ data: null }>(
        this.apiBaseUrl,
        `/api/admin/users/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      return { data: data?.data ?? null, error };
    },

    listAuditLogs: async (limit = 100): Promise<QueryResult<AdminAuditLog[]>> => {
      const safeLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 100));
      const { data, error } = await requestJson<{ data: AdminAuditLog[] }>(
        this.apiBaseUrl,
        `/api/admin/audit-logs?limit=${encodeURIComponent(String(safeLimit))}`,
        { method: 'GET' },
      );
      return { data: data?.data ?? null, error };
    },

    systemStats: async (): Promise<QueryResult<AdminSystemStats>> => {
      const { data, error } = await requestJson<{ data: AdminSystemStats }>(
        this.apiBaseUrl,
        '/api/admin/system',
        { method: 'GET' },
      );
      return { data: data?.data ?? null, error };
    },
  };

  constructor(apiBaseUrl: string) {
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  }

  from(table: string): QueryBuilder<any> {
    return new QueryBuilder(this, table);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<QueryResult> {
    const { data, error } = await requestJson<{ data: unknown }>(
      this.apiBaseUrl,
      `/api/rpc/${encodeURIComponent(name)}`,
      { method: 'POST', body: args },
    );
    return { data: data?.data ?? null, error };
  }

  async health(): Promise<QueryResult<{ ok: boolean; database: string }>> {
    const { data, error } = await requestJson<{ ok: boolean; database: string }>(
      this.apiBaseUrl,
      '/api/health',
      { method: 'GET', auth: false },
    );
    return { data: data ?? null, error };
  }

  private async emit(event: AuthEvent, session: AuthSession | null) {
    await Promise.all([...this.listeners].map((listener) => listener(event, session)));
  }
}

class QueryBuilder<T = unknown> {
  private action: QueryPayload['action'] = 'select';
  private columns = '*';
  private filters: QueryFilter[] = [];
  private orderBy: QueryOrder | null = null;
  private rowLimit: number | null = null;
  private payload: unknown = null;
  private returning = false;
  private singleResult = false;
  private maybeSingleResult = false;
  private pending: Promise<QueryResult<T>> | null = null;

  constructor(private client: KasirApiClient, private table: string) {}

  select(columns = '*') {
    if (this.action === 'select') this.action = 'select';
    this.columns = columns;
    this.returning = this.action !== 'select';
    return this;
  }

  insert(payload: unknown) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown) {
    this.action = 'upsert';
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ type: 'in', column, values });
    return this;
  }

  not_in(column: string, values: unknown[]) {
    this.filters.push({ type: 'not_in', column, values });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  limit(limit: number) {
    this.rowLimit = limit;
    return this;
  }

  maybeSingle() {
    this.maybeSingleResult = true;
    return this.execute();
  }

  single() {
    this.singleResult = true;
    return this.execute();
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<QueryResult<T>> {
    if (!this.pending) {
      const body: QueryPayload = {
        table: this.table,
        action: this.action,
        columns: this.columns,
        filters: this.filters,
        orderBy: this.orderBy,
        limit: this.rowLimit,
        payload: this.payload,
        returning: this.returning,
        single: this.singleResult,
        maybeSingle: this.maybeSingleResult,
      };
      this.pending = requestJson<{ data: T }>(this.client.apiBaseUrl, '/api/query', {
        method: 'POST',
        body,
      }).then(({ data, error }) => ({ data: data?.data ?? null, error }));
    }
    return this.pending;
  }
}

let client: KasirApiClient | null = null;
let cachedApiBaseUrl = '';

export function createKasirClient(apiBaseUrl = ''): KasirApiClient {
  return new KasirApiClient(apiBaseUrl);
}

export function getBackendClient(): KasirApiClient {
  const { apiBaseUrl } = loadConfig();
  const normalized = normalizeApiBaseUrl(apiBaseUrl);
  if (client && cachedApiBaseUrl === normalized) return client;
  client = createKasirClient(normalized);
  cachedApiBaseUrl = normalized;
  return client;
}

/** Throw-on-missing variant for code paths that require the backend API. */
export function requireBackendClient(): KasirApiClient {
  return getBackendClient();
}

export function resetBackendClient() {
  client = null;
  cachedApiBaseUrl = '';
}

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function requestJson<T>(
  apiBaseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<{ data: T | null; error: ApiError | null }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false) {
    const token = loadToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : null;
    if (!response.ok) {
      return {
        data: null,
        error: {
          message: String(payload?.error ?? payload?.message ?? response.statusText),
          status: response.status,
          code: payload?.code ? String(payload.code) : undefined,
        },
      };
    }
    return { data: payload as T, error: null };
  } catch (e) {
    return {
      data: null,
      error: {
        message: e instanceof Error ? e.message : 'Gagal menghubungi backend API.',
      },
    };
  }
}

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
