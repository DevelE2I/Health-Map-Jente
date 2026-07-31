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

async function refreshWithingsToken(refreshToken) {
  const clientId =
    process.env.WITHINGS_CLIENT_ID;

  const clientSecret =
    process.env.WITHINGS_CLIENT_SECRET;

  if (
    !refreshToken ||
    !clientId ||
    !clientSecret
  ) {
    return null;
  }

  const body =
    new URLSearchParams({
      action: "requesttoken",
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
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
    return null;
  }

  if (
    !response.ok ||
    result.status !== 0 ||
    !result.body?.access_token
  ) {
    console.error(
      "Withings token refresh failed:",
      result
    );

    return null;
  }

  return result.body;
}

function setTokenCookies(
  res,
  tokens,
  previousRefreshToken
) {
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
        tokens.refresh_token ||
          previousRefreshToken,
        {
          httpOnly: true,
          secure,
          maxAge:
            60 * 60 * 24 * 365
        }
      )
    ]
  );
}

async function fetchMeasurements(
  accessToken
) {
  const body =
    new URLSearchParams({
      action: "getmeas",
      category: "1",
      lastupdate: "0"
    });

  const response =
    await fetch(
      "https://wbsapi.withings.net/measure",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

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
    result = null;
  }

  return {
    response,
    result
  };
}

function decodeValue(measure) {
  const value =
    Number(measure.value);

  const exponent =
    Number(measure.unit);

  if (
    !Number.isFinite(value) ||
    !Number.isFinite(exponent)
  ) {
    return null;
  }

  return value *
    Math.pow(10, exponent);
}

const TYPE_NAMES = {
  1: "weightKg",
  4: "heightMeter",
  5: "fatFreeMassKg",
  6: "fatRatioPercent",
  8: "fatMassKg",
  76: "muscleMassKg",
  77: "hydrationKg",
  88: "boneMassKg",
  170: "visceralFatIndex",
  226: "basalMetabolicRate"
};

function compactMeasurementGroups(groups) {
  return groups
    .map((group) => {
      const values = {};

      for (
        const measure of
          group.measures || []
      ) {
        const name =
          TYPE_NAMES[measure.type];

        if (!name) {
          continue;
        }

        values[name] =
          decodeValue(measure);
      }

      return {
        id: group.grpid,

        date:
          new Date(
            Number(group.date) *
              1000
          ).toISOString(),

        category:
          group.category,

        attributed:
          group.attrib,

        ...values
      };
    })
    .filter((record) => {
      return Object.keys(record).some(
        (key) =>
          key.endsWith("Kg") ||
          key.endsWith("Percent") ||
          key.endsWith("Index") ||
          key === "heightMeter" ||
          key === "basalMetabolicRate"
      );
    })
    .sort(
      (first, second) =>
        new Date(first.date) -
        new Date(second.date)
    );
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

  res.setHeader(
    "Cache-Control",
    "private, no-store"
  );

  let accessToken =
    req.cookies
      ?.withings_access_token;

  const refreshToken =
    req.cookies
      ?.withings_refresh_token;

  if (
    !accessToken &&
    !refreshToken
  ) {
    return res.status(401).json({
      connected: false,
      error:
        "Withings is not connected."
    });
  }

  try {
    if (
      !accessToken &&
      refreshToken
    ) {
      const tokens =
        await refreshWithingsToken(
          refreshToken
        );

      if (
        !tokens?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Withings authorization expired."
        });
      }

      accessToken =
        tokens.access_token;

      setTokenCookies(
        res,
        tokens,
        refreshToken
      );
    }

    let {
      response,
      result
    } =
      await fetchMeasurements(
        accessToken
      );

    if (
      response.status === 401 ||
      result?.status === 401
    ) {
      const tokens =
        await refreshWithingsToken(
          refreshToken
        );

      if (
        !tokens?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Withings authorization expired."
        });
      }

      accessToken =
        tokens.access_token;

      setTokenCookies(
        res,
        tokens,
        refreshToken
      );

      ({
        response,
        result
      } =
        await fetchMeasurements(
          accessToken
        ));
    }

    if (
      !response.ok ||
      !result ||
      result.status !== 0
    ) {
      console.error(
        "Withings measurement request failed:",
        result
      );

      return res.status(502).json({
        connected: true,
        error:
          "Withings measurements could not be retrieved."
      });
    }

    const records =
      compactMeasurementGroups(
        result.body
          ?.measuregrps ||
        []
      );

    return res.status(200).json({
      connected: true,
      count: records.length,

      firstDate:
        records[0]?.date ||
        null,

      lastDate:
        records.at(-1)?.date ||
        null,

      latest:
        records.at(-1) ||
        null,

      records
    });
  } catch (error) {
    console.error(
      "Withings data endpoint failed:",
      error
    );

    return res.status(502).json({
      connected: true,
      error:
        "Withings data could not be retrieved."
    });
  }
}
