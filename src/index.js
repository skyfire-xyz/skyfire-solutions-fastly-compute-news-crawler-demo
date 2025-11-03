import { jwtDecode } from "jwt-decode";
// import { UsageSessionManager } from "./services/usage-session-manager";
import { Redis } from "@upstash/redis/fastly";
import * as jws from "jws";

const batchAmountThreshold = 0.005; //Number(process.env.BATCH_AMOUNT_THRESHOLD) ||
const sessionDuration = 300; //Number(process.env.REDIS_SESSION_EXPIRY) ||
const maximumRequestCount = 10; // Number(process.env.OVERRIDE_MAXIMUM_REQUEST_COUNT);
const perRequestAmount = 0.001; //Number(jwtPayload.spr) || 0;

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

let skyfirePayIdVerificationRes = {
  isValid: true,
};

const isBotRequest = (req) => {
  console.log("req.headers.get(x-isbot)", req.headers.get("x-isbot"));
  return req.headers.get("x-isbot") === "true";
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

const EXPIRY_TRACKING_KEY = "session_expiries";
const MONITOR_INTERVAL = 30 * 1000; // Default 30 seconds //Number(process.env.EXPIRE_MONITOR_INTERVAL) ||

/**
 * Add a session to expiry tracking
 */
async function trackSessionExpiry(sessionKey, expiryTime, redis) {
  try {
    await redis.zadd(EXPIRY_TRACKING_KEY, {
      score: expiryTime,
      member: sessionKey,
    });
    console.log(
      `[Session: ${sessionKey}] Reset Expiry at ${new Date(expiryTime)})`
    );
  } catch (error) {
    console.error(
      { error },
      `[Session: ${sessionKey}] Error tracking session expiry:`
    );
  }
}

// class UsageSessionManager {
//   redisKey;
//   perRequestAmount;
//   maximumRequestCount;
//   sessionDuration;
//   batchAmountThreshold;
//   redis;

//   constructor(
//     redisKey,
//     perRequestAmount,
//     maximumRequestCount,
//     sessionDuration,
//     batchAmountThreshold,
//     redis
//   ) {
//     this.redisKey = redisKey;
//     this.perRequestAmount = perRequestAmount;
//     this.maximumRequestCount = maximumRequestCount;
//     this.sessionDuration = sessionDuration;
//     this.batchAmountThreshold = batchAmountThreshold;
//     this.redis = redis;
//   }

function parseFloatSafe(value) {
  return Math.round(value * 1000000) / 1000000;
}

async function createNewSession(jwtToken, redisKey, redis) {
  const multi = redis.pipeline();
  multi.hset(redisKey, { jwtToken: jwtToken });
  multi.hset(redisKey, { count: "0" });
  multi.hset(redisKey, { accumulated: "0" });
  multi.hset(redisKey, { lastRequest: Date.now().toString() });
  multi.hset(redisKey, { remainingBalance: "0" });
  multi.expire(redisKey, sessionDuration);

  await multi.exec();

  // Track session expiry
  const expiryTime = Date.now() + sessionDuration * 1000;
  await trackSessionExpiry(redisKey, expiryTime, redis);
}

/**
 * Increments usage counters: count, accumulated amount, and sets last activity.
 * Returns the updated count, accumulated amount, and whether this is a new session.
 */
async function updateUsage(
  { skipAccumulation = false },
  redisKey,
  redis // : { skipAccumulation? } = {} // : Promise<{ //   count?: number; //   accumulated?: number;
) {
  //   isNewSession: boolean;
  // }>
  // Check if this is a new session before incrementing
  const sessionExists = await sessionExistsChecker(redisKey, redis);

  const multi = redis.pipeline();
  multi.hincrby(redisKey, "count", 1);

  if (!skipAccumulation) {
    multi.hincrbyfloat(redisKey, "accumulated", perRequestAmount);
  }

  multi.hset(redisKey, { lastRequest: Date.now() });
  multi.expire(redisKey, sessionDuration);

  const execResult = await multi.exec();

  let count = undefined;
  let accumulated = undefined;

  if (execResult && Array.isArray(execResult)) {
    const countRes = execResult[0];
    if (Array.isArray(countRes) && typeof countRes[1] === "number") {
      count = countRes[1];
    }

    if (!skipAccumulation) {
      const accumulatedRes = execResult[1];
      if (
        Array.isArray(accumulatedRes) &&
        typeof accumulatedRes[1] === "string"
      ) {
        accumulated = Number(accumulatedRes[1]);
      }
    } else {
      // If skipping accumulation, get the current accumulated amount
      accumulated = await getAccumulatedAmount(redisKey, redis);
    }
  }

  // Update expiry tracking
  const expiryTime = Date.now() + sessionDuration * 1000;
  await trackSessionExpiry(redisKey, expiryTime, redis);

  return { count, accumulated, isNewSession: !sessionExists };
}

/**
 * Updates the remaining balance in Redis.
 */
async function updateRemainingBalance(newBalance, redisKey, redis) {
  await redis.hset(redisKey, { remainingBalance: newBalance });
}

/**
 * Resets the accumulated amount and count in Redis after a batch charge.
 */
async function resetAccumulated(skyfireToken, redis) {
  // const multi = redis.pipeline();
  await redis.hset(skyfireToken, { accumulated: "0" });
  // await multi.exec();
}

/**
 * Gets the current remaining balance from Redis.
 */
async function getRemainingBalance(redisKey, redis) {
  try {
    const balance = await redis.hget(redisKey, "remainingBalance");
    return balance !== null ? Number(balance) : null;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error getting remaining balance:`
    );
    return null;
  }
}

/**
 * Gets the current request count from Redis.
 */
async function getRequestCount(redisKey, redis) {
  try {
    const count = await redis.hget(redisKey, "count");
    return count !== null ? Number(count) : 0;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error getting request count:`
    );
    return 0;
  }
}

