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
    return res.status(405).send("Method not allowed.");
  }

  const code =
    String(req.query?.code || "");

  const returnedState =
    String(req.query?.state || "");

  const storedState =
    req.cookies?.whoop_oauth_state;

  if (req.query?.error) {
    return res
      .status(400)
      .send(
        `WHOOP authorization failed: ${req.query.error}`
      );
  }

  if (!code) {
    return res
      .status(400)
      .send("Missing authorization code.");
  }

  if (
    !returnedState ||
    !storedState ||
    returnedState !== storedState
  ) {
    return res
      .status(400)
      .send("Invalid OAuth state.");
  }

  const clientId =
    process.env.WHOOP_CLIENT_ID;

  const clientSecret =
    process.env.WHOOP_CLIENT_SECRET;

  const redirectUri =
    process.env.WHOOP_REDIRECT_URI;

  if (
    !clientId ||
    !clientSecret ||
    !redirectUri
  ) {
    return res
      .status(500)
      .send(
        "WHOOP server configuration is incomplete."
      );
  }

  try {
    const body =
      new URLSearchParams({
        grant_type:
          "authorization_code",

        code,

        redirect_uri:
          redirectUri,

        client_id:
          clientId,

        client_secret:
          clientSecret
      });

    const tokenResponse =
      await fetch(
        "https://api.prod.whoop.com/oauth/oauth2/token",
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

    let tokenData;

    try {
      tokenData =
        await tokenResponse.json();
    } catch {
      return res
        .status(502)
        .send(
          "WHOOP returned an invalid token response."
        );
    }

    if (
      !tokenResponse.ok ||
      !tokenData?.access_token
    ) {
      console.error(
        "WHOOP token exchange failed",
        {
          status:
            tokenResponse.status,

          error:
            tokenData?.error,

          description:
            tokenData?.error_description
        }
      );

      return res
        .status(502)
        .send(
          "WHOOP token exchange failed."
        );
    }

    const secure =
      process.env.NODE_ENV ===
      "production";

    res.setHeader(
      "Set-Cookie",
      [
        createCookie(
          "whoop_access_token",
          tokenData.access_token,
          {
            httpOnly: true,
            secure,
            maxAge:
              tokenData.expires_in ||
              3600
          }
        ),

        createCookie(
          "whoop_refresh_token",
          tokenData.refresh_token || "",
          {
            httpOnly: true,
            secure,
            maxAge:
              60 * 60 * 24 * 90
          }
        ),

        createCookie(
          "whoop_oauth_state",
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
      "Unexpected WHOOP callback error",
      {
        message:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }
    );

    return res
      .status(500)
      .send(
        "Unexpected WHOOP connection error."
      );
  }
}
