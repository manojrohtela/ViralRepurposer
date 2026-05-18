import type { ViralContentResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8012/api/viral-content').replace(/\/$/, '');

// Fetch transcript from YouTube's InnerTube API directly in the browser.
// This runs from the user's home IP, avoiding datacenter bot-blocking.
async function fetchTranscriptInBrowser(videoUrl: string): Promise<{ items: TranscriptItem[]; videoId: string }> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Could not extract video ID from URL.');

  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20241209.01.00',
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  });

  if (!playerRes.ok) throw new Error(`YouTube returned ${playerRes.status}. Try again in a moment.`);
  const playerData = await playerRes.json();

  const status = playerData?.playabilityStatus?.status;
  if (status === 'LOGIN_REQUIRED') throw new Error('This video is age-restricted or members-only.');
  if (status === 'UNPLAYABLE' || status === 'ERROR') throw new Error('This video is unavailable or private.');

  const tracks: Array<{ languageCode: string; baseUrl: string }> =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  if (!tracks.length) throw new Error('No transcript is available for this video.');

  const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`);
  if (!captionRes.ok) throw new Error('Failed to fetch caption data.');

  const captionData = await captionRes.json();
  const items: TranscriptItem[] = (captionData.events as CaptionEvent[] ?? [])
    .filter((e) => e.segs?.length)
    .map((e) => ({
      text: e.segs!.map((s) => s.utf8 ?? '').join('').replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim(),
      offset: e.tStartMs ?? 0,
      duration: e.dDurationMs ?? 0,
    }))
    .filter((e) => e.text);

  if (!items.length) throw new Error('The transcript for this video is empty.');
  return { items, videoId };
}

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1);
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

interface TranscriptItem { text: string; offset: number; duration: number }
interface CaptionEvent { tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }

export async function generateViralContent(url: string): Promise<ViralContentResponse> {
  // Step 1: fetch transcript in browser (avoids server-side bot detection)
  const { items, videoId } = await fetchTranscriptInBrowser(url);

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
