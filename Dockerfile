FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update \
    && apt-get install -y chromium \
    && apt-get install -y --no-install-recommends \
        chromium-browser \
        nss \
        freetype2-demos \
        freetype-dev \
        harfbuzz \
        ca-certificates \
        ttf-freefont \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DISPLAY=:99

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit

# Copy app files
COPY . .

# Start the bot
CMD ["node", "index.js"]
