// Vercel serverless function — fetches YouTube transcript by scraping the watch page.
// Avoids InnerTube API bot-detection that blocks datacenter IPs (Vercel/Oracle).

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

// Extract the first complete JSON object starting at `start` in `html`.
// String-aware so that { and } inside quoted values don't throw off counting.
function extractJson(html, start) {
  let depth = 0, i = start, inStr = false, esc = false;
  while (i < html.length) {
    const c = html[i];
    if (esc) { esc = false; }
    else if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
    }
    i++;
  }
  return null;
}

async function getPlayerData(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      // Accept YouTube's consent so we don't get the GDPR wall
      'Cookie': 'CONSENT=YES+cb; GPS=1; VISITOR_INFO1_LIVE=; YSC=',
    },
  });

  if (!res.ok) throw new Error(`YouTube page returned ${res.status}.`);

  const html = await res.text();

  // YouTube assigns the variable as "var ytInitialPlayerResponse = {...}"
  // Use the bare name and then seek to the first { that follows
  const MARKER = 'ytInitialPlayerResponse';
  const markerIdx = html.indexOf(MARKER);
  if (markerIdx === -1) throw new Error('Could not parse YouTube page (marker missing).');

  const jsonStart = html.indexOf('{', markerIdx);
  if (jsonStart === -1) throw new Error('Could not parse YouTube page (JSON start missing).');

  const raw = extractJson(html, jsonStart);
  if (!raw) throw new Error('Could not parse YouTube page (JSON extraction failed).');

  return JSON.parse(raw);
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
    // Debug: return raw page info if ?debug=1
    if (req.query?.debug === '1') {
      const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': 'CONSENT=YES+cb; GPS=1; VISITOR_INFO1_LIVE=; YSC=',
        },
      });
      const html = await r.text();
      return res.status(200).json({
        httpStatus: r.status,
        hasMarker: html.includes('ytInitialPlayerResponse'),
        hasConsentWall: html.includes('consent.youtube.com'),
        pageTitle: html.match(/<title>([^<]+)<\/title>/)?.[1] ?? 'N/A',
        markerContext: (() => {
          const idx = html.indexOf('ytInitialPlayerResponse');
          return idx !== -1 ? html.slice(idx, idx + 150) : 'not found';
        })(),
      });
    }

    const playerData = await getPlayerData(videoId);

    const status = playerData?.playabilityStatus?.status;
    if (status === 'LOGIN_REQUIRED') return res.status(403).json({ error: 'This video is age-restricted or members-only.' });
    if (status === 'UNPLAYABLE' || status === 'ERROR') return res.status(422).json({ error: 'This video is unavailable or private.' });

    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) return res.status(422).json({ error: 'No transcript available for this video.' });

    const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
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
