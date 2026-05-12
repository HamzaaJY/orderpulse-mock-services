FROM node:18-alpine

WORKDIR /app

# 1. Copy package files from the service folder to install dependencies
COPY services/erp/package*.json ./
RUN npm install --production

# 2. Copy the shared files from the root into the container's root
# Replace 'shared-file.js' with your actual shared filename
COPY shared-file.js ./

# 3. Copy the actual ERP source code
COPY services/erp/src ./src

# 4. Set the Port (Render will pass this automatically)
EXPOSE ${PORT}

# 5. Start the app
CMD ["node", "src/app.js"]
