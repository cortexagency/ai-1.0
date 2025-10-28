# ✅ Simple, reliable Dockerfile using Node 20 + system Chromium
FROM node:20-bullseye


# Install Chromium + fonts + libs Puppeteer needs
RUN apt-get update && \
apt-get install -y --no-install-recommends \
chromium \
libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
libpangocairo-1.0-0 libxss1 libgtk-3-0 libxshmfence1 libglu1 \
fonts-liberation libu2f-udev && \
rm -rf /var/lib/apt/lists/*


WORKDIR /app


# Env: use system chromium and skip downloading
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
NODE_ENV=production


# Install deps first for better caching
COPY package.json package-lock.json ./
# Using npm install instead of npm ci to avoid strict lock mismatches; lock will still be respected
RUN npm install --omit=dev --no-audit


# Copy app
COPY . .


EXPOSE 3000
CMD ["node", "index.js"]