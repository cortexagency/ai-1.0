FROM node:20-slim

# Install Chromium and dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        chromium-browser \
        nss \
        freetype2 \
        libfreetype6 \
        libfreetype6-dev \
        libharfbuzz0b \
        ca-certificates \
        fonts-freefont-ttf \
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
