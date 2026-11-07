# Docker setup — OliTechs PMS + POS

This repository's Docker configuration builds the existing React 18/Vite frontend
and serves the production bundle with Nginx. It is an additional deployment and
local-testing option; it does not replace the current Vercel deployment or Supabase
project.

## What runs in Docker

- A Node.js build stage installs the locked npm dependencies and runs
  `npm run build`, including the repository's existing brand-asset lifecycle scripts.
- An Nginx runtime stage serves the generated `dist/` files.
- Nginx falls back to `index.html` for React Router routes and exposes
  `/health` for container health checks.

The Supabase backend/database remain external. The local Print Agent is intentionally
not containerized by this frontend setup: it is designed for Windows workstations,
Windows printer drivers/spooler access, and local printer hardware.

## Requirements

- Docker Desktop with Docker Compose v2 on Windows, macOS, or Linux.
- A working Supabase project and its public browser configuration.

## Run locally (PowerShell)

From the repository root:

```powershell
Copy-Item .env.example .env
```

Review `.env` and set the correct values for:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are public browser values and are embedded into the Vite bundle at image-build
time. The Supabase anon/publishable key is not a substitute for Row Level Security.
Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or other server secrets
in Docker build arguments or any `VITE_*` variable. The Docker Compose configuration
passes only the two public Vite variables to the build.

Build and start:

```powershell
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080).

## Useful commands

```powershell
# Show running services and health
docker compose ps

# Follow application container logs
docker compose logs -f oli-techs

# Rebuild after changing source or public Vite configuration
docker compose up --build -d

# Stop and remove the container (keeps the image)
docker compose down

# Remove the locally built image too
docker image rm olitechs-pms-pos:local
```

## Configuration changes

Vite's `VITE_*` values are compiled into static browser files. Changing `.env`
after the image has been built does not change the running frontend. Rebuild the
image with `docker compose up --build -d` after changing either public value.

Do not commit `.env`; it is excluded by the repository's Git ignore rules and
Docker build context exclusions.

## Vercel and production

- Keep the existing Vercel project and its environment variables unchanged.
- This Docker setup does not run Supabase migrations or provision a database.
- For a public Docker deployment, use a supported container host, configure HTTPS
  and domain/DNS, provide the two public Vite build values securely at build time,
  and establish an independent backup/monitoring plan for the Supabase project.
- Do not expose the local Print Agent publicly. Keep it installed natively on the
  Windows POS workstation that needs access to the printer.

## Troubleshooting

- **Blank page or Supabase configuration error:** verify the two public Vite values
  in `.env`, then rebuild the image.
- **Refreshing a nested route returns 404:** confirm the container uses the
  repository's `nginx/default.conf` and rebuild.
- **Port 8080 is already in use:** change the left side of the Compose port mapping,
  for example `8081:80`, and open the matching local URL.
- **Build fails:** inspect the output of `docker compose build --no-cache` and
  compare it with the repository's normal `npm ci` and `npm run build` results.
