// Vercel Edge Function — runs on Cloudflare edge IPs which YouTube doesn't bot-block.
// Scrapes the watch page to get signed captionTracks URLs for the browser to use.

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1);
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

// String-aware JSON array extractor.
function extractJsonArray(html, start) {
  let depth = 0, i = start, inStr = false, esc = false;
  while (i < html.length) {
    const c = html[i];
    if (esc) { esc = false; }
    else if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return html.slice(start, i + 1); }
    }
    i++;
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return json({ error: 'Missing url parameter.' }, 400);

  const videoId = extractVideoId(url);
  if (!videoId) return json({ error: 'Invalid YouTube URL.' }, 400);

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb; GPS=1',
      },
    });

    if (!pageRes.ok) return json({ error: `YouTube page returned ${pageRes.status}.` }, 502);
    const html = await pageRes.text();

    const statusMatch = html.match(/"playabilityStatus":\{"status":"([^"]+)"/);
    const status = statusMatch?.[1];
    if (status === 'UNPLAYABLE' || status === 'ERROR') return json({ error: 'This video is unavailable or private.' }, 422);

    const captionIdx = html.indexOf('"captionTracks":');
    if (captionIdx === -1) {
      if (status === 'LOGIN_REQUIRED') return json({ error: 'This video is age-restricted or members-only.' }, 403);
      return json({ error: 'No transcript available for this video.' }, 422);
    }

    const arrayStart = html.indexOf('[', captionIdx);
    if (arrayStart === -1) return json({ error: 'No transcript available for this video.' }, 422);

    const raw = extractJsonArray(html, arrayStart);
    if (!raw) return json({ error: 'Could not parse caption tracks.' }, 422);

    const tracks = JSON.parse(raw);
    if (!Array.isArray(tracks) || !tracks.length) return json({ error: 'No transcript available for this video.' }, 422);

    const simplified = tracks.map((t) => ({ baseUrl: t.baseUrl, languageCode: t.languageCode, kind: t.kind }));
    return json({ tracks: simplified, videoId });
  } catch (err) {
    return json({ error: err.message ?? 'Failed to fetch transcript.' }, 500);
  }
}
