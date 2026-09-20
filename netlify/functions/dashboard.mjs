const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const authorized = (event) => {
  const expected =
    "Basic " +
    Buffer.from(
      `${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`,
    ).toString("base64");

  return event.headers.authorization === expected;
};

async function query(path) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${path}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`${path.split("?")[0]}: ${await response.text()}`);
  }

  return response.json();
}

const siteDefinitions = [
  { location_id: 48, name: "North Battleford Bulk" },
  { location_id: 63, name: "Meadow Lake" },
  { location_id: 47, name: "The Pas" },
];

async function loadSite(site, year) {
  const [throughput, statusRows, alarms] = await Promise.all([
    query(
      `dips_annual_tank_throughput?select=*&location_id=eq.${site.location_id}&calendar_year=eq.${year}&order=tank.asc`,
    ),
    query(
      `dips_site_status?select=site_name,last_seen_at,updated_at&location_id=eq.${site.location_id}&limit=1`,
    ),
    query(
      `dips_alarm_state?select=alarm_key,alarm_text,category,last_seen_at&location_id=eq.${site.location_id}&active=eq.true&order=last_seen_at.desc`,
    ),
  ]);

  const status = statusRows[0] || null;
  const lastReport = status?.last_seen_at || status?.updated_at || null;
  const online = lastReport
    ? Date.now() - new Date(lastReport).getTime() < 60 * 60 * 1000
    : false;

  return {
    site: {
      location_id: site.location_id,
      name: status?.site_name || site.name,
    },
    year,
    throughput,
    status: status ? { ...status, online } : { online: false },
    alarms,
  };
}

export async function handler(event) {
  if (!authorized(event)) {
    return json(401, { error: "Unauthorized" });
  }

  const year = new Date().getFullYear();

  try {
    const sites = await Promise.all(
      siteDefinitions.map((site) => loadSite(site, year)),
    );

    return json(200, {
      year,
      sites,
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: "Unable to load dashboard data" });
  }
}
