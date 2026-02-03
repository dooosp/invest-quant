FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY python/requirements.txt ./python/
RUN python3 -m venv /app/python/.venv && \
    /app/python/.venv/bin/pip install --no-cache-dir -r python/requirements.txt

COPY . .

RUN mkdir -p data/fundamentals data/historical data/backtest-results data/risk-snapshots

CMD ["node", "server.js"]
