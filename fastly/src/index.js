import { CacheOverride } from "fastly:cache-override";
import { purgeSurrogateKey } from "fastly:compute";
import { importJWK, jwtVerify, decodeProtectedHeader } from "jose";
import validator from "validator";

const JWKS_SURROGATE_KEY = "skyfire-jwks";

const JWKS_UNAVAILABLE = "JWKS_UNAVAILABLE";

// badBody marks a 200 response that couldn't be used, the only kind the cache can hold
function jwksUnavailable(reason, badBody = false) {
  const error = new Error(`JWKS unavailable: ${reason}`);
  error.code = JWKS_UNAVAILABLE;
  error.badBody = badBody;

  return error;
}

function purgeCachedJWKS() {
  try {
    purgeSurrogateKey(JWKS_SURROGATE_KEY);
  } catch (error) {
    console.error("Failed to purge cached JWKS:", error);
  }
}

// Fetch JWK either from JWKS URL or from cache if useCache is true
async function getJWKSKeysArray(useCache) {
  const cacheOverride = useCache
    ? new CacheOverride("override", {
        afterSend(res) {
          res.ttl = 1000;
          res.surrogateKeys = [JWKS_SURROGATE_KEY];

          return { cache: res.ok };
        },
      })
    : new CacheOverride("pass");

  let jwkResp;
  try {
    jwkResp = await fetch("/.well-known/jwks.json", {
      backend: "jwks_url",
      cacheOverride,
    });
  } catch (error) {
    throw jwksUnavailable(`request failed: ${error.message}`);
  }

  if (!jwkResp.ok) {
    throw jwksUnavailable(`status ${jwkResp.status}`);
  }

  let jwks;
  try {
    jwks = await jwkResp.json();
  } catch {
    throw jwksUnavailable("response is not JSON", true);
  }

  if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) {
    throw jwksUnavailable("response has no keys", true);
  }

  return jwks.keys;
}

function isUUID(value) {
  return typeof value === "string" && validator.isUUID(value);
}

function invalidTokenResponse() {
  return new Response(
    JSON.stringify({
      error:
        "Invalid KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

// Select key with matching <kid> from multiple JWK keys
function getKeyForKid(keys, kid) {
  return keys.find((key) => key.kid === kid);
}

async function handleRequest(event) {
  const req = event.request;

  // Extract token from request headers
  const token = req.headers.get("skyfire-pay-id");
  if (!token) {
    return new Response(
      JSON.stringify({
        error:
          "Missing KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.",
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  // Decode header from token to select matching <kid> for signature verification
  let decodedHeader;
  try {
    decodedHeader = decodeProtectedHeader(token);
  } catch (error) {
    console.error("Failed to decode JWT header:", error);

    return invalidTokenResponse();
  }

  if (typeof decodedHeader.kid !== "string") {
    console.error("JWT header has no kid");

    return invalidTokenResponse();
  }

  // Pick a relevant key from a list of JWK keys. A cached 200 with a bad body
  // is evicted so the fresh fetch below can replace it.
  let cachedKeys = [];
  try {
    cachedKeys = await getJWKSKeysArray(true);
  } catch (error) {
    if (!error.badBody) {
      throw error;
    }

    console.error("Cached JWKS unusable, refetching:", error.message);
    purgeCachedJWKS();
  }

  let relevantKey = getKeyForKid(cachedKeys, decodedHeader.kid);

  // If relevant key not found yet, retrieve fresh response from JWKS URL by passing useCache false in getJWKSKeysArray method
  if (!relevantKey) {
    const freshKeys = await getJWKSKeysArray(false);
    relevantKey = getKeyForKid(freshKeys, decodedHeader.kid);

    // If relevant key still not found, implies token is tampered
    if (!relevantKey) {
      return invalidTokenResponse();
    }

    purgeCachedJWKS();
  }

  const keyP = importJWK(relevantKey, "ES256");

  // JWT verification logic here
  let payload;
  let protectedHeader;
  try {
    ({ payload, protectedHeader } = await jwtVerify(token, await keyP, {
      algorithms: ["ES256"],
    }));

    if (!["kya+jwt", "kya-pay+jwt"].includes(protectedHeader.typ)) {
      console.log("Invalid typ:", protectedHeader.typ);
      return new Response(
        JSON.stringify({
          error: "Invalid typ - typ should be one of kya+jwt or kya-pay+jwt",
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
  const email = payload.hid?.email;
  const isEmailValid = typeof email === "string" && validator.isEmail(email);

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
  if (!isUUID(payload.jti)) {
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
  if (!isUUID(payload.sub)) {
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
  if (!isUUID(payload.aud)) {
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

async function respond(event) {
  try {
    return await handleRequest(event);
  } catch (error) {
    console.error("Request failed:", error);
    const unavailable = error?.code === JWKS_UNAVAILABLE;

    return new Response(
      JSON.stringify({
        error: unavailable ? "Token verification unavailable" : "Internal error",
      }),
      {
        status: unavailable ? 503 : 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

addEventListener("fetch", (event) => event.respondWith(respond(event)));
