# Gazmetprod Sklad — Warehouse system

Single-shop warehouse management for car gas equipment (LPG cylinders, reducers, ECUs, etc.).
Roles: **Boss** (full access, finances, reports) and **Seller** (sales / purchases / installs, no finance view).

## Two ways to run

### A. Standalone (no install)
Open `index.html` directly in Chrome — data is stored in browser localStorage.
Works offline but **only on one device** (data does not sync between devices/browsers).

### B. With backend (multi-device, recommended for real use)
A small Node.js server stores all data in a SQLite file (`warehouse.db`).
Multiple devices on the same Wi-Fi can connect to the same data.

#### One-time setup
1. Install Node.js 18+ (https://nodejs.org)
2. Open a terminal in this folder and run:
   ```
   npm install
   ```

#### Starting the server
```
npm start
```
The terminal will print URLs:
```
Local:    http://localhost:3000
Network:  http://192.168.x.x:3000
```
- On **this computer**: open http://localhost:3000
- On **phone / tablet / another laptop on same Wi-Fi**: open the Network URL

Leave the terminal running while people are using the app.

## Default logins (case-insensitive)
| Role   | Username | Password  |
|--------|----------|-----------|
| Boss   | `boss`   | `Million` |
| Seller | `seller` | `Work`    |

Change them by editing the `users` table or via the future user management UI.

## Files
- `server.js` — backend (Express + SQLite)
- `package.json` — npm dependencies
- `public/index.html` — frontend (served by the backend)
- `index.html` — same file, kept here for standalone use
- `data/warehouse.db` — auto-created SQLite database (your data)
- `Dockerfile`, `docker-compose.yml` — container deployment

## Install from GitHub
```
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
npm install
npm start
```

## Run in Docker
With docker-compose (recommended — keeps data in a named volume):
```
docker compose up -d --build
```
Or with plain Docker:
```
docker build -t gazmetprod-sklad .
docker run -d --name sklad -p 3000:3000 -v sklad-data:/app/data gazmetprod-sklad
```
Open http://localhost:3000.

Data lives in the `sklad-data` volume. Back it up with:
```
docker run --rm -v sklad-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/sklad-backup.tar.gz -C /data .
```

## Backups
- Boss menu → Settings → **Export JSON** downloads a snapshot
- Or copy `warehouse.db` to safety regularly

## Troubleshooting
- **Port 3000 already in use** — set `PORT=4000 npm start`
- **Other devices can't connect** — Windows Firewall may block; allow Node.js
- **Forgot password** — delete the `users` row in `warehouse.db` and restart (it'll re-seed defaults)
