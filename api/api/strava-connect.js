import crypto from "node:crypto";

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

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const clientId =
    process.env.STRAVA_CLIENT_ID;

  const redirectUri =
    process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error:
        "Strava server configuration is incomplete."
    });
  }

  const state =
    crypto.randomBytes(24).toString("hex");

  const secure =
    process.env.NODE_ENV === "production";

  res.setHeader(
    "Set-Cookie",
    createCookie(
      "strava_oauth_state",
      state,
      {
        httpOnly: true,
        secure,
        maxAge: 10 * 60
      }
    )
  );

  const authorizationUrl =
    new URL(
      "https://www.strava.com/oauth/authorize"
    );

  authorizationUrl.searchParams.set(
    "client_id",
    clientId
  );

  authorizationUrl.searchParams.set(
    "redirect_uri",
    redirectUri
  );

  authorizationUrl.searchParams.set(
    "response_type",
    "code"
  );

  authorizationUrl.searchParams.set(
    "approval_prompt",
    "force"
  );

  authorizationUrl.searchParams.set(
    "scope",
    "read,activity:read_all"
  );

  authorizationUrl.searchParams.set(
    "state",
    state
  );

  return res.redirect(
    302,
    authorizationUrl.toString()
  );
}
