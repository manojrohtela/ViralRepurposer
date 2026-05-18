import type { ViralContentResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8012/api/viral-content').replace(/\/$/, '');

interface TrackInfo { baseUrl: string; languageCode: string; kind?: string }
interface CaptionEvent { tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }
interface TranscriptItem { text: string; offset: number; duration: number }

function cleanText(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function fetchCaptionItems(tracks: TrackInfo[]): Promise<TranscriptItem[]> {
  const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
  if (!track?.baseUrl) throw new Error('No usable caption track found.');

  // Browser fetches with its own YouTube session cookies — timedtext API allows credentialed cross-origin
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

async function callOracle(payload: Record<string, unknown>): Promise<ViralContentResponse> {
  const response = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

export async function generateViralContent(url: string, manualTranscript = ''): Promise<ViralContentResponse> {
  if (manualTranscript.trim()) {
    return callOracle({ url, manualTranscript: manualTranscript.trim() });
  }

  // Step 1: Vercel proxy scrapes the YouTube watch page for signed caption track URLs
  const trackRes = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`);

  if (trackRes.ok) {
    const { tracks, videoId } = await trackRes.json();

    // Step 2: Browser fetches caption file with its own YouTube cookies
    let items: TranscriptItem[] = [];
    try {
      items = await fetchCaptionItems(tracks);
    } catch {
      // Caption fetch failed — fall through to Oracle yt-dlp fallback
    }

    if (items.length) {
      // Step 3a: Send transcript to Oracle for Groq processing
      return callOracle({ url: `https://www.youtube.com/watch?v=${videoId}`, transcript: items });
    }
  }

  // Fallback: Vercel blocked or browser caption fetch failed → Oracle uses yt-dlp with stored cookies
  // Oracle's server.js calls fetchTranscript(url) when transcript is absent from request body
  return callOracle({ url });
}
