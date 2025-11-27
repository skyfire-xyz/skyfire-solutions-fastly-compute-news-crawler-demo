// import * as jwt from 'jsonwebtoken';
import { CacheOverride } from 'fastly:cache-override';
import { importJWK, jwtVerify } from 'jose';

// const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
// MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEN1pqyHAt02vpYLoiXSjZPvPjJwZV
// VNfI7YZvgsXBbPBISDhhMTSppRO6ts366lq1pYyNYQQZE0kvFThRVhptZw==
// -----END PUBLIC KEY-----`
// const JWK = {
//   kty: 'EC',
//   crv: 'P-256',
//   x: "N1pqyHAt02vpYLoiXSjZPvPjJwZVVNfI7YZvgsXBbPA",
//   y: "SEg4YTE0qaUTurbN-upataWMjWEEGRNJLxU4UVYabWc",
// };
// const keyP = importJWK(JWK, 'ES256');

async function handleRequest(event) {
  const req = event.request;

  const start = Date.now();
  console.log("start", start);

  // // pull token & normalize
  // let token = req.headers.get("skyfire-pay-id");
  // if (!token) return new Response("Missing token", { status: 401 });
  // if (token.startsWith("Bearer ")) token = token.slice(7).trim();

  // // verify with clean 4xx handling
  // let payload;
  // try {
  //   ({ payload } = await jwtVerify(token, await keyP, { algorithms: ['ES256'] }));
  // } catch (err) {
  //   const name = err?.code || err?.name || 'JOSEError';
  //   console.log('JWT error:', name, err?.message);

  //   if (name === 'JWSInvalid') {
  //     return new Response('Invalid token format', { status: 400 });
  //   }
  //   if (name === 'JWSSignatureVerificationFailed') {
  //     return new Response('Invalid token signature', { status: 401 });
  //   }
  //   if (name === 'JWTExpired') {
  //     return new Response('Token expired', { status: 401 });
  //   }
  //   if (name === 'JWTClaimInvalid') {
  //     return new Response('Invalid token claims', { status: 401 });
  //   }
  //   return new Response('Unauthorized', { status: 401 });
  // }

  // const end = Date.now();
  // console.log("end", start - end, end);
  // console.log("payload", JSON.stringify(payload));

  // const newReq = new Request(req, {
  //   headers: new Headers(req.headers),
  // });

  // const beresp = await fetch(newReq, {
  //   backend: "real_estate_protected_website",
  // });

  // const respBody = await beresp.arrayBuffer();
  // return new Response(respBody, {
  //   status: beresp.status,
  //   statusText: beresp.statusText,
  //   headers: beresp.headers,
  // });

  const jwkResp = await fetch("/.well-known/jwks.json", {
    backend: "jwks_url",
    cacheOverride: new CacheOverride("override", {ttl: 1000} )
  })

   const headers = new Headers(jwkResp.headers);
   headers.set("X-Compute-Fetched-At1", new Date(start).toISOString());

  const respBody = await jwkResp.arrayBuffer();
  return new Response(respBody, {
    status: jwkResp.status,
    statusText: jwkResp.statusText,
    headers, //: jwkResp.headers
  });
}

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));