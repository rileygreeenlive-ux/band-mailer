# band-mailer

Local dev: `npm install` → copy `.env.example` to `.env` → `npm run dev` → http://127.0.0.1:3000

- `src/` backend, `public/` frontend
- Brand data in `src/config/brands.js`; assets in `public/assets/`
- `MAIL_PROVIDER` = `smtp` | `postmark` | `resend`
- Send log: `logs/send.jsonl`