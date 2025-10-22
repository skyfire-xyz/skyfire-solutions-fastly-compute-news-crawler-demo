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

class UsageSessionManager {
  redisKey;
  perRequestAmount;
  maximumRequestCount;
  sessionDuration;
  batchAmountThreshold;
  redis;

  constructor(
    redisKey,
    perRequestAmount,
    maximumRequestCount,
    sessionDuration,
    batchAmountThreshold, 
    redis
  ) {
    this.redisKey = redisKey;
    this.perRequestAmount = perRequestAmount;
    this.maximumRequestCount = maximumRequestCount;
    this.sessionDuration = sessionDuration;
    this.batchAmountThreshold = batchAmountThreshold;
    this.redis = redis;
  }

  parseFloatSafe(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  async createNewSession(jwtToken) {
    const multi = this.redis.pipeline();
    multi.hset(this.redisKey, { jwtToken: jwtToken });
    multi.hset(this.redisKey, { count: "0" });
    multi.hset(this.redisKey, { accumulated: "0" });
    multi.hset(this.redisKey, { lastRequest: Date.now().toString() });
    multi.hset(this.redisKey, { remainingBalance: "0" });
    multi.expire(this.redisKey, this.sessionDuration);

    await multi.exec();

    // Track session expiry
    const expiryTime = Date.now() + this.sessionDuration * 1000;
    await trackSessionExpiry(this.redisKey, expiryTime, this.redis);
  }

  /**
   * Increments usage counters: count, accumulated amount, and sets last activity.
   * Returns the updated count, accumulated amount, and whether this is a new session.
   */
  async updateUsage(
    { skipAccumulation = false } // : { skipAccumulation? } = {} // : Promise<{ //   count?: number; //   accumulated?: number;
  ) //   isNewSession: boolean;
  // }>
  {
    // Check if this is a new session before incrementing
    const sessionExists = await this.sessionExists();

    const multi = this.redis.pipeline();
    multi.hincrby(this.redisKey, "count", 1);

    if (!skipAccumulation) {
      multi.hincrbyfloat(this.redisKey, "accumulated", this.perRequestAmount);
    }

    multi.hset(this.redisKey, { lastRequest: Date.now() });
    multi.expire(this.redisKey, this.sessionDuration);

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
        accumulated = await this.getAccumulatedAmount();
      }
    }

    // Update expiry tracking
    const expiryTime = Date.now() + this.sessionDuration * 1000;
    await trackSessionExpiry(this.redisKey, expiryTime, this.redis);

