# Lingueez personal web

This web edition lives alongside the Lingueez desktop source. It uses the same Google public translation endpoint and the desktop app's SM-2 review rules. Translating previews a result without saving it; clicking **Save to words** adds it to vocabulary. The language swap button supports English → Hebrew and Hebrew → English, as well as the other available language pairs. Repeated saves count as new encounters. The app includes vocabulary management, flashcards, a quiz, a pasted-text reader, progress, and JSON backup/import.

## Local run

Requires Node 20 or later.

```bash
cd web
npm install
APP_USERNAME=rotem APP_PASSWORD='choose-a-long-password' APP_SESSION_SECRET='choose-at-least-32-random-characters' npm run dev
```

Open `http://localhost:3000`. Local development stores data in `web/data/vocabulary.json`, which is ignored by Git.

## Vercel configuration

Set the Vercel project root to `web`. Configure these environment variables for Production:

- `APP_USERNAME`: the sole username.
- `APP_PASSWORD`: a long random password, stored only in Vercel environment settings.
- `APP_SESSION_SECRET`: at least 32 random characters for signed session cookies.
- `BLOB_READ_WRITE_TOKEN`: supplied by a **private** Vercel Blob store attached to the project.

Production refuses to use local file storage. The vocabulary and reading library are kept in the private Blob store. Keep the store when redeploying or moving the project.

The deployed project is `oathfox/lingueez-personal`, with `web` set as its Root Directory. Deploy from the repository root with `vercel --prod`; deploying from inside `web` will fail because Vercel expects to find the `web` directory in the uploaded source. The Vercel account has no GitHub login connection, so pushing the fork does not currently trigger a deployment.

The live custom domain is `en.oathfox.com`. Cloudflare has a DNS-only CNAME `en → 86b0aeb9a49b4aa3.vercel-dns-017.com`; Vercel has verified it for this project.

The static login screen can be loaded by anyone, while every data and translation API route requires a valid signed session. The server checks same-origin requests. The app's one account is configured by the environment variables; no credentials are committed to Git.

The Google web translation endpoint is unofficial and may change or rate-limit requests. A failed translation is shown as an error and is not saved as a successful word.

This web edition preserves the project's AGPL-3.0-or-later license and required Lingueez attribution in `NOTICE`.
