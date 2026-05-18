// Vercel serverless function — fetches YouTube transcript by scraping the watch page.
// Uses targeted JSON extraction to avoid parsing the huge ytInitialPlayerResponse.

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

function cleanText(text) {
  return text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// String-aware JSON array extractor — handles { } [ ] inside strings.
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

    if (req.query?.debug === '1') {
      const captionIdx = html.indexOf('"captionTracks":');
      const arrayStart = captionIdx !== -1 ? html.indexOf('[', captionIdx) : -1;
      const raw = arrayStart !== -1 ? extractJsonArray(html, arrayStart) : null;
      let parseResult = null;
      if (raw) { try { parseResult = JSON.parse(raw); } catch (e) { parseResult = { error: e.message, rawLast100: raw.slice(-100) }; } }
      const enTrack = Array.isArray(parseResult) ? (parseResult.find(t => t.languageCode?.startsWith('en')) ?? parseResult[0]) : null;
      let captionTest = null;
      if (enTrack?.baseUrl) {
        try {
          const cr = await fetch(`${enTrack.baseUrl}&fmt=json3`);
          const bodyText = await cr.text();
          let cd = null;
          try { cd = JSON.parse(bodyText); } catch {}
          captionTest = { status: cr.status, contentType: cr.headers.get('content-type'), bodyLen: bodyText.length, bodyFirst200: bodyText.slice(0, 200), events: cd?.events?.length ?? 0 };
        } catch (e) { captionTest = { error: e.message }; }
      }
      return res.status(200).json({ htmlLen: html.length, captionIdx, rawLen: raw?.length, enTrackUrl: enTrack?.baseUrl?.slice(0, 120), captionTest });
    }

    // Check playability status with a simple regex
    const statusMatch = html.match(/"playabilityStatus":\{"status":"([^"]+)"/);
    const status = statusMatch?.[1];
    if (status === 'LOGIN_REQUIRED') return res.status(403).json({ error: 'This video is age-restricted or members-only.' });
    if (status === 'UNPLAYABLE' || status === 'ERROR') return res.status(422).json({ error: 'This video is unavailable or private.' });

    // Extract just the captionTracks array — much smaller than full ytInitialPlayerResponse
    const captionIdx = html.indexOf('"captionTracks":');
    if (captionIdx === -1) return res.status(422).json({ error: 'No transcript available for this video.' });

    const arrayStart = html.indexOf('[', captionIdx);
    if (arrayStart === -1) return res.status(422).json({ error: 'No transcript available for this video.' });

    const raw = extractJsonArray(html, arrayStart);
    if (!raw) return res.status(422).json({ error: 'Could not parse caption tracks.' });

    const tracks = JSON.parse(raw);
    if (!Array.isArray(tracks) || !tracks.length) return res.status(422).json({ error: 'No transcript available for this video.' });

    const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
    if (!track?.baseUrl) return res.status(422).json({ error: 'No usable caption track found.' });

    const captionRes = await fetch(`${track.baseUrl}&fmt=json3`);
    if (!captionRes.ok) return res.status(502).json({ error: 'Failed to fetch captions.' });

    const captionData = await captionRes.json();
    const items = (captionData.events ?? [])
      .filter((e) => e.segs?.length)
      .map((e) => ({
        text: cleanText(e.segs.map((s) => s.utf8 ?? '').join('')),
        offset: e.tStartMs ?? 0,
        duration: e.dDurationMs ?? 0,
      }))
      .filter((e) => e.text);

    if (!items.length) return res.status(422).json({ error: 'Transcript is empty.' });

    res.status(200).json({ items, videoId });
  } catch (err) {
    res.status(500).json({ error: err.message ?? 'Failed to fetch transcript.' });
  }
}
