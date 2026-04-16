import type { DashboardSummary, ResourceRow, SessionUser } from './types';

const TOKEN_KEY = 'rigways_token';

type CertificateUploadPayload = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
};

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
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has('Content-Type') && init?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
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

export async function uploadCertificateFile(id: string | number, payload: CertificateUploadPayload) {
  return request<ResourceRow>(`/api/certificates/${id}/upload`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPushPublicKey() {
  return request<{ publicKey: string }>('/api/push/public-key');
}

export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  return request<{ subscribed: true }>('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  });
}

export async function removePushSubscription(endpoint?: string) {
  return request<{ deleted: true }>('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify(endpoint ? { endpoint } : {}),
  });
}

export async function sendPushTest(broadcast = false) {
  return request<{ sent: true; recipients: number }>('/api/push/test', {
    method: 'POST',
    body: JSON.stringify({ broadcast }),
  });
}

export async function markAllNotificationsRead() {
  return request<{ updated: true }>('/api/notifications/mark-all-read', {
    method: 'POST',
  });
}

export async function clearAllNotifications() {
  return request<{ deleted: true }>('/api/notifications', {
    method: 'DELETE',
  });
}
