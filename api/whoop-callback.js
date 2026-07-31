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

export default async function handler(req, res) {
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
    req.cookies?.withings_oauth_state;

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
    process.env.WITHINGS_CLIENT_ID;

  const clientSecret =
    process.env.WITHINGS_CLIENT_SECRET;

  const redirectUri =
    "https://health-map-jente.vercel.app/api/withings-callback";

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error:
        "Withings server configuration is incomplete."
    });
  }

  try {
    const body =
      new URLSearchParams({
        action: "requesttoken",
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      });

    const tokenResponse =
      await fetch(
        "https://wbsapi.withings.net/v2/oauth2",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",

            Accept:
              "application/json"
          },

          body
        }
      );

    let tokenResult;

    try {
      tokenResult =
        await tokenResponse.json();
    } catch {
      return res.status(502).json({
        error:
          "Withings returned an invalid token response."
      });
    }

    if (
      !tokenResponse.ok ||
      tokenResult.status !== 0 ||
      !tokenResult.body?.access_token
    ) {
      console.error(
        "Withings token exchange failed",
        {
          httpStatus:
            tokenResponse.status,

          withingsStatus:
            tokenResult?.status,

          error:
            tokenResult?.error
        }
      );

      return res.status(502).json({
        error:
          "Withings token exchange failed."
      });
    }

    const tokenData =
      tokenResult.body;

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
      {
        message:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }
    );

    return res.status(500).json({
      error:
        "Unexpected Withings connection error."
    });
  }
}
