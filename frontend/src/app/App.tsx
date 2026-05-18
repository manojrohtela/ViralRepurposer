import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Check, Clipboard, Clapperboard, Copy, Linkedin, Loader2, RotateCcw, Send, Sparkles, Video } from 'lucide-react';
import { generateViralContent } from './lib/api';
import type { ShortScript, ViralContentResponse } from './lib/types';

type Tab = 'shorts' | 'linkedin' | 'twitter';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'shorts', label: 'Shorts Scripts' },
  { id: 'linkedin', label: 'LinkedIn Post' },
  { id: 'twitter', label: 'Twitter Thread' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function formatShorts(shorts: ShortScript[]) {
  return shorts
    .map((item, index) => (
      `## Short ${index + 1}: ${item.title}\n\n` +
      `**Timestamp:** ${item.timestamp}\n\n` +
      `**Viral Hook:** ${item.viralHook}\n\n` +
      `**Script**\n${item.script}\n\n` +
      `**Why it works:** ${item.whyItWorks}`
    ))
    .join('\n\n---\n\n');
}

function formatThread(tweets: string[]) {
  return tweets.map((tweet, index) => `${index + 1}. ${tweet}`).join('\n\n');
}

function ResultPanel({ activeTab, result }: { activeTab: Tab; result: ViralContentResponse }) {
  const markdown = useMemo(() => {
    if (activeTab === 'shorts') return formatShorts(result.shortsScripts);
    if (activeTab === 'linkedin') return result.linkedinPost;
    return formatThread(result.twitterThread);
  }, [activeTab, result]);

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Transcript segments read</p>
          <p className="text-lg font-semibold text-white">{result.transcriptItems.toLocaleString()}</p>
        </div>
        <CopyButton text={markdown} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="max-h-[620px] overflow-auto rounded-xl border border-slate-700/50 bg-slate-950/70 p-5"
        >
          <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{markdown}</pre>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('shorts');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ViralContentResponse | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) {
      setError('Paste a YouTube URL to begin.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await generateViralContent(url.trim(), manualTranscript);
      setResult(data);
      setActiveTab('shorts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not repurpose this video.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-pink-500/10 blur-3xl" />
      </div>

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-8 md:py-12">
        <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-4 py-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span className="text-sm text-indigo-300">AI Viral Repurposing</span>
          </div>
          <h1 className="mb-3 text-4xl font-bold md:text-5xl">
            Viral Content
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"> Repurposer</span>
          </h1>
          <p className="mx-auto max-w-2xl text-slate-400">
            Turn one long YouTube video into Shorts scripts, a polished LinkedIn post, and a punchy X thread.
          </p>
        </motion.header>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.45fr]">
          <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
              <Clapperboard className="h-7 w-7" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">YouTube video URL</label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 transition-colors focus-within:border-indigo-500/60">
                  <Video className="h-5 w-5 shrink-0 text-slate-500" />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Transcript fallback</label>
                <textarea
                  value={manualTranscript}
                  onChange={(event) => setManualTranscript(event.target.value)}
                  rows={7}
                  placeholder="Paste the transcript here for age-restricted, members-only, private, or blocked videos."
                  className="w-full resize-none rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-500/60"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Optional. If filled, the agent skips YouTube transcript extraction and repurposes this text directly.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 py-4 font-medium text-white transition-all hover:from-indigo-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {loading ? 'Extracting transcript and writing assets...' : 'Repurpose Video'}
              </button>
            </form>

            {result && (
              <button
                onClick={() => {
                  setResult(null);
                  setUrl('');
                  setManualTranscript('');
                  setError(null);
                }}
                className="mt-4 flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
              >
                <RotateCcw className="h-4 w-4" />
                Start over
              </button>
            )}
          </motion.section>

          <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="space-y-4">
            <div className="flex gap-1 rounded-xl border border-slate-700/50 bg-slate-800/50 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === tab.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-700/40 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {result ? (
              <ResultPanel activeTab={activeTab} result={result} />
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-700/60 bg-slate-800/30 p-8 text-center">
                <div>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-800">
                    <Clipboard className="h-7 w-7 text-indigo-400" />
                  </div>
                  <p className="text-lg font-semibold text-white">Your repurposed assets will appear here</p>
                  <p className="mt-2 max-w-md text-sm text-slate-400">
                    Each tab is formatted as markdown and ready to copy into your publishing workflow.
                  </p>
                </div>
              </div>
            )}
          </motion.section>
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Linkedin className="h-3.5 w-3.5" /> LinkedIn-ready</span>
          <span>Shorts scripts with timestamps</span>
          <span>X thread output</span>
        </footer>
      </main>
    </div>
  );
}
