FROM node:18-alpine

WORKDIR /app

# 1. Copy the shared folder from the project root
# This ensures shared/ utility files are available to the service
COPY shared/ ./shared/

# 2. Copy package files from the ERP service folder
COPY services/erp/package*.json ./
RUN npm install --production

# 3. Copy the ERP source code
COPY services/erp/ ./

# 4. Expose the port (Render uses the PORT env var)
EXPOSE ${PORT}

# 5. Start the application
CMD ["node", "src/app.js"]
