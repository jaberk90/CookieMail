# Build your HOST application, with CookieMail installed as a dependency.
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
ENV NODE_ENV=production
CMD ["node", "server.js"]
