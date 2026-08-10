# Maximum-security setup: zero open ports

Goal: the site stops existing for the public internet. No port to scan, no login
page to brute-force, nothing for bots to find. Only devices approved by the owner
can even see it. This uses Tailscale (WireGuard VPN) — free for this team size,
apps for Windows / Android / iPhone.

Server: `185.214.134.250`, app in `~/gazserviceapp`, nginx on 80/443.

Do the steps IN ORDER. Step 6 is last on purpose — closing ports before the
tunnel works would lock everyone out.

---

## 0. Change the app passwords FIRST

The default logins (`boss/million`, `seller/work`, `accountant/check`) are printed
in the public README on GitHub. Until they are changed, every other step here is
pointless — an attacker doesn't break in, he logs in.

Site → login as **boss** → **Пользователи** → set new passwords on all three.

## 1. Update the code (includes a hardening fix)

```bash
cd ~/gazserviceapp
docker run --rm -v sklad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/sklad-backup-$(date +%F_%H%M).tar.gz -C /data .
git pull
docker compose up -d --build
curl -s localhost:3000/api/health        # {"ok":true}
```

The pull brings a docker-compose change that binds the app to `127.0.0.1` —
important because Docker-published ports silently bypass the ufw firewall, so
without this, port 3000 could be exposed no matter what ufw says.

## 2. Install Tailscale on the server

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

`tailscale up` prints a login URL. **The owner** opens it and signs in (Google
account works) — that account becomes the key ring for the whole network.

Check: `tailscale ip -4` → prints an address like `100.x.y.z`.

## 3. Serve the site inside the private network, with HTTPS

```bash
tailscale serve --bg 3000
tailscale serve status
```

`serve status` prints the private URL, like:

    https://vmi123456.tail1234.ts.net

Only devices logged into the owner's Tailscale network can open it. HTTPS
certificate is automatic — no certbot, nothing to renew.

(If `tailscale serve --bg 3000` complains about syntax on an older version, use:
`tailscale serve --bg --https=443 http://127.0.0.1:3000`)

## 4. Put Tailscale on every device that needs the site

- Windows laptop: https://tailscale.com/download → install → sign in with the
  owner's account
- Phones (seller / accountant): install “Tailscale” from Play Market / App Store
  → sign in with the same account → toggle ON

Each device then opens the `https://….ts.net` URL from step 3 in a normal
browser. Bookmark it.

Free plan allows 3 users / 100 devices — enough here. To give the accountant a
separate account instead of sharing, invite them from
https://login.tailscale.com/admin/users.

## 5. Enable Tailscale SSH (so closing port 22 doesn't lock you out)

```bash
tailscale up --ssh
```

Test it from any device on the tailnet **before step 6**:

```bash
ssh root@$(tailscale ip -4 | head -1)     # or: ssh root@100.x.y.z
```

Must log in with NO password prompt. Do not continue until this works.

## 6. Now slam the doors — firewall

Order matters: allow first, deny after, enable last.

```bash
ufw allow in on tailscale0
ufw allow 22/tcp                 # temporary safety line
ufw deny 80/tcp
ufw deny 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw enable                       # answer y
```

Verify from OUTSIDE the tailnet (e.g. phone with Tailscale toggled off):
the site must NOT open on http://185.214.134.250 or the domain.
From a tailnet device: the ts.net URL must still work.

Only when both checks pass, close SSH to the public too:

```bash
ufw deny 22/tcp
ufw reload
```

From this moment the server answers the public internet on **no port at all**.
Scanners see a dead address. SSH and the site work only through Tailscale.

## 7. If something goes wrong

- Locked out of SSH: Contabo panel → VNC console → `ufw allow 22/tcp`
- Tailscale down on a phone: open the app, toggle ON, sign in again
- Need to add a device later: install Tailscale on it, sign in — nothing to do
  on the server

---

## What this protects against — honestly

| Threat | Covered? |
|---|---|
| Port scanners, bot attacks, exploit probes | Yes — no ports respond at all |
| Someone finding the site and guessing passwords | Yes — they can't reach the login page |
| Stolen default passwords from GitHub | Yes, after step 0 |
| Traffic interception | Yes — WireGuard encryption end to end |
| A stolen, unlocked phone that has Tailscale ON | **No** — remove the device at login.tailscale.com/admin, and app passwords are the second wall |
| The owner's Google account being taken over | **No** — protect it with 2-step verification |

The weakest point is no longer the server — it is the devices and the Google
account. Turn on 2FA for that account.

## Rolling back (if this turns out too strict)

```bash
ufw disable
tailscale serve --bg off
```

Site is public again through nginx as before. Data is never touched by any of
this — these steps change only how the site is reached.
