import { jwtDecode } from "jwt-decode";
import { KVStore } from "fastly:kv-store";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

let skyfirePayIdVerificationRes = {
  isValid: true,
};

const isJWT = (token) => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  try {
    const header = JSON.parse(atob(parts[0]));
    if (!header || !header.alg) {
      return false;
    }

    JSON.parse(atob(parts[1])); // Attempt payload decoding
  } catch {
    return false;
  }

  return true;
};

function isBotRequest(req) {
  console.log("req.headers.get(x-isbot)", req.headers.get("x-isbot"));
  return req.headers.get("x-isbot") === "true";
}

const getDecodedJWT = (token) => {
  console.log("token", token);
  console.log("isJWT(token)", isJWT(token));
  if (isJWT(token)) {
    const jwtHeader = jwtDecode(token, { header: true });
    const jwtPayload = jwtDecode(token);

    const jwtDecoded = { header: jwtHeader, payload: jwtPayload };
    console.log("jwtHeader", jwtHeader);
    console.log("jwtPayload", JSON.stringify(jwtPayload));
    console.log("jwtDecoded", jwtDecoded);

    return {
      isValid: true,
      jwtPayload,
    };
  } else {
    console.log({ err }, "Error while verifying token: ");

    return {
      isValid: false,
      errorMessage: "Something went wrong while verifying your JWT token",
      errorStatusCode: 401,
    };
  }
};

const SKYFIRE_SELLER_API_KEY = "6c0217fa-b746-4db1-9ab1-292203d9e8af";

async function chargeToken(skyfireToken, amountToCharge = "0.0001") {
  try {
    const newReq = new Request("https://api-qa.skyfire.xyz/api/v1/tokens/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "skyfire-api-key": SKYFIRE_SELLER_API_KEY,
      },
      body: JSON.stringify({
        token: skyfireToken,
        chargeAmount: `${amountToCharge}`,
      }),
    });

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

// Check for the custom header
async function verifySkyfirePayIdHeader(skyfireToken) {
  // Only decode token if request is from a bot
  try {
    const { jwtPayload } = getDecodedJWT(skyfireToken);
    await new KVStore("first_KV_batch_charging").put(
      jwtPayload?.bid?.skyfireEmail,
      Date.now()
    );
    return {
      isValid: true,
    };
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

  console.log("isBotRequest(req)", isBotRequest(req));

  if (isBotRequest(req)) {
    console.log("req2", req);
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
        "Missing Kya+pay token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a kya+pay token - https://docs.skyfire.xyz/reference/create-token.",
        {
          status: 402,
          statusText:
            "Missing Kya+pay token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a kya+pay token - https://docs.skyfire.xyz/reference/create-token.",
          headers: {},
        }
      );
    }

    skyfirePayIdVerificationRes = await verifySkyfirePayIdHeader(
      req.headers.get("skyfire-pay-id")
    );
    console.log("skyfirePayIdVerificationRes", skyfirePayIdVerificationRes);
  }

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

    let { amountCharged, remainingBalance } = await chargeToken(
      req.headers.get("skyfire-pay-id")
    );
    console.log("amountCharged from token - ", amountCharged);
    console.log("remainingBalance from token - ", remainingBalance);

    // Send request to backend (configured as 'origin_0')
    const beresp = await fetch(newReq, {
      backend: "real_estate_protected_website",
    });

    const bid = await new KVStore("first_KV_batch_charging").get(
      "supreet@skyfire.xyz"
    );
    console.log("buyer identity", await bid.text());

    const respBody = await beresp.arrayBuffer();
    return new Response(respBody, {
      status: beresp.status,
      statusText: beresp.statusText,
      headers: beresp.headers,
    });
  }
}
