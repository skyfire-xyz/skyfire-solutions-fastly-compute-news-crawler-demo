import * as jws from "jws";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

const jwtSecret = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEN1pqyHAt02vpYLoiXSjZPvPjJwZV
VNfI7YZvgsXBbPBISDhhMTSppRO6ts366lq1pYyNYQQZE0kvFThRVhptZw==
-----END PUBLIC KEY-----`;

async function handleRequest(event) {
  const req = event.request;

    let start =  Date.now();
    console.log("start time", start)
    const verifyRes = jws.verify(req.headers.get("skyfire-pay-id"), "ES256", jwtSecret)
    let end = Date.now();
    console.log("end time", end-start, end)
    console.log("verifyRes", verifyRes);
  
  // Send request to backend (configured as 'origin_0')
  const newReq = new Request(req, {
    headers: new Headers(req.headers),
  });

  const beresp = await fetch(newReq, {
    backend: "real_estate_protected_website",
  });

  const respBody = await beresp.arrayBuffer();

  return new Response(respBody, {
    status: beresp.status,
    statusText: beresp.statusText,
    headers: beresp.headers,
  });
}
