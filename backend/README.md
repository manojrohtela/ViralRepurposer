# Viral Content Repurposing Agent API

Node.js/Express backend that turns a long YouTube video into short-form scripts, a LinkedIn post, and an X thread using YouTube transcripts and Groq.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## API

- `GET /health`
- `POST /api/viral-content/generate`

Request:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

