# Dockerfile for Cortex AI Bot

FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --no-cache

# Copy the rest of the application code
COPY . .

# =========================
# ENVIRONMENT VARIABLES
# =========================
ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=America/Bogota
ENV OWNER_NUMBER=573223698554
ENV OWNER_WHATSAPP_ID=573223698554@c.us
ENV GOOGLE_REVIEW_LINK=https://g.page/r/TU_LINK_AQUI/review
ENV OPENAI_API_KEY=sk-YOUR_API_KEY
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "index.js"]