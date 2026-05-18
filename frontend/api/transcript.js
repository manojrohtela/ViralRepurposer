// Vercel serverless function — proxies YouTube InnerTube API to avoid browser CORS blocks.
// Uses Android client user-agent which bypasses datacenter IP bot detection.

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
    // Android client bypasses datacenter IP bot-blocking that WEB client triggers
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US',
            utcOffsetMinutes: 0,
          },
        },
      }),
    });

    if (!playerRes.ok) return res.status(502).json({ error: `YouTube returned ${playerRes.status}.` });
    const playerData = await playerRes.json();

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
