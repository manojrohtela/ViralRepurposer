# Viral Repurposer

Viral Content Repurposing Agent for OmniHub.

Input a long YouTube URL and the agent extracts the transcript, sends it to Groq, and generates:

- Three Shorts/Reels scripts with timestamps and viral hooks
- One detailed LinkedIn post
- One punchy Twitter/X thread

## Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Default API base: `http://localhost:8012/api/viral-content`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Default frontend dev port: `5186`
