#!/bin/bash

echo "🚀 Starting local development infrastructure..."

# Start Docker services
echo "📦 Starting Docker services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if PostgreSQL is ready
echo "🔍 Checking PostgreSQL connection..."
until docker exec postgres-local pg_isready -U postgres; do
  echo "⏳ Waiting for PostgreSQL..."
  sleep 2
done

echo "✅ PostgreSQL is ready!"

# Check if ElasticMQ is ready
echo "🔍 Checking ElasticMQ connection..."
until curl -s http://localhost:9324 > /dev/null; do
  echo "⏳ Waiting for ElasticMQ..."
  sleep 2
done

echo "✅ ElasticMQ is ready!"

# Generate environment file
echo "🔧 Generating environment configuration..."
npm run dev:env

# Run database setup
echo "🗄️ Setting up database..."
npm run setup:local

echo "🎉 Local infrastructure is ready!"
echo ""
echo "Next steps:"
echo "1. Start SAM local API Gateway: npm run dev:server"
echo "2. In another terminal, start your client app"
echo ""
echo "To stop infrastructure: npm run dev:infra:down"
