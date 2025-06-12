# Exit on any error
set -e

echo "Step 1: Changing to server directory..."
cd "$(dirname "$0")"

echo "Step 2: Building TypeScript project..."
npm run build

echo "Cleaning old deploy folder if it exists..."
rm -rf deploy lambda.zip

echo "Step 3: Creating deployment folder..."
mkdir deploy
cp lambda.js deploy/
cp -r dist deploy/
cp -r node_modules deploy/
cp package.json deploy/

echo "Step 4: Creating deployment zip file..."
cd deploy
zip -r ../lambda.zip .

echo "Done! Deployment package created at lambda.zip"