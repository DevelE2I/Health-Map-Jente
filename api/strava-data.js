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

async function refreshStravaToken(refreshToken) {
  const clientId =
    process.env.STRAVA_CLIENT_ID;

  const clientSecret =
    process.env.STRAVA_CLIENT_SECRET;

  if (
    !refreshToken ||
    !clientId ||
    !clientSecret
  ) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const response = await fetch(
    "https://www.strava.com/oauth/token",
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

  let data;

  try {
    data = await response.json();
  } catch {
    return null;
  }

  if (
    !response.ok ||
    !data?.access_token
  ) {
    console.error(
      "Strava token refresh failed",
      {
        httpStatus: response.status,
        response: data
      }
    );

    return null;
  }

  return data;
}

function setTokenCookies(
  res,
  tokenData,
  previousRefreshToken
) {
  const secure =
    process.env.NODE_ENV === "production";

  const expiresIn =
    Math.max(
      60,
      Number(tokenData.expires_at) -
        Math.floor(Date.now() / 1000)
    );

  const refreshToken =
    tokenData.refresh_token ||
    previousRefreshToken;

  res.setHeader(
    "Set-Cookie",
    [
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
        refreshToken,
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

async function requestAthlete(
  accessToken
) {
  const response = await fetch(
    "https://www.strava.com/api/v3/athlete",
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json"
      }
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    response,
    data
  };
}

async function requestActivityPage(
  accessToken,
  page
) {
  const url = new URL(
    "https://www.strava.com/api/v3/athlete/activities"
  );

  url.searchParams.set(
    "page",
    String(page)
  );

  url.searchParams.set(
    "per_page",
    "200"
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json"
      }
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    response,
    data
  };
}

async function requestActivities(
  accessToken
) {
  const allActivities = [];

  const maximumPages = 5;

  for (
    let page = 1;
    page <= maximumPages;
    page += 1
  ) {
    const {
      response,
      data
    } = await requestActivityPage(
      accessToken,
      page
    );

    if (
      response.status === 401
    ) {
      return {
        unauthorized: true,
        response,
        data
      };
    }

    if (
      !response.ok ||
      !Array.isArray(data)
    ) {
      return {
        unauthorized: false,
        response,
        data,
        error: true
      };
    }

    allActivities.push(
      ...data
    );

    if (
      data.length === 0 ||
      data.length < 200
    ) {
      break;
    }
  }

  return {
    unauthorized: false,
    activities: allActivities
  };
}

function numberOrNull(value) {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function metersToKilometers(value) {
  const meters =
    numberOrNull(value);

  return meters === null
    ? null
    : meters / 1000;
}

function secondsToHours(value) {
  const seconds =
    numberOrNull(value);

  return seconds === null
    ? null
    : seconds / 3600;
}

function metersPerSecondToKilometersPerHour(
  value
) {
  const speed =
    numberOrNull(value);

  return speed === null
    ? null
    : speed * 3.6;
}

function calculatePace(
  distanceMeters,
  movingTimeSeconds
) {
  const distance =
    numberOrNull(distanceMeters);

  const movingTime =
    numberOrNull(movingTimeSeconds);

  if (
    distance === null ||
    movingTime === null ||
    distance <= 0 ||
    movingTime <= 0
  ) {
    return null;
  }

  const kilometers =
    distance / 1000;

  return movingTime /
    kilometers /
    60;
}

function normalizeActivity(
  activity
) {
  return {
    id:
      String(activity.id),

    name:
      activity.name ||
      "Naamloze activiteit",

    sportType:
      activity.sport_type ||
      activity.type ||
      "Unknown",

    type:
      activity.type ||
      activity.sport_type ||
      "Unknown",

    date:
      activity.start_date ||
      null,

    localDate:
      activity.start_date_local ||
      activity.start_date ||
      null,

    timezone:
      activity.timezone ||
      null,

    distanceKm:
      metersToKilometers(
        activity.distance
      ),

    movingTimeSeconds:
      numberOrNull(
        activity.moving_time
      ),

    movingTimeHours:
      secondsToHours(
        activity.moving_time
      ),

    elapsedTimeSeconds:
      numberOrNull(
        activity.elapsed_time
      ),

    elevationMeters:
      numberOrNull(
        activity.total_elevation_gain
      ),

    averageSpeedKph:
      metersPerSecondToKilometersPerHour(
        activity.average_speed
      ),

    maxSpeedKph:
      metersPerSecondToKilometersPerHour(
        activity.max_speed
      ),

    averagePaceMinutesPerKm:
      calculatePace(
        activity.distance,
        activity.moving_time
      ),

    averageHeartRate:
      numberOrNull(
        activity.average_heartrate
      ),

    maxHeartRate:
      numberOrNull(
        activity.max_heartrate
      ),

    averageWatts:
      numberOrNull(
        activity.average_watts
      ),

    weightedAverageWatts:
      numberOrNull(
        activity.weighted_average_watts
      ),

    kilojoules:
      numberOrNull(
        activity.kilojoules
      ),

    calories:
      numberOrNull(
        activity.calories
      ),

    sufferScore:
      numberOrNull(
        activity.suffer_score
      ),

    perceivedExertion:
      numberOrNull(
        activity.perceived_exertion
      ),

    achievementCount:
      numberOrNull(
        activity.achievement_count
      ),

    kudosCount:
      numberOrNull(
        activity.kudos_count
      ),

    private:
      Boolean(activity.private),

    trainer:
      Boolean(activity.trainer),

    commute:
      Boolean(activity.commute),

    manual:
      Boolean(activity.manual),

    hasHeartRate:
      Boolean(activity.has_heartrate),

    deviceName:
      activity.device_name ||
      null,

    externalId:
      activity.external_id ||
      null
  };
}

function isRun(activity) {
  const type =
    String(
      activity.sportType ||
      activity.type ||
      ""
    ).toLowerCase();

  return [
    "run",
    "trailrun",
    "virtualrun"
  ].includes(type);
}

function isRide(activity) {
  const type =
    String(
      activity.sportType ||
      activity.type ||
      ""
    ).toLowerCase();

  return [
    "ride",
    "mountainbikeride",
    "gravelride",
    "virtualride",
    "ebikeride",
    "emountainbikeride"
  ].includes(type);
}

function summarizeActivities(
  activities
) {
  const runs =
    activities.filter(isRun);

  const rides =
    activities.filter(isRide);

  const totalDistanceKm =
    activities.reduce(
      (sum, activity) =>
        sum +
        (
          numberOrNull(
            activity.distanceKm
          ) || 0
        ),
      0
    );

  const totalMovingHours =
    activities.reduce(
      (sum, activity) =>
        sum +
        (
          numberOrNull(
            activity.movingTimeHours
          ) || 0
        ),
      0
    );

  const totalElevationMeters =
    activities.reduce(
      (sum, activity) =>
        sum +
        (
          numberOrNull(
            activity.elevationMeters
          ) || 0
        ),
      0
    );

  const runDistanceKm =
    runs.reduce(
      (sum, activity) =>
        sum +
        (
          numberOrNull(
            activity.distanceKm
          ) || 0
        ),
      0
    );

  const rideDistanceKm =
    rides.reduce(
      (sum, activity) =>
        sum +
        (
          numberOrNull(
            activity.distanceKm
          ) || 0
        ),
      0
    );

  return {
    activityCount:
      activities.length,

    runCount:
      runs.length,

    rideCount:
      rides.length,

    totalDistanceKm,

    runDistanceKm,

    rideDistanceKm,

    totalMovingHours,

    totalElevationMeters
  };
}

function publicAthleteProfile(
  athlete
) {
  if (!athlete) {
    return null;
  }

  return {
    id:
      athlete.id
        ? String(athlete.id)
        : null,

    firstName:
      athlete.firstname ||
      "",

    lastName:
      athlete.lastname ||
      "",

    city:
      athlete.city ||
      "",

    state:
      athlete.state ||
      "",

    country:
      athlete.country ||
      "",

    profileImage:
      athlete.profile_medium ||
      athlete.profile ||
      null,

    premium:
      Boolean(athlete.premium),

    summit:
      Boolean(athlete.summit),

    createdAt:
      athlete.created_at ||
      null,

    updatedAt:
      athlete.updated_at ||
      null
  };
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
      ?.strava_access_token;

  let refreshToken =
    req.cookies
      ?.strava_refresh_token;

  if (
    !accessToken &&
    !refreshToken
  ) {
    return res.status(401).json({
      connected: false,
      error:
        "Strava is not connected."
    });
  }

  try {
    if (
      !accessToken &&
      refreshToken
    ) {
      const refreshedTokens =
        await refreshStravaToken(
          refreshToken
        );

      if (
        !refreshedTokens
          ?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Strava authorization expired. Connect Strava again."
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

    let athleteRequest =
      await requestAthlete(
        accessToken
      );

    if (
      athleteRequest.response.status ===
        401 &&
      refreshToken
    ) {
      const refreshedTokens =
        await refreshStravaToken(
          refreshToken
        );

      if (
        !refreshedTokens
          ?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Strava authorization expired. Connect Strava again."
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

      athleteRequest =
        await requestAthlete(
          accessToken
        );
    }

    if (
      !athleteRequest.response.ok ||
      !athleteRequest.data?.id
    ) {
      console.error(
        "Strava athlete request failed",
        {
          httpStatus:
            athleteRequest.response.status,

          response:
            athleteRequest.data
        }
      );

      return res.status(502).json({
        connected: true,
        error:
          "Strava athlete profile could not be retrieved."
      });
    }

    let activityRequest =
      await requestActivities(
        accessToken
      );

    if (
      activityRequest.unauthorized &&
      refreshToken
    ) {
      const refreshedTokens =
        await refreshStravaToken(
          refreshToken
        );

      if (
        !refreshedTokens
          ?.access_token
      ) {
        return res.status(401).json({
          connected: false,
          error:
            "Strava authorization expired. Connect Strava again."
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

      activityRequest =
        await requestActivities(
          accessToken
        );
    }

    if (
      activityRequest.error ||
      !Array.isArray(
        activityRequest.activities
      )
    ) {
      console.error(
        "Strava activity request failed",
        {
          httpStatus:
            activityRequest
              .response?.status,

          response:
            activityRequest.data
        }
      );

      return res.status(502).json({
        connected: true,
        error:
          "Strava activities could not be retrieved."
      });
    }

    const records =
      activityRequest.activities
        .map(normalizeActivity)
        .filter(
          (activity) =>
            activity.date
        )
        .sort(
          (first, second) =>
            new Date(first.date) -
            new Date(second.date)
        );

    const summary =
      summarizeActivities(
        records
      );

    return res.status(200).json({
      connected: true,

      athlete:
        publicAthleteProfile(
          athleteRequest.data
        ),

      count:
        records.length,

      firstDate:
        records[0]?.date ||
        null,

      lastDate:
        records.at(-1)?.date ||
        null,

      latest:
        records.at(-1) ||
        null,

      summary,

      records
    });
  } catch (error) {
    console.error(
      "Unexpected Strava data error",
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
        "Unexpected Strava data error."
    });
  }
}
