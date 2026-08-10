# Deploy to the Contabo server

Server: `185.214.134.250` · app lives in `~/gazserviceapp` · nginx in front on 80/443.

## Normal update (code only, data untouched)

```bash
ssh root@185.214.134.250
cd ~/gazserviceapp
```

Back up the live database first — takes a second, makes everything reversible:

```bash
docker run --rm -v sklad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/sklad-backup-$(date +%F_%H%M).tar.gz -C /data .
```

Pull and rebuild:

```bash
git pull
docker compose up -d --build
curl -s localhost:3000/api/health     # expect {"ok":true}
```

Repo: https://github.com/bizningproject-ctrl/gazserviceapp — everything is on `main`.

## ⚠ Never run this

```bash
docker compose down -v     # the -v DELETES the database volume
```

`docker compose up -d --build` replaces the container but keeps the `sklad-data`
volume, which is where `warehouse.db` lives. That is why updates do not lose data.
Plain `docker compose down` (no `-v`) is safe if you need to stop it.

## If you are deploying this ZIP instead of pulling from git

Copy the folder to the server, then from inside it:

```bash
docker compose up -d --build
```

The `data/` folder in this ZIP is **not** used by the container — Docker mounts the
named volume `sklad-data` at `/app/data` instead, and the Dockerfile does not copy
`data/`. So deploying this ZIP will not overwrite whatever is already on the server.

## Restoring / transferring the data (only if asked for)

`data/warehouse.db` and `backup-preview_*.json` in this ZIP hold the owner's real
records. To load them onto the server, do **not** copy the file over the volume —
use the app instead:

1. Open the site, log in as **boss**
2. Настройки → **Импорт JSON** → choose `backup-preview_*.json`

That replaces the server's data with the file's contents, so take the tar.gz backup
above first.

## Logins

| Role | User | Password |
|---|---|---|
| Boss | `boss` | `million` |
| Seller | `seller` | `work` |
| Accountant | `accountant` | `check` |

Change these in the app: Пользователи (boss only).

## Adding an SSH key for the owner's laptop

The owner cannot SSH in — the server is key-only and his laptop has no key. To fix,
run this on the server once (his public key):

```bash
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH1EY9pufCoUN+zwk6FDvfaj4Y35xOcxsTUGMUc5sRg5 victus-laptop-gazmetprod" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

After that he can deploy himself with `ssh root@185.214.134.250`.
