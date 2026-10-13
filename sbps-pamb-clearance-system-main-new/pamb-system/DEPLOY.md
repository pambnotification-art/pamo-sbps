# Putting the system online

The app is a Node.js server that keeps its database and uploaded documents in the `data/` folder. Wherever you host it, **that folder must survive restarts**. A host that wipes its disk will also wipe every account and application.

## Which option?

| Option | Cost | Keeps data? | Best for |
|---|---|---|---|
| **A. A PAMO office computer or server** | Free | Yes | Real use. Data stays in-house. |
| **B. Oracle Cloud "Always Free" VM** | Free | Yes (real disk) | Real use online, without paying. |
| **C. Free app hosts (Render, Koyeb and similar)** | Free | **Usually no** | A demo only. Check that the plan has a persistent disk before you trust it. |

## A. Office computer or server

1. Install Node.js 22.13 or newer.
2. Unzip, then in the folder run `npm ci --omit=dev` once (it installs the two small libraries for `.env` and email), then: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase-1' npm start`
3. Staff on the same network open `http://<that computer's address>:3000`.
4. To reach it from outside the office without opening your router, a Cloudflare Tunnel (`cloudflared`) can publish it. Check Cloudflare's current free-plan terms first. Then set `COOKIE_SECURE=1` and `TRUST_PROXY=1`, because the tunnel serves HTTPS.
5. Keep the computer on, and let the app start with the machine (a Windows Task Scheduler task, or a systemd service on Linux, see section B step 5).

## B. Oracle Cloud Always Free VM

Oracle's free tier includes up to 200 GB of disk, and one VM can be Arm with up to 2 CPUs and 12 GB of memory. Two caveats:

- **Idle reclaim.** Oracle may reclaim an Always Free instance that stays idle for 7 days (low CPU and network use). A small office system can look idle. Ask Oracle whether upgrading the account to pay-as-you-go (still within the free allowance) removes this risk. I could not confirm it. Until then, treat the VM as something you may have to recreate, and keep backups.
- **Sign-up** usually asks for a payment card for identity checks.

Steps:

1. Create the account and an **Ubuntu** VM. Open ports **80 and 443** in the VM's network security rules, and in Ubuntu's firewall.
2. Get a domain. A free name from DuckDNS works. Point it at the VM's public IP.
3. Install Node 22 and Caddy (Caddy gets the HTTPS certificate for you):
   ```
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
   sudo apt install -y caddy
   ```
4. Copy the app to `/opt/pamb` (unzip it there) and run `npm ci --omit=dev` inside it.
5. Run it as a service. Create `/etc/systemd/system/pamb.service`:
   ```
   [Unit]
   Description=SBPS PAMB Clearance System
   After=network.target

   [Service]
   WorkingDirectory=/opt/pamb
   Environment=PORT=3000 HOST=127.0.0.1 DATA_DIR=/var/lib/pamb COOKIE_SECURE=1 TRUST_PROXY=1
   Environment=ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=choose-a-long-passphrase-1
   ExecStart=/usr/bin/node --no-warnings server.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Then: `sudo mkdir -p /var/lib/pamb && sudo systemctl enable --now pamb`
6. Put HTTPS in front. In `/etc/caddy/Caddyfile`:
   ```
   your-name.duckdns.org {
     reverse_proxy 127.0.0.1:3000
   }
   ```
   Then `sudo systemctl reload caddy`. Open `https://your-name.duckdns.org`.
7. Log in as the admin and change the password when asked.

## C. Free app hosts (demo only)

The included `Dockerfile` works with any host that runs containers. Set these environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE=1`. Mount a persistent volume at `/data` if the plan offers one. Free web services on several hosts spin down when idle and may not offer a persistent disk. Without one, everything resets on each restart.

## Email notifications (optional)

Applicants are emailed when their application is cleared, rejected, returned for revision, or when their ECC needs to be redone. Set `SMTP_HOST`, `SMTP_FROM` and, if your mail provider needs them, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE`. Put them in a `.env` file next to `server.js`, or in your host's environment settings. Never commit `.env`; it is already in `.gitignore`. With no SMTP settings, no email is sent and everything else works.

## Backups (do this wherever you host)

```
npm run backup
```

This writes a consistent copy of the database plus all uploads into a `backups/` folder next to `data/`. It is safe to run while the app is live. Run it daily (cron or Task Scheduler) and copy the result off the machine.

## Before real use

- The first admin password is printed once in the logs. Set `ADMIN_PASSWORD` yourself, and change it on first login.
- Always serve over HTTPS and set `COOKIE_SECURE=1`.
- Uploaded documents are personal data. Limit who can log in to the host, and keep the backups private.
