# Fastly Compute Application

The Fastly Compute platform is an advanced edge computing system that runs code on global edge network. Security and portability are provided by compiling code to WebAssembly and running it using Wasmtime.

## Setup instructions

Follow the steps [here](https://www.fastly.com/documentation/guides/compute/getting-started-with-compute/) to setup, create and deploy your first Fastly  Compute application.

## Sample Fastly Compute code

JWT verification logic to control access to protected website

Note: **createRemoteJWKSet** method from jose is not supported in Fastly Compute due to limitations. Hence, in lieu of createRemoteJWKSet method, the below code includes some custom logic to handle relevant key selection if there are multiple JWK keys, or to retrieve fresh response from JWKS URL in case a new key is added.

```
// src/index.js

import { CacheOverride } from "fastly:cache-override";
import { importJWK, jwtVerify, decodeProtectedHeader } from "jose";
var validator = require('validator');

// Fetch JWK either from JWKS URL or from cache if useCache is true
async function getJWKSKeysArray(useCache) {
  let jwkResp;
  if (useCache) {
    jwkResp = await fetch("/.well-known/jwks.json", {
      backend: "jwks_url",
      cacheOverride: new CacheOverride("override", {
        afterSend(res) {
          res.ttl = 1000;
          return { cache: true };
        },
      }),
    });
  } else {
    // Force fetching from skyfire JWKS URL
    jwkResp = await fetch("/.well-known/jwks.json", {
      backend: "jwks_url",
      cacheOverride: new CacheOverride("pass"), // skip default cache
    });
  }

  return await jwkResp.json();
}

// Select key with matching <kid> from multiple JWK keys
function getKeyForKid(jwksData, kid) {
  const selectedJWK = jwksData.filter((key) => {
    return kid == key.kid;
  });

  return selectedJWK.length > 0 ? selectedJWK[0] : null;
}

async function handleRequest(event) {
  const req = event.request;

  // Extract token from request headers
  let token = req.headers.get("skyfire-pay-id");
  if (!token)
    return new Response(
      JSON.stringify({
        error:
          "Missing KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );

  // Fetch JWK key
  var jwkRespData = await getJWKSKeysArray(true);
  const jwkRespKeys = jwkRespData.keys;

  // Decode header from token to select matching <kid> for signature verification
  let decodedHeader;
  try {
    // Decode using the built-in atob (for standard base64 string)
    decodedHeader = decodeProtectedHeader(token); //JSON.parse(atob(base64Header));
  } catch (e) {
    console.error("Failed to decode JWT header:", e);
    return new Response(
      JSON.stringify({
        error:
          "Invalid KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  // Pick a relevant key from a list of JWK keys
  var relevantKey = getKeyForKid(jwkRespKeys, decodedHeader.kid);

  // If relevant key not found yet, retrieve fresh response from JWKS URL by passing useCache false in getJWKSKeysArray method
  if (!relevantKey) {
    jwkRespData = await getJWKSKeysArray(false);
    relevantKey = getKeyForKid(jwkRespData.keys, decodedHeader.kid);

    // if matching key is found from latest JWKS URL response, purge cache
    if (relevantKey) {
      await fetch("/.well-known/jwks.json", {
        backend: "jwks_url",
        method: "PURGE",
      });
    } else {
      // If relevant key still not found, implies token is tampered
      return new Response(
        JSON.stringify({
          error:
            "Invalid KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }
  }

  const keyP = importJWK(relevantKey, "ES256");

  // JWT verification logic here
  try {
    ({ payload, protectedHeader } = await jwtVerify(token, await keyP, {
      algorithms: ["ES256"],
    }));

    if (!["kya+jwt", "kya+pay+jwt"].includes(protectedHeader.typ)) {
      console.log("Invalid typ:", protectedHeader.typ);
      return new Response(
        JSON.stringify({
          error: "Invalid typ - typ should be one of kya+jwt or kya+pay+jwt",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        }
      );
    }
  } catch (err) {
    const name = err?.code || err?.name || "JOSEError";
    console.log("JWT error:", name, err?.message);

    if (name === "ERR_JWS_INVALID") {
      return new Response(JSON.stringify({ error: "Invalid token format" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (name === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      return new Response(
        JSON.stringify({
          error:
            "Invalid KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
    if (name === "ERR_JWT_EXPIRED") {
      return new Response(
        JSON.stringify({
          error:
            "Invalid KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
    if (name === "ERR_JWT_CLAIM_INVALID") {
      return new Response(JSON.stringify({ error: "Invalid token claims" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // JWT successfully verified, now verify email
  const isEmailValid = validator.isEmail(payload.hid.email);

  if (!isEmailValid) {
    console.log("Invalid email format");
    return new Response(JSON.stringify({ error: "Invalid email format" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Validate env is 'production'
  if (payload.env !== "production") {
    console.log("Invalid environment:", payload.env);
    return new Response(
      JSON.stringify({ error: "Token is not from production environment" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Validate jti is a UUID
  if (!validator.isUUID(payload.jti)) {
    console.log("Invalid jti:", payload.jti);
    return new Response(
      JSON.stringify({ error: "Invalid token ID (jti) - not a valid UUID" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Validate sub is a UUID
  if (!validator.isUUID(payload.sub)) {
    console.log("Invalid sub:", payload.sub);
    return new Response(
      JSON.stringify({ error: "Invalid subject (sub) - not a valid UUID" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Validate aud is a UUID
  if (!validator.isUUID(payload.aud)) {
    console.log("Invalid aud:", payload.aud);
    return new Response(
      JSON.stringify({ error: "Invalid audience (aud) - not a valid UUID" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // Token verified, proceed with fetch to protected origin website
  const newReq = new Request(req, {
    headers: new Headers(req.headers),
  });

  const beresp = await fetch(newReq, {
    backend: "news_protected_website",
  });

  const newsBody = await beresp.arrayBuffer();
  return new Response(newsBody, {
    status: beresp.status,
    statusText: beresp.statusText,
    headers: beresp.headers,
  });
}

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
```

```
// fastly.toml

# This file describes a Fastly Compute package. To learn more visit:
# https://www.fastly.com/documentation/reference/compute/fastly-toml

authors = ["supreet@skyfire.xyz"]
description = "fastly-trial"
language = "javascript"
manifest_version = 3
name = "fiddle"
service_id = "6CHTeYtH3TTqPjWEgCRXSa"

[local_server]

  [local_server.backends]

    [local_server.backends.news_protected_website]
      override_host = "demo-mock-news.onrender.com"
      url = "https://demo-mock-news.onrender.com/"

    [local_server.backends.jwks_url]
      override_host = "app.skyfire.xyz"
      url = "https://app.skyfire.xyz/"

[scripts]
  build = "npx js-compute-runtime --enable-http-cache ./src/index.js ./bin/main.wasm"

```

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
