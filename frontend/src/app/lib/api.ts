import type { ViralContentResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8012/api/viral-content').replace(/\/$/, '');

export async function generateViralContent(url: string): Promise<ViralContentResponse> {
  // Step 1: fetch transcript via Vercel serverless proxy (avoids CORS + datacenter bot-blocking)
  const transcriptRes = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`);
  if (!transcriptRes.ok) {
    let message = `Transcript fetch failed (${transcriptRes.status})`;
    try {
      const data = await transcriptRes.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  const { items, videoId } = await transcriptRes.json();

  // Step 2: send transcript to Oracle backend for Groq processing
  const response = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}`, transcript: items }),
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
