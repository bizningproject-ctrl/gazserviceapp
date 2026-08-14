# Wiping the server data, and closing the site to the public

Server `185.214.134.250`, app in `~/gazserviceapp`, nginx in front.

---

# PART 1 — Erase all data on the server

**This cannot be undone.** Take the backup in step 1 even if you are certain —
it costs one command and it is the only way back.

## 1. Back up what is there now

```bash
cd ~/gazserviceapp
docker run --rm -v sklad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/BEFORE-WIPE-$(date +%F_%H%M).tar.gz -C /data .
ls -lh BEFORE-WIPE-*.tar.gz
```

Copy that file somewhere off the server before continuing.

## 2. Erase

```bash
docker compose down -v
```

The `-v` deletes the `sklad-data` volume — that is the whole database:
every product, install, expense, installer and user account.

## 3. Start fresh

```bash
docker compose up -d --build
curl -s localhost:3000/api/health      # {"ok":true}
```

The app recreates an empty database and re-seeds the three default logins
(`boss/million`, `seller/work`, `accountant/check`).

**Change those passwords immediately** — see Part 3.

## 4. (Optional) load the owner's data

Only if the server should carry the records from the owner's laptop:

1. Open the site, log in as **boss**
2. Настройки → **Импорт JSON** → pick `backup-preview_*.json` from the ZIP

Skip this step if you want the server to stay empty.

## Restoring, if the wipe was a mistake

```bash
cd ~/gazserviceapp
docker compose down
docker volume create sklad-data
docker run --rm -v sklad-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/BEFORE-WIPE-<timestamp>.tar.gz -C /data
docker compose up -d
```

---

# PART 2 — Stop the site being publicly reachable

Pick **one**. Option A is the usual choice.

## A. Password wall in front of the whole site (works from anywhere)

Anyone reaching the site gets a browser password box before the app even loads,
on top of the app's own login.

```bash
apt update && apt install -y apache2-utils
htpasswd -c /etc/nginx/.htpasswd gazmetprod        # asks for a password
```

Edit the site's nginx config:

```bash
nano /etc/nginx/sites-available/default        # or the file named after your domain
```

Inside the `location / { ... }` block add these two lines:

```nginx
auth_basic "Restricted";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Apply:

```bash
nginx -t && systemctl reload nginx
```

To add more people later: `htpasswd /etc/nginx/.htpasswd anothername`
(no `-c`, or it wipes the file).

## B. Only your own internet connections may reach it

Tighter than a password, but it breaks whenever an IP changes — mobile networks
change constantly, so this suits a fixed office line only.

Find your current address at <https://ifconfig.me>, then in the same
`location /` block:

```nginx
allow 203.0.113.45;      # office
allow 198.51.100.22;     # home
deny all;
```

```bash
nginx -t && systemctl reload nginx
```

## C. Close the ports entirely, reach it through an SSH tunnel

Nothing is exposed to the internet at all. Requires SSH access for each user.

```bash
ufw allow 22/tcp
ufw deny 80/tcp
ufw deny 443/tcp
ufw enable
```

Each user then runs, on their own machine:

```bash
ssh -L 8080:localhost:3000 root@185.214.134.250
```

and opens <http://localhost:8080>.

## Also: keep it out of Google

```bash
printf 'User-agent: *\nDisallow: /\n' > /var/www/html/robots.txt
```

Search engines cannot index a site behind option A or C anyway.

---

# PART 3 — Change the default passwords (do this regardless)

`boss/million`, `seller/work` and `accountant/check` are written in the public
README on GitHub. Anyone who finds the site can log in with them.

In the app: log in as **boss** → **Пользователи** → change the password on each
account. Do it before anyone uses the site for real work.
