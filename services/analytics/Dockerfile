FROM node:18-alpine
WORKDIR /build 

# 1. Copy the shared folder first
COPY shared/ ./shared/

# 2. Setup the Analytics directory structure
COPY services/analytics/package*.json ./services/analytics/
RUN cd services/analytics && npm install --production

# 3. Copy Analytics source code
COPY services/analytics/ ./services/analytics/

# 4. Set the workdir to the actual service folder
WORKDIR /build/services/analytics

EXPOSE ${PORT}

# Start the service
CMD ["node", "src/app.js"]
