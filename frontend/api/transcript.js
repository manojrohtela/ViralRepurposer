// Vercel serverless function — scrapes YouTube watch page to get signed captionTracks URLs.
// Returns track metadata only; the browser fetches the actual caption file (credentials required).

export const config = { maxDuration: 20 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const url = req.query?.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter.' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb; GPS=1',
      },
    });

    if (!pageRes.ok) return res.status(502).json({ error: `YouTube page returned ${pageRes.status}.` });
    const html = await pageRes.text();

    const statusMatch = html.match(/"playabilityStatus":\{"status":"([^"]+)"/);
    const status = statusMatch?.[1];
    if (status === 'LOGIN_REQUIRED') return res.status(403).json({ error: 'This video is age-restricted or members-only.' });
    if (status === 'UNPLAYABLE' || status === 'ERROR') return res.status(422).json({ error: 'This video is unavailable or private.' });

    const captionIdx = html.indexOf('"captionTracks":');
    if (captionIdx === -1) return res.status(422).json({ error: 'No transcript available for this video.' });

    const arrayStart = html.indexOf('[', captionIdx);
    if (arrayStart === -1) return res.status(422).json({ error: 'No transcript available for this video.' });

    const raw = extractJsonArray(html, arrayStart);
    if (!raw) return res.status(422).json({ error: 'Could not parse caption tracks.' });

    const tracks = JSON.parse(raw);
    if (!Array.isArray(tracks) || !tracks.length) return res.status(422).json({ error: 'No transcript available for this video.' });

    // Return track metadata — browser fetches actual captions using its own YouTube cookies
    const simplified = tracks.map((t) => ({ baseUrl: t.baseUrl, languageCode: t.languageCode, kind: t.kind }));
    res.status(200).json({ tracks: simplified, videoId });
  } catch (err) {
    res.status(500).json({ error: err.message ?? 'Failed to fetch transcript.' });
  }
}