    return { count, accumulated, isNewSession: !sessionExists };
  }

  /**
   * Updates the remaining balance in Redis.
   */
  async updateRemainingBalance(newBalance) {
    await this.redis.hset(this.redisKey, { remainingBalance: newBalance });
  }

  /**
   * Resets the accumulated amount and count in Redis after a batch charge.
   */
  async resetAccumulated() {
    const multi = this.redis.pipeline();
    multi.hset(this.redisKey, { accumulated: "0" });
    await multi.exec();
  }

  /**
   * Gets the current remaining balance from Redis.
   */
  async getRemainingBalance() {
    try {
      const balance = await this.redis.hget(this.redisKey, "remainingBalance");
      return balance !== null ? Number(balance) : null;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error getting remaining balance:`
      );
      return null;
    }
  }

  /**
   * Gets the current request count from Redis.
   */
  async getRequestCount() {
    try {
      const count = await this.redis.hget(this.redisKey, "count");
      return count !== null ? Number(count) : 0;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error getting request count:`
      );
      return 0;
    }
  }

  /**
   * Gets the current accumulated amount from Redis.
   */
  async getAccumulatedAmount() {
    try {
      const accumulated = await this.redis.hget(this.redisKey, "accumulated");
      return accumulated !== null ? Number(accumulated) : 0;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error getting accumulated amount:`
      );
      return 0;
    }
  }
  /**
   * Checks if the session exists in Redis.
   */
  async sessionExists() {
    try {
      const exists = await this.redis.exists(this.redisKey);
      return exists === 1;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error checking if session exists:`
      );
      return false;
    }
  }

  /**
   * Checks if the request count has reached the maximum allowed requests.
   */
  async hasReachedMaximumRequestCount() {
    try {
      const count = await this.getRequestCount();
      return count >= this.maximumRequestCount;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error checking maximum request count:`
      );
      return false;
    }
  }

  /**
   * Checks if the remaining balance is insufficient for the next request.
   */
  async hasReachedRemainingBalance() {
    const balance = await this.getRemainingBalance();
    const accumulated = await this.getAccumulatedAmount();
    const requiredAmount = this.parseFloatSafe(
      this.perRequestAmount + accumulated
    );

    console.error(
      `[Session: ${this.redisKey}] hasReachedRemainingBalance: balance=${balance}, accumulated=${accumulated}, perRequestAmount=${this.perRequestAmount}, batchAmountThreshold=${this.batchAmountThreshold}`
    );

    return balance === null || balance === 0 || balance < requiredAmount;
  }

  /**
   * Checks if the accumulated amount has reached the batch threshold.
   */
  async hasReachedBatchThreshold() {
    try {
      const accumulated = await this.getAccumulatedAmount();
      return accumulated >= this.batchAmountThreshold;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error checking batch threshold:`
      );
      return false;
    }
  }

  /**
   * Gets the actual expiration timestamp (Unix timestamp in milliseconds)
   */
  async getSessionExpirationTimestamp() {
    try {
      const lastRequest = await this.redis.hget(this.redisKey, "lastRequest");
      if (!lastRequest) return null;

      const lastRequestTime = Number(lastRequest);
      const expirationTime = lastRequestTime + this.sessionDuration * 1000;
      return expirationTime;
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error getting session expiration timestamp:`
      );
      return null;
    }
  }

  /**
   * Gets the stored JWT token from the session
   */
  async getJWT() {
    try {
      const jwt = await this.redis.hget(this.redisKey, "jwtToken");
      return jwt;
    } catch (err) {
      console.error({ err }, `[Session: ${this.redisKey}] Error getting JWT:`);
      return null;
    }
  }

  /**
   * Stores session data in a stream before expiration for later retrieval
   */
  async storeSessionDataForExpiration() {
    try {
      const sessionData = await this.redis.hgetall(this.redisKey);
      if (sessionData && Object.keys(sessionData).length > 0) {
        // Store in a hash that doesn't expire (simpler than streams)
        const dataKey = `session_data:${this.redisKey}`;
        await this.redis.hset(dataKey, {
          session_id: this.redisKey,
          count: sessionData.count || "0",
          accumulated: sessionData.accumulated || "0",
          jwtToken: sessionData.jwtToken || "",
          remainingBalance: sessionData.remainingBalance || "0",
          updated_at: Date.now().toString(),
        });

        // Set expiration for the data key (cleanup after 1 hour)
        await this.redis.expire(dataKey, 3600);
      }
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error storing session data for expiration:`
      );
    }
  }

  /**
   * Manually delete session and remove from tracking
   */
  async deleteSession() {
    try {
      await this.redis.del(this.redisKey);
      await removeSessionFromTracking(this.redisKey);
      console.log(`[Session: ${this.redisKey}] Manually deleted session`);
    } catch (err) {
      console.error(
        { err },
        `[Session: ${this.redisKey}] Error deleting session:`
      );
    }
  }
}

