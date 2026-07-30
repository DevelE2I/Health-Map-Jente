export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accessToken = req.cookies?.whoop_access_token;

  if (!accessToken) {
    return res.status(401).json({
      connected: false,
      error: "WHOOP is not connected.",
    });
  }

  try {
    const [recoveryResponse, sleepResponse, cycleResponse] =
      await Promise.all([
        fetch("https://api.prod.whoop.com/developer/v2/recovery?limit=1", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }),

        fetch(
          "https://api.prod.whoop.com/developer/v2/activity/sleep?limit=1",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }
        ),

        fetch("https://api.prod.whoop.com/developer/v1/cycle?limit=1", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }),
      ]);

    if (
      recoveryResponse.status === 401 ||
      sleepResponse.status === 401 ||
      cycleResponse.status === 401
    ) {
      return res.status(401).json({
        connected: false,
        error: "WHOOP authorization expired.",
      });
    }

    const [recovery, sleep, cycle] = await Promise.all([
      recoveryResponse.ok ? recoveryResponse.json() : null,
      sleepResponse.ok ? sleepResponse.json() : null,
      cycleResponse.ok ? cycleResponse.json() : null,
    ]);

    return res.status(200).json({
      connected: true,
      recovery,
      sleep,
      cycle,
    });
  } catch (error) {
    console.error("WHOOP data request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return res.status(502).json({
      connected: true,
      error: "WHOOP data could not be retrieved.",
    });
  }
}
