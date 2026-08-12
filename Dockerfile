# syntax=docker/dockerfile:1

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
