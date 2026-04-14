import type { DashboardSummary, ResourceRow, SessionUser } from './types';

const TOKEN_KEY = 'rigways_token';

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    clearToken();
    throw new Error('Your session has expired. Please sign in again.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const rawBody = await response.text();

  let payload: { success?: boolean; error?: string; data?: T } | null = null;
  if (rawBody && isJson) {
    try {
      payload = JSON.parse(rawBody) as { success?: boolean; error?: string; data?: T };
    } catch {
      throw new Error('The server returned an invalid JSON response.');
    }
  }

  if (!response.ok) {
    const message = payload?.error ?? rawBody.trim() ?? `Request failed with status ${response.status}.`;
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  if (payload?.success === false) {
    throw new Error(payload.error ?? 'Something went wrong.');
  }

  if (!payload) {
    return undefined as T;
  }

  return payload.data as T;
}

export async function login(username: string, password: string) {
  return request<{ token: string; user: SessionUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchMe() {
  return request<SessionUser>('/api/auth/me');
}

export async function fetchDashboard() {
  return request<DashboardSummary>('/api/dashboard/summary');
}

export async function fetchResource(path: string, query = '') {
  return request<ResourceRow[]>(`/api/${path}${query ? `?q=${encodeURIComponent(query)}` : ''}`);
}

export async function createResource(path: string, body: Record<string, unknown>) {
  return request<ResourceRow>(`/api/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateResource(path: string, id: string | number, body: Record<string, unknown>) {
  return request<ResourceRow>(`/api/${path}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteResource(path: string, id: string | number) {
  return request<{ deleted: true }>(`/api/${path}/${id}`, { method: 'DELETE' });
}