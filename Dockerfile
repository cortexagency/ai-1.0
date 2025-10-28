FROM node:20-slim

# Install required dependencies first
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        gnupg \
        ca-certificates

# Add Chromium repository and install Chromium
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        libnss3 \
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
