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

  const body = new URLSearchParams({
    action: "requesttoken",
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });

  const response = await fetch(
    "https://wbsapi.withings.net/v2/oauth2",
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

  let result;

  try {
    result = await response.json();
  } catch {
    return null;
  }

  if (
    !response.ok ||
    result?.status !== 0 ||
    !result?.body?.access_token
  ) {
    console.error(
      "Withings token refresh failed",
      {
        httpStatus: response.status,
        withingsStatus: result?.status,
        error: result?.error
      }
    );

    return null;
  }

  return result.body;
}

function setTokenCookies(
  res,
  tokens,
  oldRefreshToken
) {
  const secure =
    process.env.NODE_ENV === "production";

  const newRefreshToken =
    tokens.refresh_token ||
    oldRefreshToken;

  res.setHeader("Set-Cookie", [
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
      newRefreshToken,
      {
        httpOnly: true,
        secure,
        maxAge:
          60 * 60 * 24 * 365
      }
    )
  ]);
}

async function requestMeasurements(
  accessToken
) {
  const body = new URLSearchParams({
    action: "getmeas",
    category: "1",
    lastupdate: "0"
  });

  const response = await fetch(
    "https://wbsapi.withings.net/measure",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body
    }
  );

  let result;

  try {
    result = await response.json();
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

  const unit =
    Number(measure.unit);

  if (
    !Number.isFinite(value) ||
    !Number.isFinite(unit)
  ) {
    return null;
  }

  return value *
    Math.pow(10, unit);
}

const MEASUREMENT_TYPES = {
  1: "weightKg",
  4: "heightMeter",
  5: "fatFreeMassKg",
  6: "fatRatioPercent",
  8: "fatMassKg",
  11: "heartRateBpm",
  76: "muscleMassKg",
  77: "hydrationKg",
  88: "boneMassKg",
  91: "pulseWaveVelocity",
  155: "vascularAge",
  170: "visceralFatIndex",
  226: "basalMetabolicRate"
};

function formatMeasurementGroups(groups) {
  return groups
    .map((group) => {
      const measurements = {};

      for (
        const measure of
          group.measures || []
      ) {
        const propertyName =
          MEASUREMENT_TYPES[
            measure.type
          ];

        if (!propertyName) {
          continue;
        }

        measurements[propertyName] =
          decodeValue(measure);
      }

      return {
        id: group.grpid,

        date: new Date(
          Number(group.date) *
            1000
        ).toISOString(),

        category:
          group.category,

        attribute:
          group.attrib,

        comment:
          group.comment || "",

        deviceId:
          group.deviceid || null,

        ...measurements
      };
    })
    .filter((record) => {
      return Object.keys(record).some(
        (key) =>
          Object.values(
            MEASUREMENT_TYPES
          ).includes(key)
      );
    })
    .sort((first, second) => {
      return (
        new Date(first.date) -
        new Date(second.date)
      );
    });
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
    "private, no-store, max-age=0"
  );

  let accessToken =
    req.cookies
      ?.withings_access_token;

  let refreshToken =
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
      const refreshedTokens =
        await refreshWithingsToken(
          refreshToken
        );

      if (
        !refreshedTokens
          ?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Withings authorization has expired. Connect Withings again."
        });
      }

      accessToken =
        refreshedTokens.access_token;

      refreshToken =
        refreshedTokens.refresh_token ||
        refreshToken;

      setTokenCookies(
        res,
        refreshedTokens,
        refreshToken
      );
    }

    let measurementRequest =
      await requestMeasurements(
        accessToken
      );

    const accessWasRejected =
      measurementRequest
        .response.status === 401 ||
      measurementRequest
        .result?.status === 401;

    if (
      accessWasRejected &&
      refreshToken
    ) {
      const refreshedTokens =
        await refreshWithingsToken(
          refreshToken
        );

      if (
        !refreshedTokens
          ?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Withings authorization has expired. Connect Withings again."
        });
      }

      accessToken =
        refreshedTokens.access_token;

      refreshToken =
        refreshedTokens.refresh_token ||
        refreshToken;

      setTokenCookies(
        res,
        refreshedTokens,
        refreshToken
      );

      measurementRequest =
        await requestMeasurements(
          accessToken
        );
    }

    const {
      response,
      result
    } = measurementRequest;

    if (
      !response.ok ||
      !result ||
      result.status !== 0
    ) {
      console.error(
        "Withings measurement request failed",
        {
          httpStatus:
            response.status,

          withingsStatus:
            result?.status,

          error:
            result?.error
        }
      );

      return res.status(502).json({
        connected: true,
        error:
          "Withings measurements could not be retrieved."
      });
    }

    const records =
      formatMeasurementGroups(
        result.body
          ?.measuregrps ||
        []
      );

    const latest =
      records.length > 0
        ? records[
            records.length - 1
          ]
        : null;

    return res.status(200).json({
      connected: true,
      count: records.length,

      firstDate:
        records[0]?.date ||
        null,

      lastDate:
        latest?.date ||
        null,

      latest,

      records
    });
  } catch (error) {
    console.error(
      "Unexpected Withings data error",
      {
        message:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }
    );

    return res.status(500).json({
      connected: true,
      error:
        "Unexpected Withings data error."
    });
  }
}
