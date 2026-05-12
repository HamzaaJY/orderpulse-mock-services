FROM node:18-alpine
WORKDIR /build 

COPY shared/ ./shared/
COPY services/warehouse/package*.json ./services/warehouse/
RUN cd services/warehouse && npm install --production
COPY services/warehouse/ ./services/warehouse/

WORKDIR /build/services/warehouse
EXPOSE ${PORT}
CMD ["node", "src/app.js"]
