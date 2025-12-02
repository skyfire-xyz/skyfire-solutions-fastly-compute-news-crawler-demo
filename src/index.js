import { CacheOverride } from "fastly:cache-override";
import { SimpleCache } from 'fastly:cache';
import { importJWK, jwtVerify } from "jose";


async function getJWKSKeysArray(useCache) {
  if (useCache) {
    var cacheData = SimpleCache.get("jwks-endpoint");
    console.log("cacheData1", cacheData);
    if (cacheData) {
      console.log("using data from cache");
      return JSON.parse(await cacheData.text());
    }
  }

  console.log("fetching from skyfire ")
  const jwkResp = await fetch("/.well-known/jwks.json", {
    backend: "jwks_url",
    cacheOverride: new CacheOverride("pass"),
  });

  let jsonData = await jwkResp.json();
  SimpleCache.set("jwks-endpoint", JSON.stringify(jsonData), 60000)

  return jsonData;

}

function getKeyForKid(jwksData, kid) {

    const selectedJWK = jwksData.filter((key) => {
    console.log("kid",kid);
    console.log("key.kid",key.kid);
    console.log("typeof(kid)",typeof(kid));
    console.log("typeof(key.kid)",typeof(key.kid));
  return kid == key.kid
});
  console.log("selectedJWK", selectedJWK);

  return selectedJWK.length > 0 ? selectedJWK[0]:null;
}

async function handleRequest(event) {
  const req = event.request;
  console.log("version", 2)

  // pull token & normalize
  let token = req.headers.get("skyfire-pay-id");
  if (!token) return new Response("Missing token", { status: 401 });


  var jwkResp1 = await getJWKSKeysArray(true);

  console.log("jwkResp1", jwkResp1);
  console.log("stringified jwkResp1", JSON.stringify(jwkResp1));
  console.log("typeof(jwkResp1)", typeof jwkResp1);

  const jwkRespKeys = jwkResp1.keys;
  console.log("jwkRespKeys", jwkRespKeys);

  const base64HeaderUrl = token.split(".")[0];
  const base64Header = base64HeaderUrl.replace(/-/g, "+").replace(/_/g, "/"); // URL-safe Base64 conversion

  var decodedHeader1;
  try {
    // Decode using the built-in atob (for standard base64 string)
    decodedHeader1 = JSON.parse(atob(base64Header));
    console.log("JSON decodedHeader1", decodedHeader1);
    // return decodedHeader; // Returns the raw JSON string of the header
  } catch (e) {
    console.error("Failed to decode JWT header:", e);
    return new Response("Invalid token", { status: 403 });
  }

  var relevantKey = getKeyForKid(jwkRespKeys, decodedHeader1.kid);

  if (!relevantKey) {
      jwkResp1 = await getJWKSKeysArray(false);
      relevantKey = getKeyForKid(jwkResp1.keys, decodedHeader1.kid)
  }

  if(!relevantKey){
    console.log("invalid token")
     return new Response("Invalid token", { status: 403 });
  }


  const keyP = importJWK(relevantKey, "ES256");
  console.log("keyP", await keyP);

  // verify with clean 4xx handling
  let payload;
  try {
    ({ payload } = await jwtVerify(token, await keyP, {
      algorithms: ["ES256"],
    }));
  } catch (err) {
    const name = err?.code || err?.name || "JOSEError";
    console.log("JWT error:", name, err?.message);

    if (name === "ERR_JWS_INVALID") {
      //JWSInvalid
      return new Response("Invalid token format", { status: 400 });
    }
    if (name === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      //JWSSignatureVerificationFailed
      return new Response("Invalid token signature", { status: 401 });
    }
    if (name === "ERR_JWT_EXPIRED") {
      //JWTExpired
      return new Response("Token expired", { status: 401 });
    }
    if (name === "ERR_JWT_CLAIM_INVALID") {
      //JWTClaimInvalid
      return new Response("Invalid token claims", { status: 401 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("payload", JSON.stringify(payload));

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
