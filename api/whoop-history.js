function createCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || "/"}`,
    `SameSite=${options.sameSite || "Lax"}`
  ];

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

async function refreshWhoopTokens(refreshToken) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: "offline"
  });

  const response = await fetch(
    "https://api.prod.whoop.com/oauth/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body
    }
  );

  if (!response.ok) {
    console.error("WHOOP token refresh failed", {
      status: response.status
    });

    return null;
  }

  return response.json();
}

async function fetchRecoveryHistory(accessToken) {
  const allRecords = [];
  let nextToken = null;
  let page = 0;

  /*
   * WHOOP geeft maximaal 25 recoveries per pagina.
   * 80 pagina's laten maximaal 2.000 records toe.
   */
  const maximumPages = 80;

  do {
    const parameters = new URLSearchParams({
      limit: "25"
    });

    if (nextToken) {
      parameters.set("nextToken", nextToken);
    }

    const response = await fetch(
      `https://api.prod.whoop.com/developer/v2/recovery?${parameters.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    if (response.status === 401) {
      const error = new Error("WHOOP_ACCESS_EXPIRED");
      error.code = "WHOOP_ACCESS_EXPIRED";
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();

      console.error("WHOOP recovery history failed", {
        status: response.status,
        body: body.slice(0, 500)
      });

      throw new Error(
        `WHOOP recovery request failed with status ${response.status}`
      );
    }

    const data = await response.json();

    if (Array.isArray(data.records)) {
      allRecords.push(...data.records);
    }

    nextToken = data.next_token || null;
    page += 1;
  } while (nextToken && page < maximumPages);

  return allRecords;
}

function compactRecoveryRecords(records) {
  return records
    .filter((record) => {
      return (
        record &&
        record.score_state === "SCORED" &&
        record.score &&
        Number.isFinite(Number(record.score.hrv_rmssd_milli)) &&
        Number.isFinite(Number(record.score.resting_heart_rate))
      );
    })
    .map((record) => {
      return {
        date: record.created_at,
        hrv: Number(record.score.hrv_rmssd_milli),
        rhr: Number(record.score.resting_heart_rate),
        recovery: Number(record.score.recovery_score)
      };
    })
    .sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "private, no-store");

  let accessToken = req.cookies?.whoop_access_token;
  const refreshToken = req.cookies?.whoop_refresh_token;

  try {
    /*
     * Wanneer de access-cookie vervallen is, vernieuwen we eerst
     * de tokens met de nog geldige refresh-cookie.
     */
    if (!accessToken && refreshToken) {
      const newTokens = await refreshWhoopTokens(refreshToken);

      if (!newTokens?.access_token) {
        return res.status(401).json({
          connected: false,
          error: "WHOOP authorization expired. Connect WHOOP again."
        });
      }

      accessToken = newTokens.access_token;

      const secure = process.env.NODE_ENV === "production";

      res.setHeader("Set-Cookie", [
        createCookie(
          "whoop_access_token",
          newTokens.access_token,
          {
            httpOnly: true,
            secure,
            maxAge: newTokens.expires_in || 3600
          }
        ),
        createCookie(
          "whoop_refresh_token",
          newTokens.refresh_token || refreshToken,
          {
            httpOnly: true,
            secure,
            maxAge: 60 * 60 * 24 * 90
          }
        )
      ]);
    }

    if (!accessToken) {
      return res.status(401).json({
        connected: false,
        error: "WHOOP is not connected."
      });
    }

    let records;

    try {
      records = await fetchRecoveryHistory(accessToken);
    } catch (error) {
      /*
       * De access token kan ondertussen vervallen zijn.
       * Probeer dan één keer automatisch te vernieuwen.
       */
      if (
        error?.code !== "WHOOP_ACCESS_EXPIRED" ||
        !refreshToken
      ) {
        throw error;
      }

      const newTokens = await refreshWhoopTokens(refreshToken);

      if (!newTokens?.access_token) {
        return res.status(401).json({
          connected: false,
          error: "WHOOP authorization expired. Connect WHOOP again."
        });
      }

      accessToken = newTokens.access_token;

      const secure = process.env.NODE_ENV === "production";

      res.setHeader("Set-Cookie", [
        createCookie(
          "whoop_access_token",
          newTokens.access_token,
          {
            httpOnly: true,
            secure,
            maxAge: newTokens.expires_in || 3600
          }
        ),
        createCookie(
          "whoop_refresh_token",
          newTokens.refresh_token || refreshToken,
          {
            httpOnly: true,
            secure,
            maxAge: 60 * 60 * 24 * 90
          }
        )
      ]);

      records = await fetchRecoveryHistory(accessToken);
    }

    const history = compactRecoveryRecords(records);

    return res.status(200).json({
      connected: true,
      count: history.length,
      firstDate: history[0]?.date || null,
      lastDate: history.at(-1)?.date || null,
      records: history
    });
  } catch (error) {
    console.error("WHOOP history endpoint failed", {
      message:
        error instanceof Error
          ? error.message
          : "Unknown error"
    });

    return res.status(502).json({
      connected: true,
      error: "WHOOP history could not be retrieved."
    });
  }
}
