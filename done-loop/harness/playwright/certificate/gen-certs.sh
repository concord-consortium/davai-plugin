#!/usr/bin/env bash
# Generate the self-signed localhost dev certs the client dev server + Playwright harness need.
# (Not committed — a private key must not live in a public repo.)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/localhost.key" -out "$DIR/localhost.pem" \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
# the client dev server (webpack start:secure) reads them from ~/.localhost-ssl/
mkdir -p ~/.localhost-ssl && cp "$DIR/localhost.key" "$DIR/localhost.pem" ~/.localhost-ssl/
echo "certs written to $DIR and ~/.localhost-ssl/"
