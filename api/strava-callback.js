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

  const code = String(req.query?.code || "");
  const returnedState = String(req.query?.state || "");
  const storedState = req.cookies?.strava_oauth_state;

  if (req.query?.error) {
    return res.status(400).json({
      error: `Strava authorization failed: ${req.query.error}`
    });
  }

  if (!code) {
    return res.status(400).json({
      error: "Missing Strava authorization code."
    });
  }

  if (
    !returnedState ||
    !storedState ||
    returnedState !== storedState
  ) {
    return res.status(400).json({
      error: "Invalid Strava OAuth state."
    });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({
      error: "Strava server configuration is incomplete."
    });
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code"
    });

    const tokenResponse = await fetch(
      "https://www.strava.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      }
    );

    let tokenData;

    try {
      tokenData = await tokenResponse.json();
    } catch {
      return res.status(502).json({
        error: "Strava returned an invalid token response."
      });
    }

    if (
      !tokenResponse.ok ||
      !tokenData?.access_token
    ) {
      console.error("Strava token exchange failed", {
        httpStatus: tokenResponse.status,
        response: tokenData
      });

      return res.status(502).json({
        error: "Strava token exchange failed.",
        details: tokenData
      });
    }

    const secure =
      process.env.NODE_ENV === "production";

    const expiresIn =
      Math.max(
        60,
        Number(tokenData.expires_at) -
          Math.floor(Date.now() / 1000)
      );

    res.setHeader("Set-Cookie", [
      createCookie(
        "strava_access_token",
        tokenData.access_token,
        {
          httpOnly: true,
          secure,
          maxAge: expiresIn
        }
      ),

      createCookie(
        "strava_refresh_token",
        tokenData.refresh_token || "",
        {
          httpOnly: true,
          secure,
          maxAge: 60 * 60 * 24 * 365
        }
      ),

      createCookie(
        "strava_athlete_id",
        String(tokenData.athlete?.id || ""),
        {
          httpOnly: true,
          secure,
          maxAge: 60 * 60 * 24 * 365
        }
      ),

      createCookie(
        "strava_oauth_state",
        "",
        {
          httpOnly: true,
          secure,
          maxAge: 0
        }
      )
    ]);

    return res.redirect(302, "/");
  } catch (error) {
    console.error("Unexpected Strava callback error", {
      message:
        error instanceof Error
          ? error.message
          : "Unknown error"
    });

    return res.status(500).json({
      error: "Unexpected Strava connection error."
    });
  }
}
