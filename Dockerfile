# retrieval-svc container (used from Phase 1 on; Phase 0 dev runs `npm run serve` on the host)
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY data ./data
ENV PORT=8090
EXPOSE 8090
CMD ["node", "src/service/server.js"]