async function usageTrack(skyfireToken, decodedSkyfireToken, redis) {
  const jwtPayload = decodedSkyfireToken.jwtPayload;

  console.log("skyfireToken in usageTrack", skyfireToken);
  console.log("jwtPayload in usageTrack", jwtPayload);
  // Read environment variables inside the function for test flexibility
  const batchAmountThreshold = 0.005; //Number(process.env.BATCH_AMOUNT_THRESHOLD) ||
  const sessionDurationSeconds = 300; //Number(process.env.REDIS_SESSION_EXPIRY) ||
  const overrideMaximumRequestCount = 10; // Number(process.env.OVERRIDE_MAXIMUM_REQUEST_COUNT);

  const redisKey = `session:${jwtPayload.jti}`;
  const perRequestAmount = 0.001; //Number(jwtPayload.spr) || 0;
  const maximumRequestCount =
    overrideMaximumRequestCount || Number(jwtPayload.mnr) || 1000; // For testing purpose override the maximum request count

  console.log({
    msg: `Threshold Config`,
    MNR: maximumRequestCount,
    SPR: perRequestAmount,
    MaxDuration: sessionDurationSeconds,
    BatchAmountThreshold: batchAmountThreshold,
  });

  // Initialize the usage session manager
  const manager = new UsageSessionManager(
    redisKey,
    perRequestAmount,
    maximumRequestCount,
    sessionDurationSeconds,
    batchAmountThreshold,
    redis
  );

  // If the session is new, charge the token first and get the remaining balance
  let initialCharge = false;
  let totalChargedAmount = 0;
  const sessionExists = await manager.sessionExists();
  if (!sessionExists) {
    console.log(`🆕 New session created for token: ${jwtPayload.jti}`);

    // Create a new session
    await manager.createNewSession(skyfireToken);

    try {
      const { remainingBalance } = await chargeToken(
        skyfireToken,
        perRequestAmount,
        jwtPayload.jti
      ); // Charge the token

      initialCharge = true;
      totalChargedAmount = perRequestAmount;

      // Reset accumulated amount
      await manager.resetAccumulated();
      await manager.updateRemainingBalance(remainingBalance);

      await logSession(
        jwtPayload,
        manager,
        `Initial charge: charged ${perRequestAmount}`
      );
    } catch (error) {
      console.error(
        `[Session: ${jwtPayload.jti}] Error charging token:`,
        error
      );
      // res.status(402).json({
      //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
      //   reason: "insufficient_balance",
      // });
      // return;
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
  }

  // Check if threashold is reached
  // 0. Ignore if the session is new and already charged.
  // 1. Is the  remaining balance is insufficient for the next request
  // 2. Is the request count has reached the maximum allowed requests
  const hasReachedRemainingBalance = await manager.hasReachedRemainingBalance();
  const hasReachedMaximumRequestCount =
    await manager.hasReachedMaximumRequestCount();

  if (
    sessionExists &&
    (hasReachedRemainingBalance || hasReachedMaximumRequestCount)
  ) {
    await logSession(
      jwtPayload,
      manager,
      `[Threshold reached] Error:402: hasReachedRemainingBalance=${hasReachedRemainingBalance} hasReachedMaximumRequestCount=${hasReachedMaximumRequestCount}`,
      "warn"
    );

    // Check if user owes any accumulated amount
    // Note: Leave this logic here to just make sure the user is charged for the accumulated amount.
    const accumulated = await manager.getAccumulatedAmount();

    // If there is an accumulated amount, charge the token before returning the response.
    if (accumulated > 0) {
      try {
        // Charge the token
        const { remainingBalance } = await chargeToken(
          skyfireToken,
          accumulated,
          jwtPayload.jti
        );
        // Reset accumulated amount
        await manager.resetAccumulated();
        await manager.updateRemainingBalance(remainingBalance);

        totalChargedAmount = accumulated;
      } catch (error) {
        console.error(
          `[Session: ${jwtPayload.jti}] Error charging token:`,
          error
        );
        // res.status(402).json({
        //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
        //   reason: "insufficient_balance",
        // });
        // return;
        return {
          isError: true,
          errorResponse: new Response(
            `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
            {
              status: 402,
              statusText: "insufficient_balance",
              headers: {},
            }
          ),
        };
      }
    }

    // 402 Payment Required: token usage exceeded. Blocked from returning the response.

    const hasCharges = totalChargedAmount > 0;
    let paymentHeaders = await makePaymentHeaders(manager, totalChargedAmount);

    console.log("paymentHeaders", paymentHeaders); // TODO: use paymentHeaders to add in headers
    // // Send request to backend (configured as 'origin_0')
    // const beresp = await fetch(newReq, {
    //   backend: "real_estate_protected_website",
    // });

    // const respBody = await beresp.arrayBuffer();

    // const mergedHeaders = new Headers(beresp.headers);

    // // Add payment headers
    // for (const [key, value] of Object.entries(paymentHeaders)) {
    //   mergedHeaders.set(key, value);
    // }

    // return new Response(respBody, {
    //   status: beresp.status,
    //   statusText: beresp.statusText,
    //   headers: mergedHeaders,
    // });

    if (hasReachedRemainingBalance) {
      // res.status(402).json({
      //   error: `Payment Required: token usage exceeded, please create a new token. Insufficient balance. ${
      //     hasCharges ? `Accumulated amount was charged.` : ""
      //   }`,
      //   reason: "insufficient_balance",
      // });
      // return;
      return {
        isError: true,
        errorResponse: new Response(
          `Payment Required: token usage exceeded, please create a new token. Insufficient balance. ${
            hasCharges ? `Accumulated amount was charged.` : ""
          }`,
          {
            status: 402,
            statusText: "insufficient_balance",
            headers: {},
          }
        ),
      };
    } else if (hasReachedMaximumRequestCount) {
      // res.status(402).json({
      //   error: `Payment Required: token usage exceeded, please create a new token. Maximum request count reached. ${
      //     hasCharges ? `Accumulated amount was charged.` : ""
      //   }`,
      //   reason: "batch_limit_reached",
      // });
      // return;
      return {
        isError: true,
        errorResponse: new Response(
          `Payment Required: token usage exceeded, please create a new token. Maximum request count reached. ${
            hasCharges ? `Accumulated amount was charged.` : ""
          }`,
          {
            status: 402,
            statusText: "batch_limit_reached",
            headers: {},
          }
        ),
      };
    }
  }

  // Update the usage session count, accumulated amount, and remaining balance.
  await manager.updateUsage({ skipAccumulation: initialCharge }); // Skip accumulation if it's already charged for the initial request.

  const hasReachedBatch = await manager.hasReachedBatchThreshold();
  if (hasReachedBatch) {
    // Handle batch threshold reached logic
    // e.g., charge the accumulated amount
    const accumulated = await manager.getAccumulatedAmount();
    if (accumulated && accumulated > 0) {
      try {
        // Charge accumulated amount
        const { remainingBalance } = await chargeToken(
          skyfireToken,
          accumulated,
          jwtPayload.jti
        );
        // Reset accumulated amount
        await manager.resetAccumulated();
        await manager.updateRemainingBalance(remainingBalance);

        totalChargedAmount = accumulated;
      } catch (error) {
        console.log(
          `[Session: ${jwtPayload.jti}] Error charging token:`,
          error
        );
        // res.status(402).json({
        //   error: `Payment Required: Error charging Token. Kya+pay token is depleted, please create a new token.`,
        //   reason: "insufficient_balance",
        // });
        // return;
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
    }

    await logSession(
      jwtPayload,
      manager,
      `Threashold reached: Batch amount threshold reached. We charged the accumulated amount.`
    );
  }

  // Store session data for expiration handling
  await manager.storeSessionDataForExpiration();

  // Add payment info to response headers
  let paymentHeaders = await makePaymentHeaders(manager, totalChargedAmount);
  console.log("paymentHeaders", paymentHeaders); // TODO: use paymentHeaders to add in headers

  await logSession(jwtPayload, manager);
  return {
    isError: false,
    paymentHeaders,
  };
}

/**
 * Creates payment headers for response
 */
async function makePaymentHeaders(manager, chargedAmount) {
  const [count, accumulated, remainingBalance, sessionExpiry] =
    await Promise.all([
      manager.getRequestCount(),
      manager.getAccumulatedAmount(),
      manager.getRemainingBalance(),
      manager.getSessionExpirationTimestamp(),
    ]);

  let paymentHeaders = {
    "X-Payment-Charged": chargedAmount?.toString() || "0",
    "X-Payment-Session-Count": count.toString(),
    "X-Payment-Session-Accumulated-Amount": accumulated.toString(),
    "X-Payment-Session-Remaining-Balance": remainingBalance?.toString() || "0",
    "X-Payment-Session-Token-MNR": manager.maximumRequestCount.toString(),
    "X-Payment-Session-Expires-At": sessionExpiry?.toString() || "0",
    "X-Payment-Session-Batch-Threshold":
      manager.batchAmountThreshold.toString(),
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

async function logSession(jwtPayload, manager, additionalInfo, level = "info") {
  const [count, accumulated, remainingBalance] = await Promise.all([
    manager.getRequestCount(),
    manager.getAccumulatedAmount(),
    manager.getRemainingBalance(),
  ]);

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

// Check for the custom header
async function verifySkyfirePayIdHeader(skyfireToken, redis) {
  // Only decode token if request is from a bot
  try {
    const { jwtPayload } = getDecodedJWT(skyfireToken);
    const data = await redis.hset(skyfireToken, {
      skyfireEmail: jwtPayload?.bid?.skyfireEmail,
    });
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
