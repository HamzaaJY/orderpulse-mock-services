FROM node:18-alpine
WORKDIR /app

# Recreate the exact path structure so ../../../ works
COPY shared/ ./shared/
COPY services/erp/package*.json ./services/erp/
RUN cd services/erp && npm install --production

COPY services/erp/ ./services/erp/

# Tell the container to start from the nested src
WORKDIR /app/services/erp
EXPOSE ${PORT}
CMD ["node", "src/app.js"]
