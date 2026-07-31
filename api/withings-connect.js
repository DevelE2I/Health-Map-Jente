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
    process.env.WITHINGS_CLIENT_ID;

  const redirectUri =
    "https://health-map-jente.vercel.app/api/withings-callback";

  if (!clientId) {
    return res.status(500).json({
      error: "WITHINGS_CLIENT_ID is missing in Vercel."
    });
  }

  const state =
    crypto.randomBytes(24).toString("hex");

  const secure =
    process.env.NODE_ENV === "production";

  res.setHeader(
    "Set-Cookie",
    createCookie(
      "withings_oauth_state",
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
      "https://account.withings.com/oauth2_user/authorize2"
    );

  authorizationUrl.searchParams.set(
    "response_type",
    "code"
  );

  authorizationUrl.searchParams.set(
    "client_id",
    clientId
  );

  authorizationUrl.searchParams.set(
    "scope",
    "user.info,user.metrics"
  );

  authorizationUrl.searchParams.set(
    "redirect_uri",
    redirectUri
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
