FROM node:20-slim

WORKDIR /app

# Build tools required for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Token for installing @safigen/* packages from GitHub Packages.
# Set GITHUB_PACKAGES_TOKEN in the Railway service environment.
ARG GITHUB_PACKAGES_TOKEN

COPY package*.json .npmrc ./
RUN if [ -n "$GITHUB_PACKAGES_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=$GITHUB_PACKAGES_TOKEN" >> .npmrc; \
    fi \
 && npm install \
 && rm -f .npmrc

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