/**
 * Gets the current accumulated amount from Redis.
 */
async function getAccumulatedAmount(redisKey, redis) {
  try {
    const accumulated = await redis.hget(redisKey, "accumulated");
    return accumulated !== null ? Number(accumulated) : 0;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error getting accumulated amount:`
    );
    return 0;
  }
}
/**
 * Checks if the session exists in Redis.
 */
async function sessionExistsChecker(redisKey, redis) {
  try {
    const exists = await redis.exists(redisKey);
    return exists === 1;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error checking if session exists:`
    );
    return false;
  }
}

/**
 * Checks if the request count has reached the maximum allowed requests.
 */
async function hasReachedMaximumRequestCountChecker(redisKey, redis) {
  try {
    const count = await getRequestCount(redisKey, redis);
    return count >= maximumRequestCount;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error checking maximum request count:`
    );
    return false;
  }
}

/**
 * Checks if the remaining balance is insufficient for the next request.
 */
async function hasReachedRemainingBalanceChecker(redisKey, redis) {
  const balance = await getRemainingBalance(redisKey, redis);
  const accumulated = await getAccumulatedAmount(redisKey, redis);
  const requiredAmount = parseFloatSafe(perRequestAmount + accumulated);

  console.error(
    `[Session: ${redisKey}] hasReachedRemainingBalance: balance=${balance}, accumulated=${accumulated}, perRequestAmount=${perRequestAmount}, batchAmountThreshold=${batchAmountThreshold}`
  );

  return balance === null || balance === 0 || balance < requiredAmount;
}

/**
 * Checks if the accumulated amount has reached the batch threshold.
 */
async function hasReachedBatchThreshold(redisKey, redis) {
  try {
    const accumulated = await getAccumulatedAmount(redisKey, redis);
    return accumulated >= batchAmountThreshold;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error checking batch threshold:`
    );
    return false;
  }
}

/**
 * Gets the actual expiration timestamp (Unix timestamp in milliseconds)
 */
