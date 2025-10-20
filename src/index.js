
import { jwtDecode } from "jwt-decode";
// import { UsageSessionManager } from "./services/usage-session-manager";
import { Redis } from "@upstash/redis/fastly";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

let skyfirePayIdVerificationRes = {
  isValid: true,
};

const isBotRequest = (req) => {
  console.log("req.headers.get(x-isbot)", req.headers.get("x-isbot"));
  return req.headers.get("x-isbot") === "true";
}

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

// export default async function usageTrack(
//   req,
//   res,
// ) {
//   // Read environment variables inside the function for test flexibility
//   const batchAmountThreshold =
//     0.1; //Number(process.env.BATCH_AMOUNT_THRESHOLD) || 
//   const sessionDurationSeconds =
//     300; //Number(process.env.REDIS_SESSION_EXPIRY) || 
//   // const overrideMaximumRequestCount = Number(
//   //   process.env.OVERRIDE_MAXIMUM_REQUEST_COUNT
//   // );

//   // Only process authenticated bot requests
//   // if (!isBotRequest(req) || !getDecodedJWT(req)) {
//   //   next();
//   //   return;
//   // }

//   const jwtPayload = req.decodedJWT;
//   const redisKey = `session:${jwtPayload.jti}`;
//   const perRequestAmount = Number(jwtPayload.spr) || 0;
//   const maximumRequestCount =
//     overrideMaximumRequestCount || Number(jwtPayload.mnr) || 1000; // For testing purpose override the maximum request count

//   logger.info({
//     msg: `Threshold Config`,
//     MNR: maximumRequestCount,
//     SPR: perRequestAmount,
//     MaxDuration: sessionDurationSeconds,
//     BatchAmountThreshold: batchAmountThreshold,
//   });

//   // Initialize the usage session manager
//   const manager = new UsageSessionManager(
//     redisKey,
//     perRequestAmount,
//     maximumRequestCount,
//     sessionDurationSeconds,
//     batchAmountThreshold
//   );

//   // If the session is new, charge the token first and get the remaining balance
//   let initialCharge = false;
//   let totalChargedAmount = 0;
//   const sessionExists = await manager.sessionExists();
//   if (!sessionExists) {
//     logger.info(`🆕 New session created for token: ${jwtPayload.jti}`);

//     // Create a new session
//     await manager.createNewSession(req.skyfireToken);

//     try {
//       const { remainingBalance } = await chargeToken(
//         req.skyfireToken,
//         perRequestAmount,
//         jwtPayload.jti
//       ); // Charge the token

//       initialCharge = true;
//       totalChargedAmount = perRequestAmount;

//       // Reset accumulated amount
//       await manager.resetAccumulated();
//       await manager.updateRemainingBalance(remainingBalance);

//       await logSession(
//         jwtPayload,
//         manager,
//         `Initial charge: charged ${perRequestAmount}`
//       );
//     } catch (error) {
//       logger.error(`[Session: ${jwtPayload.jti}] Error charging token:`, error);
//       res.status(402).json({
//         error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//         reason: "insufficient_balance",
//       });
//       return;
//     }
//   }

//   // Check if threashold is reached
//   // 0. Ignore if the session is new and already charged.
//   // 1. Is the  remaining balance is insufficient for the next request
//   // 2. Is the request count has reached the maximum allowed requests
//   const hasReachedRemainingBalance = await manager.hasReachedRemainingBalance();
//   const hasReachedMaximumRequestCount =
//     await manager.hasReachedMaximumRequestCount();

//   if (
//     sessionExists &&
//     (hasReachedRemainingBalance || hasReachedMaximumRequestCount)
//   ) {
//     await logSession(
//       jwtPayload,
//       manager,
//       `[Threshold reached] Error:402: hasReachedRemainingBalance=${hasReachedRemainingBalance} hasReachedMaximumRequestCount=${hasReachedMaximumRequestCount}`,
//       "warn"
//     );

//     // Check if user owes any accumulated amount
//     // Note: Leave this logic here to just make sure the user is charged for the accumulated amount.
//     const accumulated = await manager.getAccumulatedAmount();

//     // If there is an accumulated amount, charge the token before returning the response.
//     if (accumulated > 0) {
//       try {
//         // Charge the token
//         const { remainingBalance } = await chargeToken(
//           req.skyfireToken,
//           accumulated,
//           jwtPayload.jti
//         );
//         // Reset accumulated amount
//         await manager.resetAccumulated();
//         await manager.updateRemainingBalance(remainingBalance);

