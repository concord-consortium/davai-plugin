# DAVAI Server

This directory contains the Express-based server for the DAVAI plugin, deployed via AWS Lambda using `@vendia/serverless-express`.

## Development

To run the server locally, make sure you are in the `server` directory, run `npm install`, and then `npm start`.

## Deployment

Deployment involves manually uploading the zipped server files to AWS Lambda. This will likely change as we move forward with using LangChain.

## 🚀 Deployment Steps

### 1. Make sure you are in the server directory
### 2. Run `npm build`
### 3. Prepare the deployment folder
In the terminal, run the following commands:
- `mkdir deploy`
- `cp lambda.js deploy/`
- `cp -r dist deploy/`
- `cp -r node_modules deploy/`
- `cp package.json deploy/`
### 4. Create the deployment zip file
In the terminal, run the following commands:
- `cd deploy`
- `zip -r ../lambda.zip .`
### 5. Upload the zip to AWS Lambda
1. Go to the AWS Lambda Console
2. Select the Lambda function `davaiServer`
3. Under the "Code" section, choose "Upload from → .zip file"
4. Upload lambda.zip