async function getSessionExpirationTimestamp(redisKey, redis) {
  try {
    const lastRequest = await redis.hget(redisKey, "lastRequest");
    if (!lastRequest) return null;

    const lastRequestTime = Number(lastRequest);
    const expirationTime = lastRequestTime + sessionDuration * 1000;
    return expirationTime;
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error getting session expiration timestamp:`
    );
    return null;
  }
}

/**
 * Gets the stored JWT token from the session
 */
async function getJWT(redisKey, redis) {
  try {
    const jwt = await redis.hget(redisKey, "jwtToken");
    return jwt;
  } catch (err) {
    console.error({ err }, `[Session: ${redisKey}] Error getting JWT:`);
    return null;
  }
}

/**
 * Stores session data in a stream before expiration for later retrieval
 */
async function storeSessionDataForExpiration(redisKey, redis) {
  try {
    const sessionData = await redis.hgetall(redisKey);
    if (sessionData && Object.keys(sessionData).length > 0) {
      // Store in a hash that doesn't expire (simpler than streams)
      const dataKey = `session_data:${redisKey}`;
      await redis.hset(dataKey, {
        session_id: redisKey,
        count: sessionData.count || "0",
        accumulated: sessionData.accumulated || "0",
        jwtToken: sessionData.jwtToken || "",
        remainingBalance: sessionData.remainingBalance || "0",
        updated_at: Date.now().toString(),
      });

      // Set expiration for the data key (cleanup after 1 hour)
      await redis.expire(dataKey, 3600);
    }
  } catch (err) {
    console.error(
      { err },
      `[Session: ${redisKey}] Error storing session data for expiration:`
    );
  }
}

/**
 * Manually delete session and remove from tracking
 */
async function deleteSession(redisKey, redis) {
  try {
    await redis.del(redisKey);
    await removeSessionFromTracking(redisKey);
    console.log(`[Session: ${redisKey}] Manually deleted session`);
  } catch (err) {
    console.error({ err }, `[Session: ${redisKey}] Error deleting session:`);
  }
}

async function usageTrack(skyfireToken, decodedSkyfireToken, redis) {
  const skyfireSession = await redis.hgetall(skyfireToken); // replace this with hgetall
  console.log("not skyfireSession.accumulated", !skyfireSession.accumulated);
  console.log("skyfireSession.accumulated", skyfireSession.accumulated);
  if (!("accumulated" in skyfireSession)) {
    console.log("in if");
    try {
      console.log("in if try");
      const { remainingBalance } = await chargeToken(
        skyfireToken,
        perRequestAmount
      ); // Charge the token
      console.log("remainingBalance1", remainingBalance);

      const multi = redis.pipeline();
      await multi.hset(skyfireToken, { accumulated: "0" });
      // set remaining balance also
      await multi.hset(skyfireToken, {
        remainingBalance: remainingBalance.toString(),
      });
      await multi.exec();

      return {
        isError: false,
        paymentHeaders: {
          // add X-accumulated: 0 and x-remaining
          "X-Payment-Session-Accumulated-Amount": "0",
          "X-Payment-Session-Remaining-Balance":
            remainingBalance?.toString() || "0",
        },
      };
      // Reset accumulated amount
      // await resetAccumulated(skyfireToken, redis);

      // await updateRemainingBalance(remainingBalance, redisKey, redis);

      // await logSession(redisKey, redis,
      //   jwtPayload,
      //   `Initial charge: charged ${perRequestAmount}`
      // );
    } catch (error) {
      console.log("in if catch");
      console.error(
        `[Session: ${jwtPayload.jti}] Error charging token:`,
        error
      );
      return {
        isError: true,
        errorResponse: new Response(
          "Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.",
          {
            status: 402,
            statusText: "insufficient_balance",
            headers: {},
          }
        ),
      };
    }
  } else {
    // if accumulated+pertokenCharge is >= remainingBalance
    console.log("in else");
    if (
      parseFloatSafe(Number(skyfireSession.accumulated) + perRequestAmount) >
      Number(skyfireSession.remainingBalance)
    ) {
      // charge accumulated amount
      console.log("in else if");
      const { remainingBalance } = await chargeToken(
        skyfireToken,
        skyfireSession.accumulated
      ); // Charge the token
      console.log("remainingBalance2", remainingBalance);

      // update accumulated to 0 and remaining( whatevery is from API)
      const multi = redis.pipeline();
      await multi.hset(skyfireToken, { accumulated: "0" });
      await multi.hset(skyfireToken, {
        remainingBalance: remainingBalance.toString(),
      });
      await multi.exec();

      // return error
      return {
        isError: true,
        errorResponse: new Response(
          `Payment Required: token usage exceeded, please create a new token. Insufficient balance. Accumulated amount was charged.`,
          {
            status: 402,
            statusText: "insufficient_balance",
            headers: {},
          }
        ),
      };
    } else {
      // else
      // update accumulated = accumulated + perTokenCharge
      console.log("in else else");
      await redis.hset(skyfireToken, {
        accumulated: parseFloatSafe(
          Number(skyfireSession.accumulated) + perRequestAmount
        ),
      });
      // return success with headers x-accumulated and x-remaining
      return {
        isError: false,
        paymentHeaders: {
          "X-Payment-Session-Accumulated-Amount": parseFloatSafe(
            Number(skyfireSession.accumulated) + perRequestAmount
          ),
          "X-Payment-Session-Remaining-Balance":
            skyfireSession.remainingBalance || "0",
        },
      };
    }
  }
}

// async function usageTrack(skyfireToken, decodedSkyfireToken, redis) {
//   const jwtPayload = decodedSkyfireToken.jwtPayload;

//   console.log("skyfireToken in usageTrack", skyfireToken);
//   console.log("jwtPayload in usageTrack", jwtPayload);
//   // Read environment variables inside the function for test flexibility
//   const batchAmountThreshold = 0.005; //Number(process.env.BATCH_AMOUNT_THRESHOLD) ||
//   const sessionDurationSeconds = 300; //Number(process.env.REDIS_SESSION_EXPIRY) ||
//   const overrideMaximumRequestCount = 10; // Number(process.env.OVERRIDE_MAXIMUM_REQUEST_COUNT);

//   const redisKey = `session:${jwtPayload.jti}`;
//   const perRequestAmount = 0.001; //Number(jwtPayload.spr) || 0;
//   const maximumRequestCount =
//     overrideMaximumRequestCount || Number(jwtPayload.mnr) || 1000; // For testing purpose override the maximum request count

//   console.log({
//     msg: `Threshold Config`,
//     MNR: maximumRequestCount,
//     SPR: perRequestAmount,
//     MaxDuration: sessionDurationSeconds,
//     BatchAmountThreshold: batchAmountThreshold,
//   });

//   // // Initialize the usage session manager
//   // const manager = new UsageSessionManager(
//   //   redisKey,
//   //   perRequestAmount,
//   //   maximumRequestCount,
//   //   sessionDurationSeconds,
//   //   batchAmountThreshold,
//   //   redis
//   // );

//   // If the session is new, charge the token first and get the remaining balance
//   let initialCharge = false;
//   let totalChargedAmount = 0;
//   const sessionExists = await sessionExistsChecker(redisKey, redis);
//   if (!sessionExists) {
//     console.log(`🆕 New session created for token: ${jwtPayload.jti}`);

//     // Create a new session
//     await createNewSession(skyfireToken, redisKey, redis);

//     try {
//       const { remainingBalance } = await chargeToken(
//         skyfireToken,
//         perRequestAmount,
//         jwtPayload.jti
//       ); // Charge the token

//       initialCharge = true;
//       totalChargedAmount = perRequestAmount;

//       // Reset accumulated amount
//       await resetAccumulated(redisKey, redis);
//       await updateRemainingBalance(remainingBalance, redisKey, redis);

//       await logSession(redisKey, redis,
//         jwtPayload,
//         `Initial charge: charged ${perRequestAmount}`
//       );
//     } catch (error) {
//       console.error(
//         `[Session: ${jwtPayload.jti}] Error charging token:`,
//         error
//       );
//       // res.status(402).json({
//       //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//       //   reason: "insufficient_balance",
//       // });
//       // return;
//       return {
//         isError: true,
//         errorResponse: new Response(
//           "Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.",
//           {
//             status: 402,
//             statusText: "insufficient_balance",
//             headers: {},
//           }
//         ),
//       };
//     }
//   }

//   // Check if threashold is reached
//   // 0. Ignore if the session is new and already charged.
//   // 1. Is the  remaining balance is insufficient for the next request
//   // 2. Is the request count has reached the maximum allowed requests
//   const hasReachedRemainingBalance = await hasReachedRemainingBalanceChecker(redisKey, redis);
//   const hasReachedMaximumRequestCount =
//     await hasReachedMaximumRequestCountChecker(redisKey, redis);

//   if (
//     sessionExists &&
//     (hasReachedRemainingBalance || hasReachedMaximumRequestCount)
//   ) {
//     await logSession(redisKey, redis,
//       jwtPayload,
//       `[Threshold reached] Error:402: hasReachedRemainingBalance=${hasReachedRemainingBalance} hasReachedMaximumRequestCount=${hasReachedMaximumRequestCount}`,
//       "warn"
//     );

//     // Check if user owes any accumulated amount
//     // Note: Leave this logic here to just make sure the user is charged for the accumulated amount.
//     const accumulated = await getAccumulatedAmount(redisKey, redis);

//     // If there is an accumulated amount, charge the token before returning the response.
//     if (accumulated > 0) {
//       try {
//         // Charge the token
//         const { remainingBalance } = await chargeToken(
//           skyfireToken,
//           accumulated,
//           jwtPayload.jti
//         );
//         // Reset accumulated amount
//         await resetAccumulated(redisKey, redis);
//         await updateRemainingBalance(remainingBalance, redisKey, redis);

//         totalChargedAmount = accumulated;
//       } catch (error) {
//         console.error(
//           `[Session: ${jwtPayload.jti}] Error charging token:`,
//           error
//         );
//         // res.status(402).json({
//         //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//         //   reason: "insufficient_balance",
//         // });
//         // return;
//         return {
//           isError: true,
//           errorResponse: new Response(
//             `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//             {
//               status: 402,
//               statusText: "insufficient_balance",
//               headers: {},
//             }
//           ),
//         };
//       }
//     }

//     // 402 Payment Required: token usage exceeded. Blocked from returning the response.

//     const hasCharges = totalChargedAmount > 0;
//     let paymentHeaders = await makePaymentHeaders(totalChargedAmount, redisKey, redis);

//     console.log("paymentHeaders", paymentHeaders); // TODO: use paymentHeaders to add in headers
//     // // Send request to backend (configured as 'origin_0')
//     // const beresp = await fetch(newReq, {
//     //   backend: "real_estate_protected_website",
//     // });

//     // const respBody = await beresp.arrayBuffer();

//     // const mergedHeaders = new Headers(beresp.headers);

//     // // Add payment headers
//     // for (const [key, value] of Object.entries(paymentHeaders)) {
//     //   mergedHeaders.set(key, value);
//     // }

//     // return new Response(respBody, {
//     //   status: beresp.status,
//     //   statusText: beresp.statusText,
//     //   headers: mergedHeaders,
//     // });

//     if (hasReachedRemainingBalance) {
//       // res.status(402).json({
//       //   error: `Payment Required: token usage exceeded, please create a new token. Insufficient balance. ${
//       //     hasCharges ? `Accumulated amount was charged.` : ""
//       //   }`,
//       //   reason: "insufficient_balance",
//       // });
//       // return;
//       return {
//         isError: true,
//         errorResponse: new Response(
//           `Payment Required: token usage exceeded, please create a new token. Insufficient balance. ${
//             hasCharges ? `Accumulated amount was charged.` : ""
//           }`,
//           {
//             status: 402,
//             statusText: "insufficient_balance",
//             headers: {},
//           }
//         ),
//       };
//     } else if (hasReachedMaximumRequestCount) {
//       // res.status(402).json({
//       //   error: `Payment Required: token usage exceeded, please create a new token. Maximum request count reached. ${
//       //     hasCharges ? `Accumulated amount was charged.` : ""
//       //   }`,
//       //   reason: "batch_limit_reached",
//       // });
//       // return;
//       return {
//         isError: true,
//         errorResponse: new Response(
//           `Payment Required: token usage exceeded, please create a new token. Maximum request count reached. ${
//             hasCharges ? `Accumulated amount was charged.` : ""
//           }`,
//           {
//             status: 402,
//             statusText: "batch_limit_reached",
//             headers: {},
//           }
//         ),
//       };
//     }
//   }

//   // Update the usage session count, accumulated amount, and remaining balance.
//   await updateUsage({ skipAccumulation: initialCharge }, redisKey, redis); // Skip accumulation if it's already charged for the initial request.

//   const hasReachedBatch = await hasReachedBatchThreshold(redisKey, redis);
//   if (hasReachedBatch) {
//     // Handle batch threshold reached logic
//     // e.g., charge the accumulated amount
//     const accumulated = await getAccumulatedAmount(redisKey, redis);
//     if (accumulated && accumulated > 0) {
//       try {
//         // Charge accumulated amount
//         const { remainingBalance } = await chargeToken(
//           skyfireToken,
//           accumulated,
//           jwtPayload.jti
//         );
//         // Reset accumulated amount
//         await resetAccumulated(redisKey, redis);
//         await updateRemainingBalance(remainingBalance, redisKey, redis);

//         totalChargedAmount = accumulated;
//       } catch (error) {
//         console.log(
//           `[Session: ${jwtPayload.jti}] Error charging token:`,
//           error
//         );
//         // res.status(402).json({
//         //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
//         //   reason: "insufficient_balance",
//         // });
//         // return;
//         return {
//           isError: true,
//           errorResponse: new Response(
//             "Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.",
//             {
//               status: 402,
//               statusText: "insufficient_balance",
//               headers: {},
//             }
//           ),
//         };
//       }
//     }

//     await logSession(redisKey, redis,
//       jwtPayload,

//       `Threashold reached: Batch amount threshold reached. We charged the accumulated amount.`
//     );
//   }

//   // Store session data for expiration handling
//   await storeSessionDataForExpiration(redisKey, redis);

//   // Add payment info to response headers
//   let paymentHeaders = await makePaymentHeaders(totalChargedAmount, redisKey, redis);
//   console.log("paymentHeaders", paymentHeaders); // TODO: use paymentHeaders to add in headers

//   await logSession(redisKey, redis, jwtPayload);
//   return {
//     isError: false,
//     paymentHeaders,
//   };
// }

/**
 * Creates payment headers for response
 */
async function makePaymentHeaders(chargedAmount, redisKey, redis) {
  const count = await getRequestCount(redisKey, redis);
  const accumulated = await getAccumulatedAmount(redisKey, redis);
  const remainingBalance = await getRemainingBalance(redisKey, redis);
  const sessionExpiry = await getSessionExpirationTimestamp(redisKey, redis);

  let paymentHeaders = {
    "X-Payment-Charged": chargedAmount?.toString() || "0",
    "X-Payment-Session-Count": count.toString(),
    "X-Payment-Session-Accumulated-Amount": accumulated.toString(),
    "X-Payment-Session-Remaining-Balance": remainingBalance?.toString() || "0",
    "X-Payment-Session-Token-MNR": maximumRequestCount.toString(),
    "X-Payment-Session-Expires-At": sessionExpiry?.toString() || "0",
    "X-Payment-Session-Batch-Threshold": batchAmountThreshold.toString(),
  };
  // res.setHeader("X-Payment-Charged", chargedAmount?.toString() || "0");
  // res.setHeader("X-Payment-Session-Count", count.toString());
  // res.setHeader("X-Payment-Session-Accumulated-Amount", accumulated.toString());
  // res.setHeader(
  //   "X-Payment-Session-Remaining-Balance",
  //   remainingBalance?.toString() || "0"
  // );
  // res.setHeader(
  //   "X-Payment-Session-Token-MNR",
  //   manager.maximumRequestCount.toString()
  // );
  // res.setHeader(
  //   "X-Payment-Session-Expires-At",
  //   sessionExpiry?.toString() || "0"
  // );
  // res.setHeader(
  //   "X-Payment-Session-Batch-Threshold",
  //   manager.batchAmountThreshold.toString()
  // );
  return paymentHeaders;
}

async function logSession(
  redisKey,
  redis,
  jwtPayload,
  additionalInfo,
  level = "info"
) {
  const count = await getRequestCount(redisKey, redis);
  const accumulated = await getAccumulatedAmount(redisKey, redis);
  const remainingBalance = await getRemainingBalance(redisKey, redis);

  const logData = {
    msg: "Session Summary",
    jti: jwtPayload.jti,
    count,
    accumulated,
    remainingBalance: remainingBalance?.toString() || "0",
  };

  if (level === "error") {
    console.error(logData, additionalInfo);
  } else if (level === "warn") {
    console.log(logData, additionalInfo);
  } else {
    console.log(logData, additionalInfo);
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
    console.log("in verifyPayIdHeader");
    console.log(
      "jws.decode(skyfireToken, ES256, jwtSecret)",
      jws.decode(skyfireToken, "ES256", jwtSecret)
    );
    console.log(
      "jws.decode(skyfireToken, ES256, jwtSecret).payload",
      jws.decode(skyfireToken, "ES256", jwtSecret).payload
    );
    console.log(
      "JSON.parse(jws.decode(skyfireToken, ES256, jwtSecret).payload)",
      JSON.parse(jws.decode(skyfireToken, "ES256", jwtSecret).payload)
    );
    console.log(
      "jws.decode(skyfireToken, ES256, jwtSecret).header",
      jws.decode(skyfireToken, "ES256", jwtSecret).header
    );
    console.log(
      "typeof(jws.decode(skyfireToken, ES256, jwtSecret).header)",
      typeof jws.decode(skyfireToken, "ES256", jwtSecret).header
    );

    console.log("jws.verify)", jws.verify(skyfireToken, "ES256", jwtSecret));

    if (jws.verify(skyfireToken, "ES256", jwtSecret)) {
      const jwtPayload = JSON.parse(
        jws.decode(skyfireToken, "ES256", jwtSecret).payload
      );
      console.log("jwtPayload1", jwtPayload);

      const jwtHeader = jws.decode(skyfireToken, "ES256", jwtSecret).header;
      console.log("jwtHeader1", jwtHeader);

      const data = await redis.hset(skyfireToken, {
        skyfireEmail: jwtPayload?.bid?.skyfireEmail,
      });
      console.log("data in redis", data);
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

  const redis = new Redis({
    url: "https://sure-seasnail-19324.upstash.io", //upstash url
    token: "AUt8AAIncDI3Y2E3YmI0NzQyZDY0OWUxYTNiMzZkMzQ4NjVhYjNmNHAyMTkzMjQ", // upstash token
    backend: "upstash",
  });
  // const data = await redis.incr("count");
  // // return new Response("View Count:" + data, { status: 200 });
  // console.log("View Count:" + data);

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

      let usageRes = await usageTrack(
        skyfireToken,
        getDecodedJWT(skyfireToken),
        redis
      );
      console.log("usageRes", usageRes);

      if (usageRes.isError) {
        return usageRes.errorResponse;
      }

      console.log("usaegRes paymentHeaders", usageRes.paymentHeaders);
      // Send request to backend (configured as 'origin_0')
      const beresp = await fetch(newReq, {
        backend: "real_estate_protected_website",
      });

      const respBody = await beresp.arrayBuffer();

      const mergedHeaders = new Headers(beresp.headers);

      // Add payment headers
      for (const [key, value] of Object.entries(usageRes.paymentHeaders)) {
        mergedHeaders.set(key, value);
      }

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
