# Deploying for free

The whole app (website + API + live updates) runs as **one Render web service**.
The data lives in free managed services:

| What     | Service                                                                     | Free plan (check current limits when signing up)                         |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| App      | [Render](https://render.com) web service (Docker)                           | Sleeps after 15 min without visitors; wakes on the next visit (~30–60 s) |
| Database | [Neon](https://neon.tech) Postgres                                          | 0.5 GB storage                                                           |
| Redis    | [Upstash](https://upstash.com)                                              | Monthly command quota                                                    |
| Email    | Your own Gmail via the [Gmail API](https://developers.google.com/gmail/api) | About 500 emails/day                                                     |
| Code     | [GitHub](https://github.com) private repository                             | Free                                                                     |

Allow about 30–45 minutes the first time. No credit card is needed for any of them.

---

## 1. Put the code on GitHub

1. Create a **private** repository on GitHub, e.g. `casino` (don't add a README).
2. In PowerShell, in `C:\Users\PC\Desktop\casino`:

   ```bash
   git remote add origin https://github.com/YOUR-NAME/casino.git
   git push -u origin main
   ```

`.env` is git-ignored, so your local secrets are not uploaded.

## 2. Database: Neon

1. Sign up at neon.tech and create a project (pick the region closest to you, e.g. _Frankfurt_). Postgres 17.
2. On the project dashboard click **Connect**, turn **Connection pooling off**, and copy the connection string. It looks like
   `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Keep it for step 5 (`DATABASE_URL`). Tables are created automatically on the first deploy.

## 3. Redis: Upstash

1. Sign up at upstash.com → **Create database** (Redis), same region as Neon, free plan.
2. On the database page find the **TCP / ioredis** connection string that starts with `rediss://` (two s's), e.g.
   `rediss://default:PASSWORD@xxx.upstash.io:6379`
3. Keep it for step 5 (`REDIS_URL`).

## 4. Email: your Gmail (Gmail API)

Render's free plan blocks outgoing SMTP, so the app sends through the Gmail API over HTTPS, as your own Gmail address. Mail leaves Google's servers, so Gmail's spam checks (DMARC) pass.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, then **APIs & Services → Library** → enable **Gmail API**.
2. **OAuth consent screen**: choose _External_, fill in an app name and your email, add your Gmail as a test user, save. Then click **Publish app**.
   In _Testing_ mode Google expires the connection every 7 days and emails stop; published apps keep working.
3. **Credentials → Create credentials → OAuth client ID**, type **Web application**. Under _Authorized redirect URIs_ add
   `https://developers.google.com/oauthplayground`. Copy the **Client ID** and **Client secret**.
4. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground):
   1. Gear icon (top right) → tick **Use your own OAuth credentials** → paste the client ID and secret.
   2. In the left box type `https://mail.google.com/` → **Authorize APIs** → sign in with your Gmail.
      Google warns the app is unverified (it is your own app): **Advanced → Go to … (unsafe)** → allow.
   3. **Exchange authorization code for tokens** → copy the **Refresh token**.
5. Keep for step 5: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
   `MAIL_FROM` = `Casino <your.address@gmail.com>` (the same Gmail you signed in with).

Treat the refresh token like a password: it can send mail as you. To cut access later, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## 5. The app: Render

1. Generate one secret on your PC (used to encrypt 2FA secrets):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Sign up at render.com with your GitHub account.
3. **New → Blueprint**, pick your `casino` repository. Render reads `render.yaml` and asks for the values below:

   | Variable                                                                     | Value                                                           |
   | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
   | `APP_URL`                                                                    | Put `https://casino.onrender.com` for now; you fix it in step 6 |
   | `DATABASE_URL`                                                               | Neon string from step 2                                         |
   | `REDIS_URL`                                                                  | Upstash `rediss://…` string from step 3                         |
   | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAIL_FROM` | From step 4                                                     |
   | `ADMIN_EMAIL`                                                                | Your email; this becomes the admin account                      |
   | `ADMIN_PASSWORD`                                                             | A long password (12+ characters) for that admin                 |
   | `TOTP_ENCRYPTION_KEY`                                                        | The 64-character value from step 5.1                            |

   `JWT_ACCESS_SECRET` and `CSRF_SECRET` are generated by Render automatically.

4. Click **Apply**. The first build takes ~10 minutes. Watch the **Logs** tab; it is ready when you see `API listening on port …`.

## 6. Fix the address

1. Your service page shows its real address, e.g. `https://casino-a1b2.onrender.com`.
2. **Environment** → set `APP_URL` to exactly that (no trailing slash) → **Save**. Render redeploys.

   This matters: sign-in and every bet are refused if `APP_URL` doesn't match the address in the browser (CSRF protection).

3. Open the address, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. You'll see the **Admin** link.
4. Optional: delete `ADMIN_PASSWORD` from Render's environment now; it is only used to create the account the first time.

## 7. Check real visitor IPs (one-time)

Rate limits (e.g. login attempts) are per visitor IP, so the app must see each visitor's own IP.
Signed in as admin, open `https://YOUR-ADDRESS/api/admin/client-ip`.

- `ip` should be **your** public IP (compare with any "what is my IP" site).
- If it shows a Render/Cloudflare address instead, change `TRUST_PROXY_HOPS` in Render (try `2`, then `4`) until it is yours.

## 8. Optional: never sleep

Free Render services sleep after 15 minutes without visitors. To keep it awake:

1. Sign up at [UptimeRobot](https://uptimerobot.com) (free).
2. **Add monitor** → HTTP(s) → URL `https://YOUR-ADDRESS/api/health/live` → every 5 minutes.

`/api/health/live` doesn't touch the database or Redis, so pinging it uses none of Neon's or Upstash's free allowance.
One always-on service fits in Render's 750 free hours a month.

---

## Updating the live site

Push to GitHub; Render rebuilds and redeploys automatically, and new database migrations run on start:

```bash
git push
```

## Good to know

- **Sleeping:** the first visit after a quiet spell takes ~30–60 s. No data is lost; open games and balances are in the database.
- **Logs:** Render → your service → **Logs**.
- **Emails not arriving:** search the logs for `Email`. `Email sent` means Gmail accepted it (check spam on the receiving side). `Google token refresh failed … invalid_grant` means the refresh token stopped working: publish the consent screen (step 4.2) and repeat step 4.4 for a new token. `Gmail API responded 403` usually means the Gmail API isn't enabled in the project.
- **Backups:** Neon keeps a short restore history on the free plan. For your own copy, run `pg_dump "<DATABASE_URL>" > backup.sql` occasionally (needs PostgreSQL tools installed).
- **Limits:** if the Upstash command quota runs out, Redis requests fail until the next month. Upstash's dashboard shows usage.
- **Virtual credits only:** keep it a "social casino": no buying credits, no prizes, no cash-out. Adding real money or prizes brings gambling laws into play.
- **Run the production image locally:** `docker build -t casino .`, then `docker run --env-file .env.production -p 3000:3000 casino` with a `.env.production` holding the same variables as above.
