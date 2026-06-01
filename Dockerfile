FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/rss_reader.db
ENV PORT=3001

EXPOSE 3001

CMD ["node", "app.js"]
