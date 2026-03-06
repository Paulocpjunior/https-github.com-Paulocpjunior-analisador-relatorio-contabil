# Estágio de Build
FROM node:18-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Estágio de Produção
FROM node:18-slim
WORKDIR /app
# Instalamos o 'serve' para rodar o app React/Vite
RUN npm install -g serve
# Copiamos apenas a pasta dist gerada no build
COPY --from=build /app/dist ./dist
EXPOSE 8080
# O Cloud Run exige a porta 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
