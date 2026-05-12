FROM node:18-alpine
WORKDIR /build 

# 1. Copy shared folder
COPY shared/ ./shared/

# 2. Copy CRM specific files and install
COPY services/crm/package*.json ./services/crm/
RUN cd services/crm && npm install --production

# 3. Copy CRM source code
COPY services/crm/ ./services/crm/

WORKDIR /build/services/crm
EXPOSE ${PORT}
CMD ["node", "src/app.js"]
