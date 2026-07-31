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
    return res
      .status(405)
      .send("Method not allowed.");
  }

  const clientId =
    process.env.WHOOP_CLIENT_ID;

  const redirectUri =
    process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res
      .status(500)
      .send(
        "WHOOP server configuration is incomplete."
      );
  }

  const state =
    crypto
      .randomBytes(24)
      .toString("hex");

  const secure =
    process.env.NODE_ENV ===
    "production";

  res.setHeader(
    "Set-Cookie",
    createCookie(
      "whoop_oauth_state",
      state,
      {
        httpOnly: true,
        secure,
        maxAge: 10 * 60
      }
    )
  );

  const scopes = [
    "offline",
    "read:recovery",
    "read:cycles",
    "read:sleep",
    "read:workout",
    "read:profile",
    "read:body_measurement"
  ].join(" ");

  const authorizationUrl =
    new URL(
      "https://api.prod.whoop.com/oauth/oauth2/auth"
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
    "scope",
    scopes
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
