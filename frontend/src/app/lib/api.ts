import type { ViralContentResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8012/api/viral-content').replace(/\/$/, '');

interface TrackInfo { baseUrl: string; languageCode: string; kind?: string }
interface CaptionEvent { tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }

function cleanText(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function fetchCaptionItems(tracks: TrackInfo[]): Promise<Array<{ text: string; offset: number; duration: number }>> {
  const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
  if (!track?.baseUrl) throw new Error('No usable caption track found.');

  // Fetch the caption file from the browser — timedtext API supports credentialed cross-origin requests
  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' });
  if (!captionRes.ok) throw new Error(`Failed to fetch caption file (${captionRes.status}).`);

  const captionData = await captionRes.json();
  return (captionData.events as CaptionEvent[] ?? [])
    .filter((e) => e.segs?.length)
    .map((e) => ({
      text: cleanText(e.segs!.map((s) => s.utf8 ?? '').join('')),
      offset: e.tStartMs ?? 0,
      duration: e.dDurationMs ?? 0,
    }))
    .filter((e) => e.text);
}

export async function generateViralContent(url: string): Promise<ViralContentResponse> {
  // Step 1: Vercel proxy scrapes the YouTube page for signed caption track URLs
  const trackRes = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`);
  if (!trackRes.ok) {
    let message = `Transcript fetch failed (${trackRes.status})`;
    try { const d = await trackRes.json(); if (d?.error) message = d.error; } catch {}
    throw new Error(message);
  }
  const { tracks, videoId } = await trackRes.json();

  // Step 2: browser fetches the caption file using its own YouTube cookies
  const items = await fetchCaptionItems(tracks);
  if (!items.length) throw new Error('No transcript was found for this video.');

  // Step 3: send transcript to Oracle backend for Groq processing
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
