// Простой клиент для общения с API PrintPro.
import { API_BASE, SERVER_ORIGIN } from './config';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pp_token');
}

function handleUnauthorized(status: number) {
  if (status !== 401 || typeof window === 'undefined') return;
  localStorage.removeItem('pp_token');
  window.dispatchEvent(new Event('pp:unauthorized'));
}

function apiError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function mergeHeaders(headers?: HeadersInit): Record<string, string> {
  const merged: Record<string, string> = {};
  if (!headers) return merged;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      merged[key] = value;
    });
    return merged;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) merged[key] = value;
    return merged;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) merged[key] = String(value);
  }
  return merged;
}

async function readResponseBody<T>(res: Response): Promise<T> {
  const text = (await res.text()).trim();
  if (!text) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw apiError('Сервер вернул некорректный JSON', res.status);
    }
  }
  return text as T;
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...mergeHeaders(options.headers),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    handleUnauthorized(res.status);
    let message = `Ошибка ${res.status}`;
    try {
      const body = await readResponseBody<{ message?: string | string[] }>(res);
      const bodyMessage = body?.message;
      if (Array.isArray(bodyMessage)) message = bodyMessage.join(', ');
      else if (typeof bodyMessage === 'string') message = bodyMessage;
    } catch {
      // тело не json — оставляем общее сообщение
    }
    throw apiError(message, res.status);
  }

  return readResponseBody<T>(res);
}

// Удобные сокращения
export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T = any>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  // Загрузка файла (multipart). Content-Type выставит браузер сам (с boundary).
  upload: async <T = any>(path: string, file: File): Promise<T> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: fd,
    });
    if (!res.ok) {
      handleUnauthorized(res.status);
      let message = `Ошибка ${res.status}`;
      try {
        const body = await readResponseBody<{ message?: string | string[] }>(res);
        const bodyMessage = body?.message;
        if (Array.isArray(bodyMessage)) message = bodyMessage.join(', ');
        else if (typeof bodyMessage === 'string') message = bodyMessage;
      } catch {
        /* не json */
      }
      throw apiError(message, res.status);
    }
    return readResponseBody<T>(res);
  },
};

// Полный URL к файлу из /uploads (для <img src>).
// Статика раздаётся бэкендом по корню (/uploads/...), БЕЗ префикса /api,
// поэтому берём SERVER_ORIGIN, а не API_BASE.
export function fileUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${SERVER_ORIGIN}${path}`;
}
