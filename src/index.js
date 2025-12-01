import { CacheOverride } from "fastly:cache-override";
import { importJWK, jwtVerify } from "jose";

async function handleRequest(event) {
  const req = event.request;

  const jwkResp = await fetch("/.well-known/jwks.json", {
    backend: "jwks_url",
    cacheOverride: new CacheOverride("override", {
      afterSend(res) {
        res.ttl = 1000;
        return { cache: true };
      },
    }),
  });

  const jwkResp1 = await jwkResp.json();

  console.log("jwkResp1", jwkResp1);
  console.log("stringified jwkResp1", JSON.stringify(jwkResp1));
  console.log("typeof(jwkResp1)", typeof jwkResp1);

  const jwkRespKeys = jwkResp1.keys;
  console.log("jwkRespKeys", jwkRespKeys);

  const jwkRespKeys0 = jwkRespKeys[0];
  console.log("jwkRespKeys0", jwkRespKeys0);

  const keyP = importJWK(jwkRespKeys0, "ES256");
  console.log("keyP", await keyP);

  // pull token & normalize
  let token = req.headers.get("skyfire-pay-id");
  if (!token) return new Response("Missing token", { status: 401 });

  // verify with clean 4xx handling
  let payload;
  try {
    ({ payload } = await jwtVerify(token, await keyP, {
      algorithms: ["ES256"],
    }));
  } catch (err) {
    const name = err?.code || err?.name || "JOSEError";
    console.log("JWT error:", name, err?.message);

    if (name === "ERR_JWS_INVALID") { //JWSInvalid
      return new Response("Invalid token format", { status: 400 });
    }
    if (name === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") { //JWSSignatureVerificationFailed
      return new Response("Invalid token signature", { status: 401 });
    }
    if (name === "ERR_JWT_EXPIRED") { //JWTExpired
      return new Response("Token expired", { status: 401 });
    }
    if (name === "ERR_JWT_CLAIM_INVALID") { //JWTClaimInvalid
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
