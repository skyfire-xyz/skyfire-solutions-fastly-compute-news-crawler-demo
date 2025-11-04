import * as jws from "jws";
import { KVStore } from "fastly:kv-store";
var validator = require("validator");

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

let skyfirePayIdVerificationRes = {
  isValid: true,
};

const isBotRequest = (req) => {
  console.log("req.headers.get(x-isbot)", req.headers.get("x-isbot"));
  return req.headers.get("x-isbot") === "true";
};

const SKYFIRE_SELLER_API_KEY = "6c0217fa-b746-4db1-9ab1-292203d9e8af"; //8987b55a-44f7-4f64-ab8e-1ff76663b03c

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

    console.log("data", data);
    console.log("typeof(data)", typeof data);

    if (data.code) {
      throw new Error(
        `Error while token charging: ${data.code} ${data.message}`
      );
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
async function verifySkyfirePayIdHeader(skyfireToken) {
  // Only verify & decode token if request is from a bot
  try {
    if (jws.verify(skyfireToken, "ES256", jwtSecret)) {
      const jwtPayload = JSON.parse(
        jws.decode(skyfireToken, "ES256", jwtSecret).payload
      );

      const jwtHeader = jws.decode(skyfireToken, "ES256", jwtSecret).header;

      if (!["kya+JWT", "kya+pay+JWT", "pay+JWT"].includes(jwtHeader.typ)) {
        console.error(`Validation failed: typ should be one of kya+JWT or pay+JWT or kya+pay+JWT`);
        return {
          isValid: false,
          errorMessage: "Validation failed: typ should be one of kya+JWT or pay+JWT or kya+pay+JWT",
          errorStatusCode: 401,
        };
      }

      // email should be correct format
      if (!validator.isEmail(String(jwtPayload.bid.skyfireEmail))) {
        console.error(`Validation failed: Invalid email format in 'bid.skyfireEmail' claim`);
        return {
          isValid: false,
          errorMessage: "Validation failed: Invalid email format in 'bid.skyfireEmail' claim",
          errorStatusCode: 401,
        };
      }
      
      // env should be qa
      if (jwtPayload.env !=="qa") {
        console.error(`Validation failed: Token is not from QA environment`);
        return {
          isValid: false,
          errorMessage: "Validation failed: Token is not from QA environment",
          errorStatusCode: 401,
        };
      }
      
      // jti should be a valid uuid
      if (!validator.isUUID(String(jwtPayload.jti))) {
        console.error(`Validation failed: Invalid token ID (jti)`);
        return {
          isValid: false,
          errorMessage: "Validation failed: Invalid token ID (jti)",
          errorStatusCode: 401,
        };
      }

      // sub should be a valid uuid
      if (!validator.isUUID(String(jwtPayload.sub))) {
        console.error(`Validation failed: Invalid subject (sub)`);
        return {
          isValid: false,
          errorMessage: "Validation failed: Invalid subject (sub)",
          errorStatusCode: 401,
        };
      }

      // aud should be a valid uuid
      if (!validator.isUUID(String(jwtPayload.aud))) {
        console.error(`Validation failed: Invalid audience (aud)`);
        return {
          isValid: false,
          errorMessage: "Validation failed: Invalid audience (aud)",
          errorStatusCode: 401,
        };
      }

       if (["kya+JWT", "kya+pay+JWT"].includes(jwtHeader.typ)) {
        // log buyer identity in KV store
        await new KVStore("first_KV_batch_charging").put(
          jwtPayload?.bid?.skyfireEmail,
          Date.now()
        );
      }

      if (["pay+JWT", "kya+pay+JWT"].includes(jwtHeader.typ)) {
        // charge token here
        try {
          let { amountCharged, remainingBalance } = await chargeToken(
            skyfireToken
          );
          console.log("amountCharged from token - ", amountCharged);
          console.log("remainingBalance from token - ", remainingBalance);
        } catch (err) {
          console.error("Error while charging token: ", err);
          return {
            isValid: false,
            errorMessage: "Payment Required: Error charging Token.",
            errorStatusCode: 402,
          };
        }
      }

      return {
        isValid: true,
        jwtPayload,
      };
    } else {
      return {
        isValid: false,
        errorMessage: "Something went wrong while verifying your JWT token",
        errorStatusCode: 401,
      };
    }
  } catch (err) {
    console.error("Error while verifying token: ", { err });
    return {
      isValid: false,
      errorMessage: "Something went wrong while verifying your JWT token",
      errorStatusCode: 401,
    };
  }
}

async function handleRequest(event) {
  const req = event.request;

  console.log("isBotRequest(req)", isBotRequest(req));

  if (isBotRequest(req)) {
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
      req.headers.get("skyfire-pay-id")
    );
    console.log("skyfirePayIdVerificationRes", skyfirePayIdVerificationRes);

    if (!skyfirePayIdVerificationRes.isValid) {
      return new Response(skyfirePayIdVerificationRes.errorMessage, {
        status: skyfirePayIdVerificationRes.errorStatusCode,
        statusText: skyfirePayIdVerificationRes.errorMessage,
        headers: {},
      });
    } else {
      //TODO: only for testing - remove later - start
      const bid = await new KVStore("first_KV_batch_charging").get(
        "supreet@skyfire.xyz"
      );
      console.log("buyer identity", await bid.text());
      //TODO: only for testing - remove later - end
    }
  }

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
