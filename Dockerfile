# Build the Vite/React application.
FROM node:22-alpine AS build

WORKDIR /app

# Install exactly the dependencies recorded in package-lock.json.
COPY package*.json ./
RUN npm ci

# Vite embeds VITE_* values into the generated browser bundle at build time.
# Only public browser configuration belongs here; never pass service-role keys.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

COPY . .

# Runs the repository's existing prebuild/build/postbuild lifecycle scripts.
RUN npm run build

# Serve the static production bundle with Nginx.
FROM nginx:1.27-alpine AS production

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
