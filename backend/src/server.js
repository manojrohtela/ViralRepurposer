import "dotenv/config";
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import { execFile } from "child_process";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8012);
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_DIRECT_CHARS = 26000;
const CHUNK_CHARS = 12000;

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const SYSTEM_PROMPT = `You are a Hollywood Script Writer & Viral Growth Marketer.
Your job is to repurpose a long YouTube transcript into high-retention social content.

Return ONLY valid JSON with this exact shape:
{
  "shortsScripts": [
    {
      "title": "string",
      "timestamp": "MM:SS-MM:SS or HH:MM:SS-HH:MM:SS",
      "viralHook": "string",
      "script": "markdown string with scene beats, voiceover, captions, and CTA",
      "whyItWorks": "string"
    }
  ],
  "linkedinPost": "markdown string",
  "twitterThread": ["tweet 1", "tweet 2", "tweet 3"]
}

Rules:
- Create exactly 3 Shorts/Reels scripts.
- Each Short must identify the strongest timestamp range from the transcript.
- Hooks must be specific, curiosity-driven, and non-clickbait.
- Scripts must be shootable in 30-60 seconds with caption-ready wording.
- LinkedIn should be detailed, useful, story-led, and end with a thoughtful CTA.
- X thread should be punchy, skimmable, and 7-10 tweets.
- Preserve factual claims from the transcript. Do not invent names, numbers, or results.
- If the transcript lacks timestamps for an idea, choose the nearest available timestamp range.`;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "viral-repurposer", port: PORT });
});

app.post("/api/viral-content/generate", async (req, res) => {
  try {
    if (!groq) {
      return res.status(500).json({ error: "GROQ_API_KEY is not configured." });
    }

    const url = String(req.body?.url || "").trim();
    if (!isYouTubeUrl(url)) {
      return res.status(400).json({ error: "Please provide a valid YouTube video URL." });
    }

    // Accept pre-fetched transcript from browser (avoids server-side bot detection)
    const prefetched = Array.isArray(req.body?.transcript) ? req.body.transcript : null;
    const transcript = prefetched ?? await fetchTranscript(url);
    if (!transcript.length) {
      return res.status(422).json({ error: "No transcript was found for this video." });
    }

    const formattedTranscript = formatTranscript(transcript);
    const workingTranscript =
      formattedTranscript.length > MAX_DIRECT_CHARS
        ? await summarizeTranscriptInChunks(formattedTranscript)
        : formattedTranscript;

    const result = await generateRepurposedContent(workingTranscript, {
      originalLength: formattedTranscript.length,
      compressed: formattedTranscript.length > MAX_DIRECT_CHARS,
    });

    res.json({
      videoUrl: url,
      transcriptItems: transcript.length,
      ...result,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to repurpose content.";
    res.status(500).json({ error: message });
  }
});

function isYouTubeUrl(value) {
  try {
    const parsed = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchTranscript(url) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "vr-"));
  try {
    const ytdlpArgs = [
      "--js-runtimes", "node",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs", "en",
      "--sub-format", "json3",
      "--skip-download",
      "--no-warnings",
      "--quiet",
      "-o", path.join(tmpDir, "%(id)s"),
    ];

    // Use YouTube cookies if configured (required for datacenter IPs)
    const cookiesPath = process.env.YTDLP_COOKIES;
    if (cookiesPath) ytdlpArgs.push("--cookies", cookiesPath);

    ytdlpArgs.push(url);
    try {
      await execFileAsync("yt-dlp", ytdlpArgs, { timeout: 30000 });
    } catch (e) {
      const stderr = e.stderr || e.message || "";
      if (/Sign in to confirm|bot|login required/i.test(stderr)) {
        throw new Error("YouTube is blocking automated access for this video. This can happen with certain public videos from datacenter IPs. Please try a popular English-language YouTube video instead.");
      }
      if (/No subtitles|no.*transcript|transcript.*disabled/i.test(stderr)) {
        throw new Error("No transcript is available for this video.");
      }
      throw new Error("Could not fetch transcript. The video may be private, region-locked, or unavailable.");
    }

    const files = await readdir(tmpDir);
    const subFile = files.find((f) => f.endsWith(".json3"));
    if (!subFile) throw new Error("No transcript found for this video.");

    const data = JSON.parse(await readFile(path.join(tmpDir, subFile), "utf8"));
    return (data.events || [])
      .filter((e) => e.segs?.length)
      .map((e) => ({
        text: cleanText(e.segs.map((s) => s.utf8 || "").join("")),
        offset: e.tStartMs ?? 0,
        duration: e.dDurationMs ?? 0,
      }))
      .filter((e) => e.text);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function formatTranscript(rows) {
  return rows
    .filter((row) => row.text)
    .map((row) => `[${formatTime(row.offset)}] ${row.text}`)
    .join("\n");
}

function cleanText(value) {
  return value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${mmss}` : mmss;
}

async function summarizeTranscriptInChunks(transcript) {
  const chunks = splitText(transcript, CHUNK_CHARS);
  const summaries = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.25,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "Compress transcript chunks for a viral content strategist. Preserve timestamps, standout claims, stories, examples, objections, and emotionally charged moments. Return concise markdown.",
        },
        { role: "user", content: `Chunk ${index + 1}/${chunks.length}\n\n${chunks[index]}` },
      ],
    });
    summaries.push(response.choices[0]?.message?.content || "");
  }

  return summaries.map((summary, index) => `## Transcript chunk ${index + 1}\n${summary}`).join("\n\n");
}

function splitText(text, maxChars) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    if ((current + line).length > maxChars && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function generateRepurposedContent(transcript, metadata) {
  const response = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.65,
    max_tokens: 3600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Repurpose this YouTube transcript. Metadata: ${JSON.stringify(metadata)}\n\n${transcript}`,
      },
    ],
  });

  return normalizeResult(parseJson(response.choices[0]?.message?.content || "{}"));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = text.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw new Error("Groq returned a response that could not be parsed.");
  }
}

function normalizeResult(data) {
  return {
    shortsScripts: Array.isArray(data.shortsScripts) ? data.shortsScripts.slice(0, 3) : [],
    linkedinPost: typeof data.linkedinPost === "string" ? data.linkedinPost : "",
    twitterThread: Array.isArray(data.twitterThread) ? data.twitterThread : [],
  };
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Viral Repurposer API listening on ${PORT}`);
});
