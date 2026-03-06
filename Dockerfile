FROM node:18-slim
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante dos arquivos do projeto
COPY . .

# Constrói o app React/Vite para produção
RUN npm run build

# Instala um servidor leve para entregar os arquivos estáticos
RUN npm install -g serve

# O Cloud Run usa a porta 8080 por padrão
EXPOSE 8080

# Comando para iniciar o servidor
CMD ["serve", "-s", "dist", "-l", "8080"]
