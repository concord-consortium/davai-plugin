The files in this folder were generated with:
`docker run -ti --rm -v $(pwd):/mnt alpine/mkcert -cert-file /mnt/localhost.pem -key-file /mnt/localhost.key localhost 127.0.0.1 ::1`

The root certificate has not been saved, so the certificate in this folder cannot be used successfully by a normal webserver. 

This certificate is used when running Playwright in GitHub actions. Playwright is configured with `ignoreHTTPSErrors: true` so it isn't necessary for this certificate to be validated. 

You might think that running the dev server with our npm script `start:secure:no-certs` would work the same. However this approach doesn't work properly for some reason. 

It might be possible to avoid the `ignoreHTTPSErrors` setting but it adds complication. First the root certificate is required and its location must be supplied to nodeJS via: `export NODE_EXTRA_CA_CERTS="path/rootCA.pem"`. This is necessary so Playwright can verify the server has started up. Additionally this root certificate needs to be installed in the GitHub runner's trust store. This way the browsers that Playwright runs will trust the certificate. Running `mkcert` might be able to do this.

## Generating the certs
These self-signed localhost certs are NOT committed (no private keys in a public repo). Run `./gen-certs.sh` to create `localhost.key`/`localhost.pem` here and in `~/.localhost-ssl/` (used by the client dev server and the Playwright harness).
