# Fastly Compute Application

The Fastly Compute platform is an advanced edge computing system that runs code on global edge network. Security and portability are provided by compiling code to WebAssembly and running it using Wasmtime.

## Setup instructions

Follow the steps [here](https://www.fastly.com/documentation/guides/compute/getting-started-with-compute/) to setup, create and deploy your first Fastly  Compute application.

## Sample Fastly Compute code

JWT verification logic to control access to protected website

Note: **createRemoteJWKSet** method from jose is not supported in Fastly Compute due to limitations. Instead, the worker includes some custom logic to handle relevant key selection if there are multiple JWK keys, or to retrieve fresh response from JWKS URL in case a new key is added.

The worker is in [src/index.js](src/index.js) and its backends are in [fastly.toml](fastly.toml).

## Running the application

To build and run your new application in the local development environment, type the following command:

```shell
npm run build
npm run start
```

To build and deploy your application to your Fastly account, type the following command. The first time you deploy the application, you will be prompted to create a new service in your account.

```shell
fastly compute build
fastly compute deploy
```

The local server doesn't support Fastly's HTTP cache API, which the cached JWKS fetch uses, so requests that carry a token return 500 locally. Test token verification against a deployed service.
