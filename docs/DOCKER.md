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

## Publish and deploy prebuilt images with GHCR

GitHub Actions publishes the production image to:

```text
ghcr.io/olitechs/olitechpmspos
```

The workflow at `.github/workflows/publish-ghcr.yml` runs on pushes to `main`,
version tags beginning with `v` (for example `v1.2.3`), and manual dispatch.
It builds Linux AMD64 and ARM64 images and publishes metadata/SBOM attestations.
The workflow uses the built-in `GITHUB_TOKEN`; no personal access token is needed
for publishing.

### One-time GitHub configuration

In the repository, open **Settings → Secrets and variables → Actions → Variables**
and add these two repository variables using the public browser configuration for
the intended Supabase project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The workflow checks that both exist before publishing. These values are compiled
into the frontend bundle and are public client configuration, not server secrets.
Never add a Supabase service-role key or database password here.

### Image tags

- `main` and `latest`: latest successful image built from the default branch.
- `v1.2.3`: exact Git tag.
- `1.2.3`, `1.2`, and `1`: semantic-version aliases for a version tag.
- `sha-<commit>`: immutable commit-specific image.

To publish a release image, create and push a version tag after merging the release
to `main`:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The GitHub Actions workflow builds and publishes the versioned image automatically.
The GHCR package is private by default unless its package visibility is changed in
GitHub Packages settings. Keep it private unless you intentionally want public pulls.

### Pull and run the published image

The repository includes `docker-compose.ghcr.yml`, which uses the prebuilt
`latest` image and does not build source code on the deployment machine.

For a private package, authenticate to GHCR first with a GitHub token that has
`read:packages` permission:

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Then pull and start the service:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Open `http://localhost:8080`. To use another port, set `PORT` before starting
Compose (for example, `PORT=8081` on Linux/macOS or
`$env:PORT="8081"` in PowerShell). To deploy a pinned release instead of
`latest`, change the image tag in `docker-compose.ghcr.yml` to the exact version,
for example `ghcr.io/olitechs/olitechpmspos:v1.2.3`.

Useful commands:

```bash
docker compose -f docker-compose.ghcr.yml ps
docker compose -f docker-compose.ghcr.yml logs -f
docker compose -f docker-compose.ghcr.yml down
```

## Useful commands for local builds

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
For GHCR images, update the GitHub repository variables and rerun the publishing
workflow to create a new image.

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
  in `.env` (or GitHub Actions repository variables for GHCR), then rebuild.
- **Private image pull denied:** log in to `ghcr.io` with a token that has
  `read:packages` permission, and confirm the GitHub account can access the package.
- **Refreshing a nested route returns 404:** confirm the container uses the
  repository's `nginx/default.conf` and rebuild.
- **Port 8080 is already in use:** change `PORT` for the GHCR Compose file or the
  left side of the local Compose port mapping, and open the matching local URL.
- **Build fails:** inspect the output of `docker compose build --no-cache` and
  compare it with the repository's normal `npm ci` and `npm run build` results.
