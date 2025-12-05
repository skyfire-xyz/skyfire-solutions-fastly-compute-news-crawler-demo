import { CacheOverride } from "fastly:cache-override";
import { SimpleCache } from 'fastly:cache';
import { importJWK, jwtVerify } from "jose";

// Fetch JWK either from JWKS URL or from cache if useCache is true
async function getJWKSKeysArray(useCache) {
  if (useCache) {
    // var cacheData = SimpleCache.get("jwks-endpoint");
    // // Using data from cache
    // if (cacheData) {
    //   return JSON.parse(await cacheData.text());
    // }
    const jwkResp = await fetch("/.well-known/jwks.json", {
      backend: "jwks_url",
      cacheOverride: new CacheOverride("override", {
      afterSend(res) {
        res.ttl = 1000;
        return { cache: true };
      },
    }), 
    });
    
    let jsonData = await jwkResp.json();
    return jsonData;
  
  }

  // Fetching from skyfire JWKS URL
  const jwkResp = await fetch("/.well-known/jwks.json", {
    backend: "jwks_url",
    cacheOverride: new CacheOverride("miss", {
      afterSend(res) {
        res.ttl = 1000;
        return { cache: true };
      },
    }), // skip default cache
  });

  let jsonData = await jwkResp.json();
  SimpleCache.set("jwks-endpoint", JSON.stringify(jsonData), 60000) // set in SimpleCache

  return jsonData;
}

// Select key with matching <kid> from multiple JWK keys
function getKeyForKid(jwksData, kid) {
  const selectedJWK = jwksData.filter((key) => {
    return kid == key.kid
  });

  return selectedJWK.length > 0 ? selectedJWK[0] : null;
}

async function handleRequest(event) {
  const req = event.request;

  // Extract token from request headers
  let token = req.headers.get("skyfire-pay-id");
  if (!token) return new Response("Missing token", { status: 401 });

  // Fetch JWK key
  var jwkRespData = await getJWKSKeysArray(true);
  const jwkRespKeys = jwkRespData.keys;

  // Decode header from token to select matching <kid> for signature verification
  const base64HeaderUrl = token.split(".")[0];
  const base64Header = base64HeaderUrl.replace(/-/g, "+").replace(/_/g, "/"); // URL-safe Base64 conversion

  var decodedHeader;
  try {
    // Decode using the built-in atob (for standard base64 string)
    decodedHeader = JSON.parse(atob(base64Header));
  } catch (e) {
    console.error("Failed to decode JWT header:", e);
    return new Response("Invalid token", { status: 403 });
  }

  // Pick a relevant key from a list of JWK keys
  var relevantKey = getKeyForKid(jwkRespKeys, decodedHeader.kid);

  // If relevant key not found yet, retrieve fresh response from JWKS URL by passing useCache false in getJWKSKeysArray method
  if (!relevantKey) {
    jwkRespData = await getJWKSKeysArray(false);
    relevantKey = getKeyForKid(jwkRespData.keys, decodedHeader.kid)
  }

  // If relevant key still not found, implies token is tampered
  if (!relevantKey) {
    return new Response("Invalid token", { status: 403 });
  }

  const keyP = importJWK(relevantKey, "ES256");

  // JWT verification logic here
  let payload;
  try {
    ({ payload } = await jwtVerify(token, await keyP, {
      algorithms: ["ES256"],
    }));
  } catch (err) {
    const name = err?.code || err?.name || "JOSEError";
    console.log("JWT error:", name, err?.message);

    if (name === "ERR_JWS_INVALID") {
      return new Response("Invalid token format", { status: 400 });
    }
    if (name === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      return new Response("Invalid token signature", { status: 401 });
    }
    if (name === "ERR_JWT_EXPIRED") {
      return new Response("Token expired", { status: 401 });
    }
    if (name === "ERR_JWT_CLAIM_INVALID") {
      return new Response("Invalid token claims", { status: 401 });
    }
    return new Response("Unauthorized", { status: 401 });
  }


  // Token verified, proceed with fetch to protected origin website
  const newReq = new Request(req, {
    headers: new Headers(req.headers),
  });

  const beresp = await fetch(newReq, {
    backend: "real_estate_protected_website",
  });

  const realEstateBody = await beresp.arrayBuffer();
  return new Response(realEstateBody, {
    status: beresp.status,
    statusText: beresp.statusText,
    headers: beresp.headers,
  });
}

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));