//         totalChargedAmount = accumulated;
//       } catch (error) {
//         logger.error(
//           `[Session: ${jwtPayload.jti}] Error charging token:`,
//           error
//         );
//         res.status(402).json({
//           error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//           reason: "insufficient_balance",
//         });
//         return;
//       }
//     }

//     // 402 Payment Required: token usage exceeded. Blocked from returning the response.

//     const hasCharges = totalChargedAmount > 0;
//     await makePaymentHeaders(res, manager, totalChargedAmount);

//     if (hasReachedRemainingBalance) {
//       res.status(402).json({
//         error: `Payment Required: token usage exceeded, please create a new token. Insufficient balance. ${
//           hasCharges ? `Accumulated amount was charged.` : ""
//         }`,
//         reason: "insufficient_balance",
//       });
//       return;
//     } else if (hasReachedMaximumRequestCount) {
//       res.status(402).json({
//         error: `Payment Required: token usage exceeded, please create a new token. Maximum request count reached. ${
//           hasCharges ? `Accumulated amount was charged.` : ""
//         }`,
//         reason: "batch_limit_reached",
//       });
//       return;
//     }
//   }

//   // Update the usage session count, accumulated amount, and remaining balance.
//   await manager.updateUsage({ skipAccumulation: initialCharge }); // Skip accumulation if it's already charged for the initial request.

//   const hasReachedBatch = await manager.hasReachedBatchThreshold();
//   if (hasReachedBatch) {
//     // Handle batch threshold reached logic
//     // e.g., charge the accumulated amount
//     const accumulated = await manager.getAccumulatedAmount();
//     if (accumulated && accumulated > 0) {
//       try {
//         // Charge accumulated amount
//         const { remainingBalance } = await chargeToken(
//           req.skyfireToken,
//           accumulated,
//           jwtPayload.jti
//         );
//         // Reset accumulated amount
//         await manager.resetAccumulated();
//         await manager.updateRemainingBalance(remainingBalance);

//         totalChargedAmount = accumulated;
//       } catch (error) {
//         logger.warn(
//           `[Session: ${jwtPayload.jti}] Error charging token:`,
//           error
//         );
//         res.status(402).json({
//           error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//           reason: "insufficient_balance",
//         });
//         return;
//       }
//     }

//     await logSession(
//       jwtPayload,
//       manager,
//       `Threashold reached: Batch amount threshold reached. We charged the accumulated amount.`
//     );
//   }

//   // Store session data for expiration handling
//   await manager.storeSessionDataForExpiration();

//   // Add payment info to response headers
//   await makePaymentHeaders(res, manager, totalChargedAmount);

//   await logSession(jwtPayload, manager);

//   next();
// }

const SKYFIRE_SELLER_API_KEY = "6c0217fa-b746-4db1-9ab1-292203d9e8af";

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

// Check for the custom header
async function verifySkyfirePayIdHeader(skyfireToken) {
  // Only decode token if request is from a bot
  try {
    const { jwtPayload } = getDecodedJWT(skyfireToken);
    const redis = new Redis({
    url: "https://sure-seasnail-19324.upstash.io", //upstash url
    token: "AUt8AAIncDI3Y2E3YmI0NzQyZDY0OWUxYTNiMzZkMzQ4NjVhYjNmNHAyMTkzMjQ", // upstash token
    backend: "upstash",
  });
    const data = await redis.set(skyfireToken, {"skyfireEmail": jwtPayload?.bid?.skyfireEmail});
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

  const redis = new Redis({
    url: "https://sure-seasnail-19324.upstash.io", //upstash url
    token: "AUt8AAIncDI3Y2E3YmI0NzQyZDY0OWUxYTNiMzZkMzQ4NjVhYjNmNHAyMTkzMjQ", // upstash token
    backend: "upstash",
  });
  const data = await redis.incr("count");
  // return new Response("View Count:" + data, { status: 200 });
  console.log("View Count:" + data);

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

    const respBody = await beresp.arrayBuffer();
    return new Response(respBody, {
      status: beresp.status,
      statusText: beresp.statusText,
      headers: beresp.headers,
    });
  }
}
