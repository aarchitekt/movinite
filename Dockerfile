FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY index.html server.js ./
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
