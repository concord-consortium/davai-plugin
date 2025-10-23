#!/bin/bash

echo "Setting up local development environment..."

# Start Docker services
echo "Starting Docker services..."
docker compose up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 5

# Check if PostgreSQL is ready
echo "Checking PostgreSQL connection..."
until docker exec postgres-local pg_isready -U postgres; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

echo "PostgreSQL is ready!"

# Check if ElasticMQ is ready
echo "Checking ElasticMQ connection..."
until curl -s http://localhost:9324 > /dev/null; do
  echo "Waiting for ElasticMQ..."
  sleep 2
done

echo "ElasticMQ is ready!"

# TODO: ElasticMQ is currently running but unused in local development.
# - Message handlers still send to SQS (LLM_JOB_QUEUE_URL).
# - Dev poller bypasses SQS and polls database directly.
# - Consider removing ElasticMQ from local dev. This may require modifying message handlers to skip SQS locally.

echo "Local development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Start SAM local API Gateway: npm run dev:server"
echo "2. In another terminal, start the job poller: npm run dev:poller"
echo "3. Start your client app"
echo ""
echo "To stop infrastructure: npm run dev:infra:down"
echo "To restart infrastructure: npm run dev:infra"
