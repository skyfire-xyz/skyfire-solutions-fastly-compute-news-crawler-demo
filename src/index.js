import * as jws from "jws";
import { KVStore } from "fastly:kv-store";

const sessionDuration = 300; //Number(process.env.REDIS_SESSION_EXPIRY) ||
const perRequestAmount = 0.001; //Number(jwtPayload.spr) || 0;

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

let skyfirePayIdVerificationRes = {
  isValid: true,
};

const isBotRequest = (req) => {
  console.log("req.headers.get(x-isbot)", req.headers.get("x-isbot"));
  return req.headers.get("x-isbot") === "true";
};

// const getDecodedJWT = (token) => {
//   console.log("token", token);
//   console.log("isJWT(token)", isJWT(token));
//   if (isJWT(token)) {
//     const jwtHeader = jwtDecode(token, { header: true });
//     const jwtPayload = jwtDecode(token);

//     const jwtDecoded = { header: jwtHeader, payload: jwtPayload };
//     console.log("jwtHeader", jwtHeader);
//     console.log("jwtPayload", JSON.stringify(jwtPayload));
//     console.log("jwtDecoded", jwtDecoded);

//     return {
//       isValid: true,
//       jwtPayload,
//     };
//   } else {
//     console.log({ err }, "Error while verifying token: ");

//     return {
//       isValid: false,
//       errorMessage: "Something went wrong while verifying your JWT token",
//       errorStatusCode: 401,
//     };
//   }
// };

const SKYFIRE_SELLER_API_KEY = "8987b55a-44f7-4f64-ab8e-1ff76663b03c"; //6c0217fa-b746-4db1-9ab1-292203d9e8af

async function chargeToken(skyfireToken, amountToCharge = "0.0001") {
  try {
    const newReq = new Request(
      "https://api-qa.skyfire.xyz/api/v1/tokens/charge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "skyfire-api-key": SKYFIRE_SELLER_API_KEY,
        },
        body: JSON.stringify({
          token: skyfireToken,
          chargeAmount: `${amountToCharge}`,
        }),
      }
    );

    const response = await fetch(newReq, {
      backend: "skyfire_be",
    });

    console.log("response", response);
    const data = await response.json();

    if (data.code === "PAYMENT_ERROR") {
      throw new Error(`Payment Error: ${data.code} ${data.message}`);
    }

    console.log({
      event: "token_charged",
      msg: "💸 Successfully charged token",
      data,
    });
    return data;
  } catch (err) {
    console.log({
      event: "token_charge_failed",
      error: err,
      msg: "💸 Error charging token",
    });
    throw err;
  }
}

const jwtSecret = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEN1pqyHAt02vpYLoiXSjZPvPjJwZV
VNfI7YZvgsXBbPBISDhhMTSppRO6ts366lq1pYyNYQQZE0kvFThRVhptZw==
-----END PUBLIC KEY-----`;
// Check for the custom header
async function verifySkyfirePayIdHeader(skyfireToken, redis) {
  // Only decode token if request is from a bot
  try {
    if (jws.verify(skyfireToken, "ES256", jwtSecret)) {
      const jwtPayload = JSON.parse(
        jws.decode(skyfireToken, "ES256", jwtSecret).payload
      );

      const jwtHeader = jws.decode(skyfireToken, "ES256", jwtSecret).header;

      if (jwtHeader.typ === "kya+pay+JWT") {
        await new KVStore("first_KV_batch_charging").put(
          jwtPayload?.bid?.skyfireEmail,
          Date.now()
        );
      }
      return {
        isValid: true,
      };
    } else {
      return {
        isValid: false,
        errorMessage: "Something went wrong while verifying your JWT token",
        errorStatusCode: 401,
      };
    }
    // const { jwtPayload } = getDecodedJWT(skyfireToken);
  } catch (err) {
    return {
      isValid: false,
      errorMessage: "Something went wrong while verifying your JWT token",
      errorStatusCode: 401,
    };
  }
}

async function handleRequest(event) {
  const req = event.request;

  // const redis = new Redis({
  //   url: "https://sure-seasnail-19324.upstash.io", //upstash url
  //   token: "AUt8AAIncDI3Y2E3YmI0NzQyZDY0OWUxYTNiMzZkMzQ4NjVhYjNmNHAyMTkzMjQ", // upstash token
  //   backend: "upstash",
  // });
  // const data = await redis.incr("count");
  // // return new Response("View Count:" + data, { status: 200 });
  // console.log("View Count:" + data);

  const store = new KVStore("first_KV_batch_charging");

  const firstresult = await store.get("first");
  console.log("firstresult", await firstresult.text());

  console.log("isBotRequest(req)", isBotRequest(req));

  if (isBotRequest(req)) {
    console.log(
      "req.headers.get(skyfire-pay-id)",
      req.headers.get("skyfire-pay-id")
    );

    console.log(
      "req.headers.get(skyfire-pay-id) === null",
      req.headers.get("skyfire-pay-id") === null
    );

    if (
      req.headers.get("skyfire-pay-id") === null ||
      req.headers.get("skyfire-pay-id") === "" ||
      req.headers.get("skyfire-pay-id") === undefined
    ) {
      return new Response(
        "Missing token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a kya, pay or kya+pay token - https://docs.skyfire.xyz/reference/create-token.",
        {
          status: 402,
          statusText:
            "Missing token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a kya, pay or kya+pay token - https://docs.skyfire.xyz/reference/create-token.",
          headers: {},
        }
      );
    }

    skyfirePayIdVerificationRes = await verifySkyfirePayIdHeader(
      req.headers.get("skyfire-pay-id"),
      redis
    );
    console.log("skyfirePayIdVerificationRes", skyfirePayIdVerificationRes);

    if (!skyfirePayIdVerificationRes.isValid) {
      return new Response(skyfirePayIdVerificationRes.errorMessage, {
        status: skyfirePayIdVerificationRes.errorStatusCode,
        statusText: skyfirePayIdVerificationRes.errorMessage,
        headers: {},
      });
    } else {
      const newReq = new Request(req, {
        headers: new Headers(req.headers),
      });
      let skyfireToken = req.headers.get("skyfire-pay-id");
      // let { amountCharged, remainingBalance } = await chargeToken(
      //   skyfireToken
      // );

      // console.log("amountCharged from token - ", amountCharged);
      // console.log("remainingBalance from token - ", remainingBalance);

      // let usageRes = await usageTrack(
      //   skyfireToken,
      //   getDecodedJWT(skyfireToken),
      //   redis
      // );
      // console.log("usageRes", usageRes);

      // if (usageRes.isError) {
      //   return usageRes.errorResponse;
      // }

      // console.log("usaegRes paymentHeaders", usageRes.paymentHeaders);
      // Send request to backend (configured as 'origin_0')
      const beresp = await fetch(newReq, {
        backend: "real_estate_protected_website",
      });

      const respBody = await beresp.arrayBuffer();

      const mergedHeaders = new Headers(beresp.headers);

      // Add payment headers
      // for (const [key, value] of Object.entries(usageRes.paymentHeaders)) {
      //   mergedHeaders.set(key, value);
      // }
       const bid = await new KVStore("first_KV_batch_charging").get(
      "supreet@skyfire.xyz"
    );
    console.log("buyer identity", await bid.text());

      return new Response(respBody, {
        status: beresp.status,
        statusText: beresp.statusText,
        headers: mergedHeaders,
      });
    }
  } else {
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
}
