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

  const form = new URLSearchParams({
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
      body: form
    }
  );

  if (!response.ok) {
    console.error("WHOOP refresh failed", {
      status: response.status
    });

    return null;
  }

  return response.json();
}

const COLLECTIONS = {
  recovery: {
    url: "https://api.prod.whoop.com/developer/v2/recovery",

    compact(record) {
      if (
        !record ||
        record.score_state !== "SCORED" ||
        !record.score
      ) {
        return null;
      }

      return {
        cycleId: record.cycle_id,
        sleepId: record.sleep_id,
        date: record.created_at,
        recovery: Number(record.score.recovery_score),
        hrv: Number(record.score.hrv_rmssd_milli),
        rhr: Number(record.score.resting_heart_rate),
        spo2: Number(record.score.spo2_percentage),
        skinTemp: Number(record.score.skin_temp_celsius)
      };
    }
  },

  sleep: {
    url: "https://api.prod.whoop.com/developer/v2/activity/sleep",

    compact(record) {
      if (
        !record ||
        record.nap === true ||
        record.score_state !== "SCORED" ||
        !record.score
      ) {
        return null;
      }

      const stages = record.score.stage_summary || {};
      const needed = record.score.sleep_needed || {};

      const asleep =
        Number(stages.total_light_sleep_time_milli || 0) +
        Number(stages.total_slow_wave_sleep_time_milli || 0) +
        Number(stages.total_rem_sleep_time_milli || 0);

      const sleepNeed =
        Number(needed.baseline_milli || 0) +
        Number(needed.need_from_sleep_debt_milli || 0) +
        Number(needed.need_from_recent_strain_milli || 0) +
        Number(needed.need_from_recent_nap_milli || 0);

      return {
        id: record.id,
        cycleId: record.cycle_id,
        date: record.end || record.created_at,
        start: record.start,
        end: record.end,
        durationMilli: asleep,
        inBedMilli: Number(stages.total_in_bed_time_milli || 0),
        awakeMilli: Number(stages.total_awake_time_milli || 0),
        lightMilli: Number(
          stages.total_light_sleep_time_milli || 0
        ),
        deepMilli: Number(
          stages.total_slow_wave_sleep_time_milli || 0
        ),
        remMilli: Number(
          stages.total_rem_sleep_time_milli || 0
        ),
        sleepNeedMilli: sleepNeed,
        performance: Number(
          record.score.sleep_performance_percentage
        ),
        consistency: Number(
          record.score.sleep_consistency_percentage
        ),
        efficiency: Number(
          record.score.sleep_efficiency_percentage
        ),
        respiratoryRate: Number(record.score.respiratory_rate),
        disturbances: Number(stages.disturbance_count || 0),
        cycles: Number(stages.sleep_cycle_count || 0)
      };
    }
  },

  cycle: {
    url: "https://api.prod.whoop.com/developer/v2/cycle",

    compact(record) {
      if (
        !record ||
        record.score_state !== "SCORED" ||
        !record.score
      ) {
        return null;
      }

      return {
        id: record.id,
        date: record.start || record.created_at,
        start: record.start,
        end: record.end,
        strain: Number(record.score.strain),
        kilojoule: Number(record.score.kilojoule),
        averageHeartRate: Number(
          record.score.average_heart_rate
        ),
        maxHeartRate: Number(record.score.max_heart_rate)
      };
    }
  },

  workout: {
    url: "https://api.prod.whoop.com/developer/v2/activity/workout",

    compact(record) {
      if (
        !record ||
        record.score_state !== "SCORED" ||
        !record.score
      ) {
        return null;
      }

      const zones = record.score.zone_durations || {};

      const start = new Date(record.start).getTime();
      const end = new Date(record.end).getTime();

      return {
        id: record.id,
        date: record.start || record.created_at,
        start: record.start,
        end: record.end,
        sportName: record.sport_name || "unknown",
        sportId: record.sport_id,

        durationMilli:
          Number.isFinite(start) && Number.isFinite(end)
            ? Math.max(0, end - start)
            : 0,

        strain: Number(record.score.strain),
        averageHeartRate: Number(
          record.score.average_heart_rate
        ),
        maxHeartRate: Number(record.score.max_heart_rate),
        kilojoule: Number(record.score.kilojoule),
        distanceMeter: Number(record.score.distance_meter),
        altitudeGainMeter: Number(
          record.score.altitude_gain_meter
        ),
        zone0Milli: Number(zones.zone_zero_milli || 0),
        zone1Milli: Number(zones.zone_one_milli || 0),
        zone2Milli: Number(zones.zone_two_milli || 0),
        zone3Milli: Number(zones.zone_three_milli || 0),
        zone4Milli: Number(zones.zone_four_milli || 0),
        zone5Milli: Number(zones.zone_five_milli || 0)
      };
    }
  }
};

