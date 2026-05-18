import type { ViralContentResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8012/api/viral-content').replace(/\/$/, '');

export async function generateViralContent(url: string): Promise<ViralContentResponse> {
  const response = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
      if (data?.detail) message = data.detail;
    } catch {}
    throw new Error(message);
  }

  return response.json() as Promise<ViralContentResponse>;
}
