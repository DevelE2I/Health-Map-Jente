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

  const savedState =
    req.cookies?.withings_oauth_state;

  if (
    !code ||
    !returnedState ||
    !savedState ||
    returnedState !== savedState
  ) {
    return res.status(400).json({
      error: "Invalid Withings OAuth callback."
    });
  }

  const clientId =
    process.env.WITHINGS_CLIENT_ID;

  const clientSecret =
    process.env.WITHINGS_CLIENT_SECRET;

  const redirectUri =
    process.env.WITHINGS_REDIRECT_URI;

  if (
    !clientId ||
    !clientSecret ||
    !redirectUri
  ) {
    return res.status(500).json({
      error:
        "Withings environment variables are missing."
    });
  }

  const body =
    new URLSearchParams({
      action: "requesttoken",
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    });

  const response =
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

  let result;

  try {
    result =
      await response.json();
  } catch {
    return res.status(502).json({
      error:
        "Withings returned an invalid token response."
    });
  }

  if (
    !response.ok ||
    result.status !== 0 ||
    !result.body?.access_token
  ) {
    console.error(
      "Withings token exchange failed:",
      result
    );

    return res.status(502).json({
      error:
        "Withings authorization failed."
    });
  }

  const tokens =
    result.body;

  const secure =
    process.env.NODE_ENV === "production";

  res.setHeader(
    "Set-Cookie",
    [
      createCookie(
        "withings_access_token",
        tokens.access_token,
        {
          httpOnly: true,
          secure,
          maxAge:
            tokens.expires_in ||
            10800
        }
      ),

      createCookie(
        "withings_refresh_token",
        tokens.refresh_token,
        {
          httpOnly: true,
          secure,
          maxAge:
            60 * 60 * 24 * 365
        }
      ),

      createCookie(
        "withings_user_id",
        String(tokens.userid || ""),
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
}