async function fetchAllPages(accessToken, collection) {
  const records = [];

  let nextToken = null;
  let page = 0;

  const maximumPages = 100;

  do {
    const params = new URLSearchParams({
      limit: "25"
    });

    if (nextToken) {
      params.set("nextToken", nextToken);
    }

    const response = await fetch(
      `${collection.url}?${params.toString()}`,
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
      const text = await response.text();

      console.error("WHOOP history request failed", {
        status: response.status,
        body: text.slice(0, 300)
      });

      throw new Error(
        `WHOOP request failed with status ${response.status}`
      );
    }

    const data = await response.json();

    if (Array.isArray(data.records)) {
      records.push(...data.records);
    }

    nextToken = data.next_token || null;
    page += 1;
  } while (nextToken && page < maximumPages);

  return records;
}

function compactAndSort(records, collection) {
  return records
    .map(collection.compact)
    .filter(Boolean)
    .filter((record) => {
      const timestamp = new Date(record.date).getTime();
      return Number.isFinite(timestamp);
    })
    .sort(
      (first, second) =>
        new Date(first.date) - new Date(second.date)
    );
}

function setTokenCookies(
  res,
  tokens,
  previousRefreshToken
) {
  const secure = process.env.NODE_ENV === "production";

  res.setHeader("Set-Cookie", [
    createCookie(
      "whoop_access_token",
      tokens.access_token,
      {
        httpOnly: true,
        secure,
        maxAge: tokens.expires_in || 3600
      }
    ),

    createCookie(
      "whoop_refresh_token",
      tokens.refresh_token || previousRefreshToken,
      {
        httpOnly: true,
        secure,
        maxAge: 60 * 60 * 24 * 90
      }
    )
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  res.setHeader(
    "Cache-Control",
    "private, no-store"
  );

  const type = String(
    req.query?.type || "recovery"
  ).toLowerCase();

  const collection = COLLECTIONS[type];

  if (!collection) {
    return res.status(400).json({
      error:
        "Unknown history type. Use recovery, sleep, cycle or workout."
    });
  }

  let accessToken =
    req.cookies?.whoop_access_token;

  const refreshToken =
    req.cookies?.whoop_refresh_token;

  try {
    if (!accessToken && refreshToken) {
      const tokens =
        await refreshWhoopTokens(refreshToken);

      if (!tokens?.access_token) {
        return res.status(401).json({
          connected: false,
          error:
            "WHOOP authorization expired. Connect WHOOP again."
        });
      }

      accessToken = tokens.access_token;

      setTokenCookies(
        res,
        tokens,
        refreshToken
      );
    }

    if (!accessToken) {
      return res.status(401).json({
        connected: false,
        error: "WHOOP is not connected."
      });
    }

    let rawRecords;

    try {
      rawRecords = await fetchAllPages(
        accessToken,
        collection
      );
    } catch (error) {
      if (
        error?.code !== "WHOOP_ACCESS_EXPIRED" ||
        !refreshToken
      ) {
        throw error;
      }

      const tokens =
        await refreshWhoopTokens(refreshToken);

      if (!tokens?.access_token) {
        return res.status(401).json({
          connected: false,
          error:
            "WHOOP authorization expired. Connect WHOOP again."
        });
      }

      accessToken = tokens.access_token;

      setTokenCookies(
        res,
        tokens,
        refreshToken
      );

      rawRecords = await fetchAllPages(
        accessToken,
        collection
      );
    }

    const records = compactAndSort(
      rawRecords,
      collection
    );

    return res.status(200).json({
      connected: true,
      type,
      count: records.length,
      firstDate: records[0]?.date || null,
      lastDate: records.at(-1)?.date || null,
      records
    });
  } catch (error) {
    console.error(
      "WHOOP history endpoint failed",
      {
        type,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }
    );

    return res.status(502).json({
      connected: true,
      type,
      error:
        `${type} history could not be retrieved.`
    });
  }
}
