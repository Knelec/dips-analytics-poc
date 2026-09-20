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
        Authorization:
          `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `${path.split("?")[0]}: ${await response.text()}`,
    );
  }

  return response.json();
}

const siteDefinitions = [
  { location_id: 1, name: "Prince Albert" },
  { location_id: 48, name: "North Battleford Bulk" },
  { location_id: 63, name: "Meadow Lake" },
  { location_id: 47, name: "The Pas" },
];

function productGroup(product) {
  const name = String(product || "").toLowerCase();

  if (
    /(regular|premium|gasoline|unleaded|mogas)/.test(name)
  ) {
    return "gasoline";
  }

  if (/diesel/.test(name)) {
    return "diesel";
  }

  return "other";
}

function createMonthlyTotals(deliveries) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    all: 0,
    gasoline: 0,
    diesel: 0,
    other: 0,
    deliveries: 0,
  }));

  let recordedSince = null;
  let latestDelivery = null;

  deliveries.forEach((delivery) => {
    if (!delivery.end_at) return;

    const date = new Date(delivery.end_at);

    if (Number.isNaN(date.getTime())) return;

    const monthIndex = date.getMonth();
    const amount = Number(delivery.amount || 0);
    const group = productGroup(delivery.product);

    months[monthIndex].all += amount;
    months[monthIndex][group] += amount;
    months[monthIndex].deliveries += 1;

    if (
      !recordedSince ||
      date.getTime() < new Date(recordedSince).getTime()
    ) {
      recordedSince = delivery.end_at;
    }

    if (
      !latestDelivery ||
      date.getTime() > new Date(latestDelivery).getTime()
    ) {
      latestDelivery = delivery.end_at;
    }
  });

  return {
    recorded_since: recordedSince,
    latest_delivery: latestDelivery,
    delivery_count: deliveries.length,
    months: months.map((month) => ({
      ...month,
      all: Math.round(month.all),
      gasoline: Math.round(month.gasoline),
      diesel: Math.round(month.diesel),
      other: Math.round(month.other),
    })),
  };
}

async function loadSite(site, year) {
  const nextYear = year + 1;

  const [
    throughput,
    statusRows,
    alarms,
    deliveries,
  ] = await Promise.all([
    query(
      `dips_annual_tank_throughput?select=*&location_id=eq.${site.location_id}&calendar_year=eq.${year}&order=tank.asc`,
    ),
    query(
      `dips_site_status?select=site_name,last_seen_at,updated_at&location_id=eq.${site.location_id}&limit=1`,
    ),
    query(
      `dips_alarm_state?select=alarm_key,alarm_text,category,last_seen_at&location_id=eq.${site.location_id}&active=eq.true&order=last_seen_at.desc`,
    ),
    query(
      `dips_deliveries?select=end_at,product,amount&location_id=eq.${site.location_id}&end_at=gte.${year}-01-01&end_at=lt.${nextYear}-01-01&order=end_at.asc`,
    ),
  ]);

  const status = statusRows[0] || null;

  const lastReport =
    status?.last_seen_at || status?.updated_at || null;

  const online = lastReport
    ? Date.now() - new Date(lastReport).getTime() <
      60 * 60 * 1000
    : false;

  return {
    site: {
      location_id: site.location_id,
      name: status?.site_name || site.name,
    },
    year,
    throughput,
    monthly: createMonthlyTotals(deliveries),
    status: status
      ? { ...status, online }
      : { online: false },
    alarms,
  };
}

function createRegionalMonthly(sites) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    all: 0,
    gasoline: 0,
    diesel: 0,
    other: 0,
    deliveries: 0,
  }));

  let recordedSince = null;
  let latestDelivery = null;
  let deliveryCount = 0;

  sites.forEach((site) => {
    const monthly = site.monthly;

    deliveryCount += monthly.delivery_count || 0;

    if (
      monthly.recorded_since &&
      (
        !recordedSince ||
        new Date(monthly.recorded_since).getTime() <
          new Date(recordedSince).getTime()
      )
    ) {
      recordedSince = monthly.recorded_since;
    }

    if (
      monthly.latest_delivery &&
      (
        !latestDelivery ||
        new Date(monthly.latest_delivery).getTime() >
          new Date(latestDelivery).getTime()
      )
    ) {
      latestDelivery = monthly.latest_delivery;
    }

    monthly.months.forEach((month, index) => {
      months[index].all += Number(month.all || 0);
      months[index].gasoline += Number(
        month.gasoline || 0,
      );
      months[index].diesel += Number(month.diesel || 0);
      months[index].other += Number(month.other || 0);
      months[index].deliveries += Number(
        month.deliveries || 0,
      );
    });
  });

  return {
    recorded_since: recordedSince,
    latest_delivery: latestDelivery,
    delivery_count: deliveryCount,
    months,
  };
}

export async function handler(event) {
  if (!authorized(event)) {
    return json(401, { error: "Unauthorized" });
  }

  const year = new Date().getFullYear();

  try {
    const sites = await Promise.all(
      siteDefinitions.map((site) =>
        loadSite(site, year),
      ),
    );

    return json(200, {
      year,
      monthly: createRegionalMonthly(sites),
      sites,
    });
  } catch (error) {
    console.error(error);

    return json(500, {
      error: "Unable to load dashboard data",
    });
  }
}
