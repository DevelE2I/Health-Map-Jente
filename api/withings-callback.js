import crypto from "node:crypto";

const API_ENDPOINT =
  "https://wbsapi.withings.net";

const REDIRECT_URI =
  "https://health-map-jente.vercel.app/api/withings-callback";

function createCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || "/"}`,
    `SameSite=${options.sameSite || "Lax"}`
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

function createSignature(params, clientSecret) {
  const values = [
    params.action,
    params.client_id
  ];

  if (params.nonce) {
    values.push(params.nonce);
  }

  if (params.timestamp) {
    values.push(params.timestamp);
  }

  return crypto
    .createHmac("sha256", clientSecret)
    .update(values.join(","))
    .digest("hex");
}

async function getNonce(
  clientId,
  clientSecret
) {
  const timestamp =
    Math.floor(Date.now() / 1000)
      .toString();

  const params = {
    action: "getnonce",
    client_id: clientId,
    timestamp
  };

  const signature =
    createSignature(
      params,
      clientSecret
    );

  const body =
    new URLSearchParams({
      ...params,
      signature
    });

  const response =
    await fetch(
      `${API_ENDPOINT}/v2/signature`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      }
    );

  const text =
    await response.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid nonce response: ${text}`
    );
  }

  if (
    !response.ok ||
    result?.status !== 0 ||
    !result?.body?.nonce
  ) {
    throw new Error(
      `Nonce request failed: ${JSON.stringify(result)}`
    );
  }

  return result.body.nonce;
}

async function exchangeAuthorizationCode({
  code,
  clientId,
  clientSecret
}) {
  const nonce =
    await getNonce(
      clientId,
      clientSecret
    );

  const signatureParams = {
    action: "requesttoken",
    client_id: clientId,
    nonce
  };

  const signature =
    createSignature(
      signatureParams,
      clientSecret
    );

  const body =
    new URLSearchParams({
      action: "requesttoken",
      client_id: clientId,
      grant_type:
        "authorization_code",
      code,
      redirect_uri:
        REDIRECT_URI,
      nonce,
      signature
    });

  const response =
    await fetch(
      `${API_ENDPOINT}/v2/oauth2`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      }
    );

  const text =
    await response.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid token response: ${text}`
    );
  }

  return {
    response,
    result
  };
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const code =
    String(req.query?.code || "");

  const returnedState =
    String(req.query?.state || "");

  const storedState =
    req.cookies
      ?.withings_oauth_state;

  if (req.query?.error) {
    return res.status(400).json({
      error:
        `Withings authorization failed: ${req.query.error}`
    });
  }

  if (!code) {
    return res.status(400).json({
      error:
        "Missing Withings authorization code."
    });
  }

  if (
    !returnedState ||
    !storedState ||
    returnedState !== storedState
  ) {
    return res.status(400).json({
      error:
        "Invalid Withings OAuth state."
    });
  }

  const clientId =
    process.env
      .WITHINGS_CLIENT_ID;

  const clientSecret =
    process.env
      .WITHINGS_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret
  ) {
    return res.status(500).json({
      error:
        "Withings server configuration is incomplete."
    });
  }

  try {
    const {
      response,
      result
    } =
      await exchangeAuthorizationCode({
        code,
        clientId,
        clientSecret
      });

    if (
      !response.ok ||
      result?.status !== 0 ||
      !result?.body?.access_token
    ) {
      console.error(
        "Withings token exchange failed",
        JSON.stringify(result)
      );

      return res.status(502).json({
        error:
          "Withings token exchange failed.",
        httpStatus:
          response.status,
        withingsStatus:
          result?.status ?? null,
        withingsError:
          result?.error ?? null,
        details:
          result
      });
    }

    const tokenData =
      result.body;

    const secure =
      process.env.NODE_ENV ===
      "production";

    res.setHeader(
      "Set-Cookie",
      [
        createCookie(
          "withings_access_token",
          tokenData.access_token,
          {
            httpOnly: true,
            secure,
            maxAge:
              tokenData.expires_in ||
              10800
          }
        ),

        createCookie(
          "withings_refresh_token",
          tokenData.refresh_token || "",
          {
            httpOnly: true,
            secure,
            maxAge:
              60 * 60 * 24 * 365
          }
        ),

        createCookie(
          "withings_user_id",
          String(
            tokenData.userid || ""
          ),
          {
            httpOnly: true,
            secure,
            maxAge:
              60 * 60 * 24 * 365
          }
        ),

        createCookie(
          "withings_oauth_state",
          "",
          {
            httpOnly: true,
            secure,
            maxAge: 0
          }
        )
      ]
    );

    return res.redirect(
      302,
      "/"
    );
  } catch (error) {
    console.error(
      "Unexpected Withings callback error",
      error
    );

    return res.status(500).json({
      error:
        "Unexpected Withings connection error.",
      details:
        error instanceof Error
          ? error.message
          : "Unknown error"
    });
  }
}
