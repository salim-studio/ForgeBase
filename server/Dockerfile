# Build from the forgebase/ root:  docker build -f server/Dockerfile -t forgebase .
FROM node:24-alpine
WORKDIR /srv/app
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev
COPY . .
ENV PORT=8080 SQLITE_PATH=/data/forgebase.db UPLOAD_DIR=/data/uploads
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server/server.js"]
