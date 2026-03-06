# STAGE 1 — Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Recebe a API Key como argumento de build e injeta no Vite
ARG API_KEY
ENV API_KEY=$API_KEY
ENV GEMINI_API_KEY=$API_KEY

RUN npm run build

# STAGE 2 — Serve
FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
