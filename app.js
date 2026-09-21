const $ = (id) => document.getElementById(id);

let authorization = sessionStorage.getItem("dipsAuth") || "";
let dashboardData = null;
let currentView = "overview";
let chartProduct = "all";
let chartData = null;
let chartTitle = "Monthly deliveries";

const fmt = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 0,
});

function litres(value) {
  return `${fmt.format(Number(value || 0))} L`;
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function displayDate(value) {
  if (!value) return "Unknown";

  return new Date(value).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function lastReport(site) {
  return (
    site.status?.last_seen_at ||
    site.status?.updated_at ||
    null
  );
}

function siteOnline(site) {
  return site.status?.online === true;
}

function reportAge(value) {
  if (!value) return "No report received";

  const minutes = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(value).getTime()) / 60000,
    ),
  );

  if (minutes < 1) return "Reported just now";
  if (minutes < 60) return `Reported ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `Reported ${hours} hr${
      hours === 1 ? "" : "s"
    } ago`;
  }

  const days = Math.floor(hours / 24);

  return `Reported ${days} day${
    days === 1 ? "" : "s"
  } ago`;
}

function siteRecordedSince(site) {
  const dates = (site.throughput || [])
    .map((tank) => tank.recorded_since)
    .filter(Boolean)
    .map((date) => new Date(date).getTime());

  return dates.length
    ? new Date(Math.min(...dates))
    : null;
}

function allThroughput() {
  return dashboardData.sites.flatMap(
    (site) => site.throughput || [],
  );
}

function allAlarms() {
  return dashboardData.sites.flatMap((site) =>
    (site.alarms || []).map((alarm) => ({
      ...alarm,
      siteName: site.site.name,
      locationId: site.site.location_id,
    })),
  );
}

async function request() {
  const response = await fetch(
    "/.netlify/functions/dashboard",
    {
      headers: {
        Authorization: authorization,
      },
    },
  );

  if (response.status === 401) {
    throw new Error("Incorrect username or password");
  }

  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({}));

    throw new Error(
      result.error ||
        "Dashboard data could not be loaded",
    );
  }

  return response.json();
}

const panels = [
  ...document.querySelectorAll(".panel"),
];

const throughputPanel = panels[0];
const alarmsPanel = panels[1];

const navButtons = [
  ...document.querySelectorAll("nav button"),
];

function ensureMonthlyChart() {
  if ($("monthly-panel")) return;

  const style = document.createElement("style");

  style.textContent = `
    .chart-controls {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .chart-filter {
      border: 1px solid #475569;
      background: #0f172a;
      color: #94a3b8;
      border-radius: 999px;
      padding: 7px 12px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .chart-filter.active {
      border-color: #22d3ee;
      background: rgba(34, 211, 238, 0.14);
      color: #a5f3fc;
    }

    .chart-note {
      margin: 0 0 16px;
      color: #94a3b8;
      font-size: 13px;
    }

    .monthly-chart-wrap {
      overflow-x: auto;
      padding: 8px 0 2px;
    }

    .monthly-chart {
      display: grid;
      grid-template-columns:
        repeat(12, minmax(58px, 1fr));
      align-items: end;
      gap: 10px;
      min-width: 820px;
      height: 280px;
      border-bottom: 1px solid #334155;
    }

    .month-column {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: stretch;
      gap: 7px;
      text-align: center;
    }

    .month-value {
      min-height: 34px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.15;
    }

    .month-track {
      height: 190px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      border-radius: 7px 7px 0 0;
      background: rgba(15, 23, 42, 0.55);
    }

    .month-bar {
      width: 68%;
      min-height: 3px;
      border-radius: 7px 7px 2px 2px;
      background:
        linear-gradient(180deg, #22d3ee, #0284c7);
      box-shadow:
        0 0 18px rgba(34, 211, 238, 0.2);
    }

    .month-column.unavailable .month-bar {
      min-height: 0;
      background: transparent;
      box-shadow: none;
    }

    .month-column.unavailable .month-track {
      background:
        repeating-linear-gradient(
          135deg,
          rgba(71, 85, 105, 0.18),
          rgba(71, 85, 105, 0.18) 5px,
          transparent 5px,
          transparent 10px
        );
    }

    .month-column.unavailable .month-value {
      color: #64748b;
    }

    .month-label {
      padding-bottom: 8px;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    @media (max-width: 700px) {
      .monthly-chart {
        height: 250px;
      }

      .month-track {
        height: 160px;
      }
    }
  `;

  document.head.appendChild(style);

  const panel = document.createElement("section");

  panel.id = "monthly-panel";
  panel.className = "panel";

  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">DELIVERY TRENDS</p>
        <h2 id="monthly-title">
          Monthly deliveries
        </h2>
      </div>

      <div
        class="chart-controls"
        aria-label="Chart product filter"
      >
        <button
          class="chart-filter active"
          data-product="all"
          type="button"
        >
          All products
        </button>

        <button
          class="chart-filter"
          data-product="gasoline"
          type="button"
        >
          Gasoline
        </button>

        <button
          class="chart-filter"
          data-product="diesel"
          type="button"
        >
          Diesel
        </button>
      </div>
    </div>

    <p id="monthly-note" class="chart-note"></p>

    <div class="monthly-chart-wrap">
      <div
        id="monthly-chart"
        class="monthly-chart"
      ></div>
    </div>
  `;

  document
    .querySelector(".stats")
    .insertAdjacentElement("afterend", panel);

  panel
    .querySelectorAll(".chart-filter")
    .forEach((button) => {
      button.addEventListener("click", () => {
        chartProduct = button.dataset.product;

        panel
          .querySelectorAll(".chart-filter")
          .forEach((item) => {
            item.classList.toggle(
              "active",
              item === button,
            );
          });

        drawMonthlyChart();
      });
    });
}

function drawMonthlyChart() {
  const panel = $("monthly-panel");

  if (!panel || !chartData) return;

  const months = chartData.months || [];

  const values = months.map((month) =>
    Number(month[chartProduct] || 0),
  );

  const maximum = Math.max(...values, 1);

  const startMonth = chartData.recorded_since
    ? new Date(chartData.recorded_since).getMonth()
    : null;

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  $("monthly-title").textContent = chartTitle;

  $("monthly-note").textContent =
    chartData.recorded_since
      ? `Delivery records available since ${displayDate(
          chartData.recorded_since,
        )} · ${fmt.format(
          chartData.delivery_count || 0,
        )} deliveries recorded`
      : "No delivery history is available yet.";

  $("monthly-chart").innerHTML = months
    .map((month, index) => {
      const value = values[index];

      const unavailable =
        startMonth === null || index < startMonth;

      const height = unavailable
        ? 0
        : Math.max(
            value > 0 ? 4 : 0,
            (value / maximum) * 100,
          );

      const valueLabel = unavailable
        ? "Not available"
        : litres(value);

      return `
        <div
          class="month-column ${
            unavailable ? "unavailable" : ""
          }"
          title="${monthNames[index]}: ${valueLabel}"
        >
          <div class="month-value">
            ${unavailable ? "—" : litres(value)}
          </div>

          <div class="month-track">
            <div
              class="month-bar"
              style="height:${height}%"
            ></div>
          </div>

          <div class="month-label">
            ${monthNames[index]}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderMonthlyChart(monthly, title) {
  ensureMonthlyChart();

  chartData = monthly || {
    months: [],
    delivery_count: 0,
    recorded_since: null,
  };

  chartTitle = title;

  $("monthly-panel").hidden = false;

  drawMonthlyChart();
}

ensureMonthlyChart();

navButtons.forEach((button) => {
  button.disabled = false;

  button.addEventListener("click", () => {
    currentView =
      button.textContent.trim().toLowerCase();

    render();
  });
});

function setNavigation(view) {
  navButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.textContent.trim().toLowerCase() ===
        view,
    );
  });
}

function setHeader(eyebrow, title) {
  document.querySelector(
    "main header .eyebrow",
  ).textContent = eyebrow;

  document.querySelector(
    "main header h1",
  ).textContent = title;
}

function setPanelHeading(panel, eyebrow, title) {
  panel.querySelector(
    ".panel-head .eyebrow",
  ).textContent = eyebrow;

  panel.querySelector(
    ".panel-head h2",
  ).textContent = title;
}

function setStats(gasoline, total, alarms, tanks) {
  $("gas-total").textContent = litres(gasoline);
  $("all-total").textContent = litres(total);
  $("alarm-count").textContent = alarms;
  $("tank-count").textContent = tanks;

  const statCards = [
    ...document.querySelectorAll(".stats article"),
  ];

  if (statCards[0]) {
    statCards[0].querySelector(
      "span",
    ).textContent = "Gasoline recorded";

    statCards[0].querySelector(
      "small",
    ).textContent = "Available delivery history";
  }

  if (statCards[1]) {
    statCards[1].querySelector(
      "span",
    ).textContent = "All products recorded";

    statCards[1].querySelector(
      "small",
    ).textContent = "Available delivery history";
  }
}

function renderAlarmList(
  alarms,
  includeSite = true,
) {
  $("alarms").innerHTML =
    alarms
      .map(
        (alarm) => `
          <div class="alarm">
            <span class="alarm-icon">!</span>

            <div>
              <strong>
                ${esc(
                  alarm.alarm_text ||
                    alarm.alarm_key,
                )}
              </strong>

              <br>

              <small>
                ${
                  includeSite && alarm.siteName
                    ? `${esc(alarm.siteName)} · `
                    : ""
                }

                ${esc(
                  alarm.category || "Alarm",
                )}
              </small>
            </div>

            <small>
              ${
                alarm.last_seen_at
                  ? new Date(
                      alarm.last_seen_at,
                    ).toLocaleString("en-CA")
                  : ""
              }
            </small>
          </div>
        `,
      )
      .join("") ||
    '<div class="empty">No active critical alarms.</div>';
}

function renderSiteCards() {
  $("tanks").innerHTML = dashboardData.sites
    .map((site) => {
      const throughput =
        site.throughput || [];

      const alarms = site.alarms || [];

      const total = throughput.reduce(
        (sum, tank) =>
          sum +
          Number(tank.delivered_litres || 0),
        0,
      );

      const last = lastReport(site);

      const recordedSince =
        siteRecordedSince(site);

      return `
        <article
          class="tank site-card"
          data-location="${site.site.location_id}"
          style="cursor:pointer;${
            siteOnline(site)
              ? ""
              : "border-color:rgba(248,113,113,.65);"
          }"
        >
          <div class="tank-head">
            <div>
              <span class="eyebrow">
                LOCATION ${site.site.location_id}
              </span>

              <h3>${esc(site.site.name)}</h3>
            </div>

            <span
              class="badge ${
                siteOnline(site) ? "gas" : ""
              }"
            >
              ${
                siteOnline(site)
                  ? "Online"
                  : "Offline"
              }
            </span>
          </div>

          <div class="tank-values">
            <div>
              <span>
                Recorded since
                ${displayDate(recordedSince)}
              </span>

              <strong>${litres(total)}</strong>
            </div>

            <div>
              <span>Tanks reporting</span>

              <strong>
                ${throughput.length}
              </strong>
            </div>
          </div>

          <div class="progress-label">
            <span>
              ${alarms.length} active alarm${
                alarms.length === 1 ? "" : "s"
              }
            </span>

            <span>
              ${
                last
                  ? reportAge(last)
                  : "No report received"
              }
            </span>
          </div>
        </article>
      `;
    })
    .join("");

  document
    .querySelectorAll(".site-card")
    .forEach((card) => {
      card.addEventListener("click", () => {
        renderSite(
          Number(card.dataset.location),
        );
      });
    });
}

function calculateTotals(throughput) {
  const gasoline = throughput
    .filter((tank) => tank.is_gasoline)
    .reduce(
      (sum, tank) =>
        sum +
        Number(tank.delivered_litres || 0),
      0,
    );

  const total = throughput.reduce(
    (sum, tank) =>
      sum +
      Number(tank.delivered_litres || 0),
    0,
  );

  return { gasoline, total };
}

function renderOverview() {
  currentView = "overview";

  setNavigation("overview");

  setHeader(
    "REGIONAL BULK FACILITIES",
    "Regional Bulk Facility Overview",
  );

  const sites = dashboardData.sites;
  const throughput = allThroughput();
  const alarms = allAlarms();

  const onlineCount =
    sites.filter(siteOnline).length;

  const totals =
    calculateTotals(throughput);

  $("status").textContent =
    `${onlineCount} of ${sites.length} sites online`;

  $("status-banner").classList.toggle(
    "offline",
    onlineCount !== sites.length,
  );

  $("last-seen").textContent =
    `${sites.length} monitored locations`;

  setStats(
    totals.gasoline,
    totals.total,
    alarms.length,
    throughput.length,
  );

  throughputPanel.hidden = false;
  alarmsPanel.hidden = false;

  setPanelHeading(
    throughputPanel,
    "REGIONAL SITES",
    "Site operations overview",
  );

  setPanelHeading(
    alarmsPanel,
    "ACTIVE CONDITIONS",
    "Critical alarms",
  );

  $("year").textContent =
    dashboardData.year;

  renderMonthlyChart(
    dashboardData.monthly,
    "Regional monthly deliveries",
  );

  renderSiteCards();
  renderAlarmList(alarms);
}

function renderSites() {
  currentView = "sites";

  setNavigation("sites");

  setHeader(
    "ALL LOCATIONS",
    "Sites overview",
  );

  const sites = dashboardData.sites;
  const throughput = allThroughput();
  const alarms = allAlarms();

  const onlineCount =
    sites.filter(siteOnline).length;

  const totals =
    calculateTotals(throughput);

  $("status").textContent =
    `${onlineCount} of ${sites.length} sites online`;

  $("status-banner").classList.toggle(
    "offline",
    onlineCount !== sites.length,
  );

  $("last-seen").textContent =
    "Select a site to view tank details";

  setStats(
    totals.gasoline,
    totals.total,
    alarms.length,
    throughput.length,
  );

  throughputPanel.hidden = false;
  alarmsPanel.hidden = true;

  setPanelHeading(
    throughputPanel,
    "MONITORED LOCATIONS",
    "Select a site",
  );

  $("year").textContent =
    dashboardData.year;

  renderMonthlyChart(
    dashboardData.monthly,
    "Regional monthly deliveries",
  );

  renderSiteCards();
}

function renderSite(locationId) {
  const site = dashboardData.sites.find(
    (item) =>
      item.site.location_id === locationId,
  );

  if (!site) return;

  setNavigation("sites");

  setHeader(
    `LOCATION ${site.site.location_id}`,
    site.site.name,
  );

  const throughput =
    site.throughput || [];

  const alarms = site.alarms || [];

  const last = lastReport(site);

  const totals =
    calculateTotals(throughput);

  $("status").textContent =
    siteOnline(site)
      ? "Online"
      : "Offline";

  $("status-banner").classList.toggle(
    "offline",
    !siteOnline(site),
  );

  $("last-seen").textContent = last
    ? `Last report ${new Date(
        last,
      ).toLocaleString("en-CA")}`
    : "No recent report";

  setStats(
    totals.gasoline,
    totals.total,
    alarms.length,
    throughput.length,
  );

  throughputPanel.hidden = false;
  alarmsPanel.hidden = false;

  setPanelHeading(
    throughputPanel,
    "RECORDED THROUGHPUT",
    "Delivered litres by tank",
  );

  setPanelHeading(
    alarmsPanel,
    "ACTIVE CONDITIONS",
    "Critical alarms",
  );

  $("year").textContent =
    dashboardData.year;

  renderMonthlyChart(
    site.monthly,
    `${site.site.name} monthly deliveries`,
  );

  $("tanks").innerHTML =
    throughput
      .map((tank) => {
        const percent = Math.max(
          0,
          Number(
            tank.compliance_percent || 0,
          ),
        );

        return `
          <article class="tank">
            <div class="tank-head">
              <div>
                <span class="eyebrow">
                  TANK ${esc(tank.tank)}
                </span>

                <h3>
                  ${esc(
                    tank.product || "Unknown",
                  )}
                </h3>
              </div>

              <span
                class="badge ${
                  tank.is_gasoline ? "gas" : ""
                }"
              >
                ${
                  tank.is_gasoline
                    ? "Recorded progress"
                    : "Information only"
                }
              </span>
            </div>

            <div class="tank-values">
              <div>
                <span>
                  Recorded since
                  ${displayDate(
                    tank.recorded_since,
                  )}
                </span>

                <strong>
                  ${litres(
                    tank.delivered_litres,
                  )}
                </strong>
              </div>

              <div>
                <span>Current volume</span>

                <strong>
                  ${
                    tank.current_volume_litres ==
                    null
                      ? "—"
                      : litres(
                          tank.current_volume_litres,
                        )
                  }
                </strong>
              </div>
            </div>

            ${
              tank.is_gasoline
                ? `
                  <div class="progress">
                    <i
                      style="width:${Math.min(
                        percent,
                        100,
                      )}%"
                    ></i>
                  </div>

                  <div class="progress-label">
                    <span>
                      ${percent.toFixed(2)}% of
                      2,000,000 L recorded
                    </span>

                    <span>
                      ${litres(
                        tank.compliance_remaining_litres,
                      )} to limit*
                    </span>
                  </div>

                  <small
                    style="
                      display:block;
                      margin-top:10px;
                      color:#fbbf24;
                    "
                  >
                    *Based on recorded deliveries
                    only. Historical baseline has
                    not been entered.
                  </small>
                `
                : ""
            }
          </article>
        `;
      })
      .join("") ||
    '<div class="empty">No throughput records found.</div>';

  renderAlarmList(
    alarms.map((alarm) => ({
      ...alarm,
      siteName: site.site.name,
    })),
    false,
  );
}

function renderAlarms() {
  currentView = "alarms";

  setNavigation("alarms");

  setHeader(
    "ALL LOCATIONS",
    "Active alarms",
  );

  const alarms = allAlarms();
  const sites = dashboardData.sites;

  const affectedSites = new Set(
    alarms.map((alarm) => alarm.locationId),
  ).size;

  $("status").textContent =
    alarms.length === 0
      ? "No active critical alarms"
      : `${alarms.length} active alarm${
          alarms.length === 1 ? "" : "s"
        }`;

  $("status-banner").classList.toggle(
    "offline",
    alarms.length > 0,
  );

  $("last-seen").textContent =
    alarms.length === 0
      ? `${sites.length} sites monitored`
      : `${affectedSites} site${
          affectedSites === 1 ? "" : "s"
        } affected`;

  setStats(
    0,
    0,
    alarms.length,
    sites.length,
  );

  throughputPanel.hidden = true;
  alarmsPanel.hidden = false;
  $("monthly-panel").hidden = true;

  setPanelHeading(
    alarmsPanel,
    "ACTIVE CONDITIONS",
    "Critical alarms by site",
  );

  renderAlarmList(alarms);
}

function render() {
  if (!dashboardData) return;

  if (currentView === "sites") {
    renderSites();
  } else if (currentView === "alarms") {
    renderAlarms();
  } else {
    renderOverview();
  }
}

async function load() {
  document.body.classList.add("loading");

  $("page-error").textContent = "";

  try {
    dashboardData = await request();
    render();
  } catch (error) {
    $("page-error").textContent =
      error.message;
  } finally {
    document.body.classList.remove(
      "loading",
    );
  }
}

function showDashboard() {
  $("login").hidden = true;
  $("login").style.display = "none";
  $("app").hidden = false;

  ensureLogoutButton();
}

function showLogin(message = "") {
  authorization = "";
  dashboardData = null;
  currentView = "overview";

  sessionStorage.removeItem("dipsAuth");

  $("app").hidden = true;
  $("login").hidden = false;

  $("login").style.removeProperty(
    "display",
  );

  $("password").value = "";

  $("login-error").textContent =
    message;
}

function ensureLogoutButton() {
  if ($("logout")) return;

  const refresh = $("refresh");

  const actions =
    document.createElement("div");

  actions.style.cssText =
    "display:flex;" +
    "align-items:center;" +
    "gap:10px;" +
    "flex-wrap:wrap";

  refresh.parentNode.insertBefore(
    actions,
    refresh,
  );

  actions.appendChild(refresh);

  const logout =
    document.createElement("button");

  logout.id = "logout";
  logout.type = "button";
  logout.textContent = "Logout";

  logout.style.cssText =
    "background:transparent;" +
    "color:#cbd5e1;" +
    "border:1px solid #475569;" +
    "border-radius:8px;" +
    "padding:10px 16px;" +
    "font:inherit;" +
    "font-weight:700;" +
    "cursor:pointer";

  logout.addEventListener(
    "click",
    () => showLogin(),
  );

  actions.appendChild(logout);
}

$("login-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    authorization =
      "Basic " +
      btoa(
        `${$("username").value}:${
          $("password").value
        }`,
      );

    try {
      dashboardData = await request();

      sessionStorage.setItem(
        "dipsAuth",
        authorization,
      );

      $("login-error").textContent = "";

      showDashboard();
      renderOverview();
    } catch (error) {
      $("login-error").textContent =
        error.message;
    }
  },
);

$("refresh").addEventListener(
  "click",
  load,
);

if (authorization) {
  showDashboard();

  load().then(() => {
    if (!dashboardData) {
      showLogin(
        "Your session has expired. Please sign in again.",
      );
    }
  });
}


let alarmHistoryFilter = "all";

function getRegionalAlarmHistory() {
  return dashboardData.sites
    .flatMap((site) =>
      (site.alarm_history || []).map((alarm) => ({
        ...alarm,
        siteName: site.site.name,
        locationId: site.site.location_id,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.last_seen_at || 0).getTime() -
        new Date(a.last_seen_at || 0).getTime(),
    );
}

function addAlarmHistoryStyles() {
  if ($("alarm-history-styles")) return;

  const style = document.createElement("style");

  style.id = "alarm-history-styles";

  style.textContent = `
    .alarm-history-tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .alarm-history-summary {
      color: #94a3b8;
      font-size: 13px;
    }

    .alarm-filter-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .alarm-filter {
      border: 1px solid #475569;
      background: #0f172a;
      color: #94a3b8;
      border-radius: 999px;
      padding: 7px 12px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .alarm-filter.active {
      border-color: #22d3ee;
      background: rgba(34, 211, 238, 0.14);
      color: #a5f3fc;
    }

    .alarm-history-row {
      align-items: center;
    }

    .alarm-history-row.cleared {
      border-color: rgba(52, 211, 153, 0.25);
    }

    .alarm-icon.cleared {
      background: rgba(52, 211, 153, 0.15);
      color: #6ee7b7;
    }

    .alarm-history-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 5px;
      text-align: right;
    }

    .alarm-state {
      display: inline-flex;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .alarm-state.active {
      background: rgba(248, 113, 113, 0.16);
      color: #fca5a5;
    }

    .alarm-state.cleared {
      background: rgba(52, 211, 153, 0.15);
      color: #6ee7b7;
    }

    .alarm-times {
      color: #94a3b8;
      font-size: 11px;
      line-height: 1.45;
    }

    @media (max-width: 700px) {
      .alarm-history-meta {
        align-items: flex-start;
        text-align: left;
      }
    }
  `;

  document.head.appendChild(style);
}

function renderRegionalAlarmHistory(history) {
  addAlarmHistoryStyles();

  const filtered = history.filter((alarm) => {
    if (alarmHistoryFilter === "active") {
      return alarm.active === true;
    }

    if (alarmHistoryFilter === "cleared") {
      return alarm.active !== true;
    }

    return true;
  });

  const activeCount = history.filter(
    (alarm) => alarm.active === true,
  ).length;

  const clearedCount =
    history.length - activeCount;

  $("alarms").innerHTML = `
    <div class="alarm-history-tools">
      <span class="alarm-history-summary">
        ${activeCount} active ·
        ${clearedCount} cleared ·
        ${history.length} total conditions
      </span>

      <div
        class="alarm-filter-group"
        aria-label="Alarm history filter"
      >
        <button
          type="button"
          class="alarm-filter ${
            alarmHistoryFilter === "all"
              ? "active"
              : ""
          }"
          data-history-filter="all"
        >
          All
        </button>

        <button
          type="button"
          class="alarm-filter ${
            alarmHistoryFilter === "active"
              ? "active"
              : ""
          }"
          data-history-filter="active"
        >
          Active
        </button>

        <button
          type="button"
          class="alarm-filter ${
            alarmHistoryFilter === "cleared"
              ? "active"
              : ""
          }"
          data-history-filter="cleared"
        >
          Cleared
        </button>
      </div>
    </div>

    ${
      filtered
        .map((alarm) => {
          const active =
            alarm.active === true;

          const firstSeen =
            alarm.first_seen_at
              ? new Date(
                  alarm.first_seen_at,
                ).toLocaleString("en-CA")
              : "Unknown";

          const lastSeen =
            alarm.last_seen_at
              ? new Date(
                  alarm.last_seen_at,
                ).toLocaleString("en-CA")
              : "Unknown";

          return `
            <div
              class="alarm alarm-history-row ${
                active ? "" : "cleared"
              }"
            >
              <span
                class="alarm-icon ${
                  active ? "" : "cleared"
                }"
              >
                ${active ? "!" : "✓"}
              </span>

              <div>
                <strong>
                  ${esc(
                    alarm.alarm_text ||
                      alarm.alarm_key,
                  )}
                </strong>

                <br>

                <small>
                  ${esc(alarm.siteName)} ·
                  ${esc(
                    alarm.category || "Alarm",
                  )}
                </small>
              </div>

              <div class="alarm-history-meta">
                <span
                  class="alarm-state ${
                    active
                      ? "active"
                      : "cleared"
                  }"
                >
                  ${
                    active
                      ? "Active"
                      : "Cleared"
                  }
                </span>

                <span class="alarm-times">
                  First detected: ${firstSeen}
                  <br>
                  ${
                    active
                      ? "Last seen"
                      : "Cleared"
                  }: ${lastSeen}
                </span>
              </div>
            </div>
          `;
        })
        .join("") ||
      '<div class="empty">No alarms match this filter.</div>'
    }
  `;

  document
    .querySelectorAll("[data-history-filter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        alarmHistoryFilter =
          button.dataset.historyFilter;

        renderRegionalAlarmHistory(history);
      });
    });
}

function renderAlarms() {
  currentView = "alarms";

  setNavigation("alarms");

  setHeader(
    "ALL LOCATIONS",
    "Alarm history",
  );

  const activeAlarms = allAlarms();
  const history = getRegionalAlarmHistory();
  const sites = dashboardData.sites;

  const affectedSites = new Set(
    activeAlarms.map(
      (alarm) => alarm.locationId,
    ),
  ).size;

  $("status").textContent =
    activeAlarms.length === 0
      ? "No active critical alarms"
      : `${activeAlarms.length} active alarm${
          activeAlarms.length === 1
            ? ""
            : "s"
        }`;

  $("status-banner").classList.toggle(
    "offline",
    activeAlarms.length > 0,
  );

  $("last-seen").textContent =
    activeAlarms.length === 0
      ? `${history.length} known alarm conditions across ${sites.length} sites`
      : `${affectedSites} site${
          affectedSites === 1 ? "" : "s"
        } currently affected`;

  setStats(
    0,
    0,
    activeAlarms.length,
    sites.length,
  );

  throughputPanel.hidden = true;
  alarmsPanel.hidden = false;
  $("monthly-panel").hidden = true;

  setPanelHeading(
    alarmsPanel,
    "ALARM HISTORY",
    "Regional alarm history",
  );

  renderRegionalAlarmHistory(history);
}


function csvCell(value) {
  const text =
    value === null || value === undefined
      ? ""
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      row.map(csvCell).join(","),
    ),
  ];

  const blob = new Blob(
    ["\uFEFF" + lines.join("\r\n")],
    {
      type: "text/csv;charset=utf-8",
    },
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function exportSiteSummary() {
  const headers = [
    "Location ID",
    "Site Name",
    "Status",
    "Last Report",
    "Records Available Since",
    "Tanks Reporting",
    "Active Alarms",
    "Gasoline Recorded (L)",
    "All Products Recorded (L)",
  ];

  const rows = dashboardData.sites.map((site) => {
    const throughput =
      site.throughput || [];

    const gasoline = throughput
      .filter((tank) => tank.is_gasoline)
      .reduce(
        (sum, tank) =>
          sum +
          Number(
            tank.delivered_litres || 0,
          ),
        0,
      );

    const total = throughput.reduce(
      (sum, tank) =>
        sum +
        Number(
          tank.delivered_litres || 0,
        ),
      0,
    );

    return [
      site.site.location_id,
      site.site.name,
      siteOnline(site)
        ? "Online"
        : "Offline",
      lastReport(site) || "",
      site.monthly?.recorded_since || "",
      throughput.length,
      (site.alarms || []).length,
      Math.round(gasoline),
      Math.round(total),
    ];
  });

  downloadCsv(
    `regional-site-summary-${dashboardData.year}.csv`,
    headers,
    rows,
  );
}

function exportMonthlyDeliveries() {
  const headers = [
    "Location ID",
    "Site Name",
    "Year",
    "Month",
    "Data Available",
    "All Products (L)",
    "Gasoline (L)",
    "Diesel (L)",
    "Other Products (L)",
    "Delivery Count",
  ];

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const rows = dashboardData.sites.flatMap(
    (site) => {
      const recordedSince =
        site.monthly?.recorded_since
          ? new Date(
              site.monthly.recorded_since,
            )
          : null;

      const firstMonth =
        recordedSince?.getMonth();

      return (
        site.monthly?.months || []
      ).map((month, index) => {
        const available =
          firstMonth !== undefined &&
          firstMonth !== null &&
          index >= firstMonth;

        return [
          site.site.location_id,
          site.site.name,
          dashboardData.year,
          monthNames[index],
          available ? "Yes" : "No",
          available ? month.all : "",
          available
            ? month.gasoline
            : "",
          available ? month.diesel : "",
          available ? month.other : "",
          available
            ? month.deliveries
            : "",
        ];
      });
    },
  );

  downloadCsv(
    `monthly-deliveries-${dashboardData.year}.csv`,
    headers,
    rows,
  );
}

function exportTankThroughput() {
  const headers = [
    "Location ID",
    "Site Name",
    "Year",
    "Tank",
    "Product",
    "Product ID",
    "Recorded Since",
    "Latest Delivery",
    "Delivery Count",
    "Delivered Litres",
    "Temperature Compensated Litres",
    "Current Volume (L)",
    "Gasoline",
    "Recorded Percent of Limit",
    "Recorded Litres Remaining",
    "Limit Reached",
  ];

  const rows = dashboardData.sites.flatMap(
    (site) =>
      (site.throughput || []).map(
        (tank) => [
          site.site.location_id,
          site.site.name,
          dashboardData.year,
          tank.tank,
          tank.product || "",
          tank.product_id || "",
          tank.recorded_since || "",
          tank.latest_delivery || "",
          tank.delivery_count || 0,
          Math.round(
            Number(
              tank.delivered_litres || 0,
            ),
          ),
          Math.round(
            Number(
              tank.delivered_tc_litres ||
                0,
            ),
          ),
          tank.current_volume_litres ??
            "",
          tank.is_gasoline
            ? "Yes"
            : "No",
          tank.compliance_percent ?? "",
          tank.compliance_remaining_litres ??
            "",
          tank.compliance_limit_reached
            ? "Yes"
            : "No",
        ],
      ),
  );

  downloadCsv(
    `tank-throughput-${dashboardData.year}.csv`,
    headers,
    rows,
  );
}

function exportAlarmHistory() {
  const headers = [
    "Location ID",
    "Site Name",
    "Status",
    "Alarm Key",
    "Alarm Description",
    "Category",
    "First Detected",
    "Last Seen or Cleared",
  ];

  const rows = dashboardData.sites
    .flatMap((site) =>
      (site.alarm_history || []).map(
        (alarm) => [
          site.site.location_id,
          site.site.name,
          alarm.active
            ? "Active"
            : "Cleared",
          alarm.alarm_key || "",
          alarm.alarm_text || "",
          alarm.category || "",
          alarm.first_seen_at || "",
          alarm.last_seen_at || "",
        ],
      ),
    )
    .sort(
      (a, b) =>
        new Date(b[7] || 0).getTime() -
        new Date(a[7] || 0).getTime(),
    );

  downloadCsv(
    `alarm-history-${dashboardData.year}.csv`,
    headers,
    rows,
  );
}

function ensureExportMenu() {
  if ($("export-menu")) return;

  const logout = $("logout");

  if (!logout) return;

  const style =
    document.createElement("style");

  style.id = "export-menu-styles";

  style.textContent = `
    .export-menu {
      position: relative;
    }

    .export-button {
      border: 1px solid #0891b2;
      background:
        rgba(8, 145, 178, 0.16);
      color: #a5f3fc;
      border-radius: 8px;
      padding: 10px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .export-options {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 100;
      display: none;
      min-width: 230px;
      padding: 8px;
      border: 1px solid #475569;
      border-radius: 10px;
      background: #0f172a;
      box-shadow:
        0 18px 45px
        rgba(0, 0, 0, 0.4);
    }

    .export-options.open {
      display: grid;
      gap: 4px;
    }

    .export-options button {
      width: 100%;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #cbd5e1;
      padding: 10px 12px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .export-options button:hover {
      background:
        rgba(34, 211, 238, 0.12);
      color: #a5f3fc;
    }
  `;

  document.head.appendChild(style);

  const wrapper =
    document.createElement("div");

  wrapper.id = "export-menu";
  wrapper.className = "export-menu";

  wrapper.innerHTML = `
    <button
      id="export-button"
      class="export-button"
      type="button"
    >
      Export ▾
    </button>

    <div
      id="export-options"
      class="export-options"
    >
      <button
        type="button"
        data-export="sites"
      >
        Site Summary CSV
      </button>

      <button
        type="button"
        data-export="monthly"
      >
        Monthly Deliveries CSV
      </button>

      <button
        type="button"
        data-export="tanks"
      >
        Tank Throughput CSV
      </button>

      <button
        type="button"
        data-export="alarms"
      >
        Alarm History CSV
      </button>
    </div>
  `;

  logout.parentElement.insertBefore(
    wrapper,
    logout,
  );

  $("export-button").addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      $("export-options").classList.toggle(
        "open",
      );
    },
  );

  wrapper
    .querySelectorAll("[data-export]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const type =
            button.dataset.export;

          if (type === "sites") {
            exportSiteSummary();
          }

          if (type === "monthly") {
            exportMonthlyDeliveries();
          }

          if (type === "tanks") {
            exportTankThroughput();
          }

          if (type === "alarms") {
            exportAlarmHistory();
          }

          $("export-options").classList.remove(
            "open",
          );
        },
      );
    });

  document.addEventListener(
    "click",
    (event) => {
      if (!wrapper.contains(event.target)) {
        $("export-options")?.classList.remove(
          "open",
        );
      }
    },
  );
}

function showDashboard() {
  $("login").hidden = true;
  $("login").style.display = "none";
  $("app").hidden = false;

  ensureLogoutButton();
  ensureExportMenu();
}

function pdfValue(value) {
  return esc(
    value === null ||
      value === undefined ||
      value === ""
      ? "—"
      : value,
  );
}

function generateRegionalPdf() {
  const reportWindow = window.open(
    "",
    "_blank",
  );

  if (!reportWindow) {
    alert(
      "Please allow pop-ups for this dashboard, then try the PDF export again.",
    );

    return;
  }

  const generatedAt =
    new Date().toLocaleString("en-CA");

  const logoUrl = new URL(
    "suncor-energy-logo-png-transparent.png",
    window.location.href,
  ).href;

  const sites = dashboardData.sites;
  const allTanks = allThroughput();
  const activeAlarms = allAlarms();

  const gasolineTotal = allTanks
    .filter((tank) => tank.is_gasoline)
    .reduce(
      (sum, tank) =>
        sum +
        Number(
          tank.delivered_litres || 0,
        ),
      0,
    );

  const allProductsTotal = allTanks.reduce(
    (sum, tank) =>
      sum +
      Number(
        tank.delivered_litres || 0,
      ),
    0,
  );

  const onlineCount =
    sites.filter(siteOnline).length;

  const siteRows = sites
    .map((site) => {
      const throughput =
        site.throughput || [];

      const total = throughput.reduce(
        (sum, tank) =>
          sum +
          Number(
            tank.delivered_litres || 0,
          ),
        0,
      );

      return `
        <tr>
          <td>${pdfValue(
            site.site.location_id,
          )}</td>

          <td>
            <strong>
              ${pdfValue(site.site.name)}
            </strong>
          </td>

          <td>
            <span
              class="status ${
                siteOnline(site)
                  ? "online"
                  : "offline"
              }"
            >
              ${
                siteOnline(site)
                  ? "Online"
                  : "Offline"
              }
            </span>
          </td>

          <td>
            ${pdfValue(
              lastReport(site)
                ? new Date(
                    lastReport(site),
                  ).toLocaleString("en-CA")
                : "",
            )}
          </td>

          <td>
            ${pdfValue(
              site.monthly?.recorded_since
                ? displayDate(
                    site.monthly
                      .recorded_since,
                  )
                : "",
            )}
          </td>

          <td class="number">
            ${throughput.length}
          </td>

          <td class="number">
            ${(site.alarms || []).length}
          </td>

          <td class="number">
            ${litres(total)}
          </td>
        </tr>
      `;
    })
    .join("");

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthlyRows = (
    dashboardData.monthly?.months || []
  )
    .map(
      (month, index) => `
        <tr>
          <td>
            ${monthNames[index]}
          </td>

          <td class="number">
            ${litres(month.all)}
          </td>

          <td class="number">
            ${litres(month.gasoline)}
          </td>

          <td class="number">
            ${litres(month.diesel)}
          </td>

          <td class="number">
            ${litres(month.other)}
          </td>

          <td class="number">
            ${month.deliveries}
          </td>
        </tr>
      `,
    )
    .join("");

  const siteTankSections = sites
    .map((site) => {
      const tankRows = (
        site.throughput || []
      )
        .map(
          (tank) => `
            <tr>
              <td>${pdfValue(tank.tank)}</td>

              <td>
                ${pdfValue(
                  tank.product ||
                    "Unknown",
                )}
              </td>

              <td>
                ${pdfValue(
                  tank.recorded_since
                    ? displayDate(
                        tank.recorded_since,
                      )
                    : "",
                )}
              </td>

              <td class="number">
                ${litres(
                  tank.delivered_litres,
                )}
              </td>

              <td class="number">
                ${
                  tank.current_volume_litres ==
                  null
                    ? "—"
                    : litres(
                        tank.current_volume_litres,
                      )
                }
              </td>

              <td class="number">
                ${
                  tank.is_gasoline
                    ? `${Number(
                        tank.compliance_percent ||
                          0,
                      ).toFixed(2)}%`
                    : "Information only"
                }
              </td>

              <td class="number">
                ${
                  tank.is_gasoline
                    ? litres(
                        tank.compliance_remaining_litres,
                      )
                    : "—"
                }
              </td>
            </tr>
          `,
        )
        .join("");

      return `
        <section class="site-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">
                LOCATION
                ${pdfValue(
                  site.site.location_id,
                )}
              </span>

              <h2>
                ${pdfValue(site.site.name)}
              </h2>
            </div>

            <span
              class="status ${
                siteOnline(site)
                  ? "online"
                  : "offline"
              }"
            >
              ${
                siteOnline(site)
                  ? "Online"
                  : "Offline"
              }
            </span>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tank</th>
                <th>Product</th>
                <th>Recorded Since</th>
                <th class="number">
                  Delivered
                </th>
                <th class="number">
                  Current Volume
                </th>
                <th class="number">
                  Recorded Progress
                </th>
                <th class="number">
                  To Limit
                </th>
              </tr>
            </thead>

            <tbody>
              ${
                tankRows ||
                `
                  <tr>
                    <td colspan="7">
                      No tank throughput
                      records available.
                    </td>
                  </tr>
                `
              }
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const alarmHistory = sites
    .flatMap((site) =>
      (site.alarm_history || []).map(
        (alarm) => ({
          ...alarm,
          siteName: site.site.name,
        }),
      ),
    )
    .sort(
      (a, b) =>
        new Date(
          b.last_seen_at || 0,
        ).getTime() -
        new Date(
          a.last_seen_at || 0,
        ).getTime(),
    );

  const alarmRows = alarmHistory
    .map(
      (alarm) => `
        <tr>
          <td>
            ${pdfValue(alarm.siteName)}
          </td>

          <td>
            ${pdfValue(
              alarm.alarm_text ||
                alarm.alarm_key,
            )}
          </td>

          <td>
            ${pdfValue(
              alarm.category ||
                "Alarm",
            )}
          </td>

          <td>
            <span
              class="status ${
                alarm.active
                  ? "alarm-active"
                  : "cleared"
              }"
            >
              ${
                alarm.active
                  ? "Active"
                  : "Cleared"
              }
            </span>
          </td>

          <td>
            ${pdfValue(
              alarm.first_seen_at
                ? new Date(
                    alarm.first_seen_at,
                  ).toLocaleString("en-CA")
                : "",
            )}
          </td>

          <td>
            ${pdfValue(
              alarm.last_seen_at
                ? new Date(
                    alarm.last_seen_at,
                  ).toLocaleString("en-CA")
                : "",
            )}
          </td>
        </tr>
      `,
    )
    .join("");

  reportWindow.document.open();

  reportWindow.document.write(`
    <!doctype html>

    <html lang="en">
      <head>
        <meta charset="UTF-8">

        <title>
          Regional Bulk Facility Report
          ${dashboardData.year}
        </title>

        <style>
          @page {
            size: letter;
            margin: 13mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            color: #15202b;
            background: #ffffff;
            font-family:
              Arial,
              Helvetica,
              sans-serif;
            font-size: 10px;
            line-height: 1.4;
          }

          header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            padding-bottom: 16px;
            border-bottom:
              4px solid #1478ad;
          }

          .logo {
            width: 175px;
            max-height: 75px;
            object-fit: contain;
            object-position: left center;
          }

          .report-title {
            text-align: right;
          }

          .report-title h1 {
            margin: 0 0 5px;
            color: #123b5a;
            font-size: 24px;
            line-height: 1.1;
          }

          .report-title p {
            margin: 2px 0;
            color: #526273;
          }

          .eyebrow {
            display: block;
            margin-bottom: 3px;
            color: #1478ad;
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .summary {
            display: grid;
            grid-template-columns:
              repeat(4, 1fr);
            gap: 10px;
            margin: 18px 0;
          }

          .summary-card {
            padding: 12px;
            border: 1px solid #d7e1e8;
            border-radius: 8px;
            background: #f4f8fb;
          }

          .summary-card span {
            display: block;
            margin-bottom: 6px;
            color: #617181;
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
          }

          .summary-card strong {
            display: block;
            color: #123b5a;
            font-size: 17px;
          }

          section {
            margin-top: 20px;
          }

          h2 {
            margin: 0;
            color: #123b5a;
            font-size: 16px;
          }

          .section-heading {
            display: flex;
            align-items: center;
            justify-content:
              space-between;
            gap: 15px;
            margin-bottom: 8px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            break-inside: auto;
          }

          thead {
            display: table-header-group;
          }

          tr {
            break-inside: avoid;
          }

          th {
            padding: 7px 6px;
            color: #ffffff;
            background: #1478ad;
            font-size: 8px;
            text-align: left;
            text-transform: uppercase;
          }

          td {
            padding: 7px 6px;
            border-bottom:
              1px solid #dfe7ec;
            vertical-align: middle;
          }

          tbody tr:nth-child(even) {
            background: #f7fafc;
          }

          .number {
            text-align: right;
            white-space: nowrap;
          }

          .status {
            display: inline-block;
            border-radius: 999px;
            padding: 3px 7px;
            font-size: 8px;
            font-weight: 800;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .online,
          .cleared {
            color: #086647;
            background: #d9f7ea;
          }

          .offline,
          .alarm-active {
            color: #9b1c1c;
            background: #fee2e2;
          }

          .notice {
            margin-top: 18px;
            padding: 12px;
            border-left:
              4px solid #e3a008;
            background: #fff8df;
            color: #684c06;
          }

          .site-section {
            break-inside: avoid;
          }

          .alarm-section {
            page-break-before: auto;
          }

          footer {
            margin-top: 24px;
            padding-top: 10px;
            border-top:
              1px solid #cbd5df;
            color: #6b7785;
            font-size: 8px;
            text-align: center;
          }

          @media print {
            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust:
                exact;
            }
          }
        </style>
      </head>

      <body>
        <header>
          <img
            class="logo"
            src="${logoUrl}"
            alt="Suncor Energy"
          >

          <div class="report-title">
            <span class="eyebrow">
              DIPS INSIGHT
            </span>

            <h1>
              Regional Bulk Facility
              Overview
            </h1>

            <p>
              Calendar year
              ${dashboardData.year}
            </p>

            <p>
              Generated ${generatedAt}
            </p>
          </div>
        </header>

        <div class="summary">
          <div class="summary-card">
            <span>Sites Online</span>

            <strong>
              ${onlineCount} of
              ${sites.length}
            </strong>
          </div>

          <div class="summary-card">
            <span>
              Gasoline Recorded
            </span>

            <strong>
              ${litres(gasolineTotal)}
            </strong>
          </div>

          <div class="summary-card">
            <span>
              All Products Recorded
            </span>

            <strong>
              ${litres(allProductsTotal)}
            </strong>
          </div>

          <div class="summary-card">
            <span>Active Alarms</span>

            <strong>
              ${activeAlarms.length}
            </strong>
          </div>
        </div>

        <section>
          <div class="section-heading">
            <div>
              <span class="eyebrow">
                REGIONAL STATUS
              </span>

              <h2>
                Site Health Summary
              </h2>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Site</th>
                <th>Status</th>
                <th>Last Report</th>
                <th>Recorded Since</th>
                <th class="number">
                  Tanks
                </th>
                <th class="number">
                  Active Alarms
                </th>
                <th class="number">
                  Recorded Volume
                </th>
              </tr>
            </thead>

            <tbody>
              ${siteRows}
            </tbody>
          </table>
        </section>

        <section>
          <div class="section-heading">
            <div>
              <span class="eyebrow">
                DELIVERY TRENDS
              </span>

              <h2>
                Regional Monthly
                Deliveries
              </h2>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Month</th>

                <th class="number">
                  All Products
                </th>

                <th class="number">
                  Gasoline
                </th>

                <th class="number">
                  Diesel
                </th>

                <th class="number">
                  Other
                </th>

                <th class="number">
                  Deliveries
                </th>
              </tr>
            </thead>

            <tbody>
              ${monthlyRows}
            </tbody>
          </table>
        </section>

        ${siteTankSections}

        <section class="alarm-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">
                ALARM CONDITIONS
              </span>

              <h2>Alarm Summary</h2>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Description</th>
                <th>Category</th>
                <th>Status</th>
                <th>First Detected</th>
                <th>Last Seen / Cleared</th>
              </tr>
            </thead>

            <tbody>
              ${
                alarmRows ||
                `
                  <tr>
                    <td colspan="6">
                      No alarm conditions
                      have been recorded.
                    </td>
                  </tr>
                `
              }
            </tbody>
          </table>
        </section>

        <div class="notice">
          <strong>Data-quality note:</strong>

          Delivery totals and gasoline
          progress are based only on records
          collected by DIPS since the
          displayed monitoring start dates.

          Historical deliveries recorded
          before DIPS monitoring began have
          not been added unless specifically
          entered as a baseline.
        </div>

        <footer>
          Regional Bulk Facility Overview ·
          Powered by DIPS Insight ·
          Proof of Concept
        </footer>

        <script>
          window.addEventListener(
            "load",
            function () {
              setTimeout(
                function () {
                  window.print();
                },
                700
              );
            }
          );
        <\/script>
      </body>
    </html>
  `);

  reportWindow.document.close();
}

function ensurePdfExportOption() {
  if ($("export-pdf")) return;

  const options = $("export-options");

  if (!options) return;

  const button =
    document.createElement("button");

  button.id = "export-pdf";
  button.type = "button";
  button.textContent =
    "Regional PDF Report";

  button.addEventListener(
    "click",
    () => {
      $("export-options").classList.remove(
        "open",
      );

      generateRegionalPdf();
    },
  );

  options.prepend(button);
}

function showDashboard() {
  $("login").hidden = true;
  $("login").style.display = "none";
  $("app").hidden = false;

  ensureLogoutButton();
  ensureExportMenu();
  ensurePdfExportOption();
}


const visualProductColours = {
  diesel: "#fde047",
  regular: "#67e8f9",
  premium: "#ef4444",
  dyed_diesel: "#a855f7",
  dyed_gasoline: "#f97316",
  def: "#1d4ed8",
  other: "#94a3b8",
};

const visualProductLabels = {
  diesel: "Diesel",
  regular: "Regular",
  premium: "Premium",
  dyed_diesel: "Dyed Diesel",
  dyed_gasoline: "Dyed Gasoline",
  def: "DEF",
  other: "Other",
};

function addVisualUpgradeStyles() {
  if ($("visual-upgrade-styles")) return;

  const style =
    document.createElement("style");

  style.id = "visual-upgrade-styles";

  style.textContent = `
    .site-card {
      position: relative;
      overflow: hidden;
      transition:
        transform 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease;
    }

    .site-card:hover {
      transform: translateY(-2px);
      box-shadow:
        0 12px 28px
        rgba(0, 0, 0, 0.22);
    }

    .site-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 5px;
      background: #64748b;
    }

    .site-card.health-online::before {
      background: #34d399;
    }

    .site-card.health-attention::before {
      background: #fbbf24;
    }

    .site-card.health-offline::before {
      background: #f87171;
    }

    .site-card.health-unknown::before {
      background: #64748b;
    }

    .health-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .health-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      box-shadow:
        0 0 10px currentColor;
    }

    .health-badge.online {
      color: #6ee7b7;
      background:
        rgba(52, 211, 153, 0.14);
    }

    .health-badge.attention {
      color: #fde68a;
      background:
        rgba(251, 191, 36, 0.14);
    }

    .health-badge.offline {
      color: #fca5a5;
      background:
        rgba(248, 113, 113, 0.14);
    }

    .health-badge.unknown {
      color: #cbd5e1;
      background:
        rgba(100, 116, 139, 0.18);
    }

    .active-alarm-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: 0 0 16px;
      padding: 12px 16px;
      border:
        1px solid rgba(
          248,
          113,
          113,
          0.55
        );
      border-radius: 10px;
      color: #fecaca;
      background:
        linear-gradient(
          90deg,
          rgba(127, 29, 29, 0.42),
          rgba(69, 10, 10, 0.18)
        );
    }

    .active-alarm-banner[hidden] {
      display: none;
    }

    .alarm-banner-message {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 750;
    }

    .alarm-banner-symbol {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 999px;
      color: #450a0a;
      background: #f87171;
      font-weight: 900;
    }

    .alarm-banner-button {
      border:
        1px solid rgba(
          254,
          202,
          202,
          0.45
        );
      border-radius: 7px;
      color: #fee2e2;
      background: transparent;
      padding: 7px 11px;
      font: inherit;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }

    .back-sites-button {
      display: none;
      border: 1px solid #475569;
      border-radius: 8px;
      color: #cbd5e1;
      background: transparent;
      padding: 10px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .back-sites-button:hover {
      color: #a5f3fc;
      border-color: #0891b2;
    }

    .kpi-icon {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin-bottom: 10px;
      border-radius: 8px;
      color: #a5f3fc;
      background:
        rgba(34, 211, 238, 0.12);
      font-size: 12px;
      font-weight: 900;
    }

    .product-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin: 0 0 13px;
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #cbd5e1;
      font-size: 12px;
      font-weight: 650;
    }

    .legend-colour {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      box-shadow:
        0 0 8px
        rgba(255, 255, 255, 0.12);
    }

    .month-track {
      position: relative;
      background:
        repeating-linear-gradient(
          to top,
          transparent 0,
          transparent calc(25% - 1px),
          rgba(100, 116, 139, 0.22)
            calc(25% - 1px),
          rgba(100, 116, 139, 0.22)
            25%
        ),
        rgba(15, 23, 42, 0.55);
    }

    .month-stack {
      width: 68%;
      min-height: 3px;
      display: flex;
      flex-direction: column-reverse;
      overflow: hidden;
      border-radius: 7px 7px 2px 2px;
      box-shadow:
        0 0 18px
        rgba(34, 211, 238, 0.12);
    }

    .month-segment {
      width: 100%;
      min-height: 1px;
    }

    .month-column.current-month
      .month-track {
      outline: 2px solid
        rgba(34, 211, 238, 0.48);
      outline-offset: 2px;
    }

    .month-column.current-month
      .month-label {
      color: #67e8f9;
    }

    .month-column.current-month
      .month-label::after {
      content: " NOW";
      font-size: 8px;
      color: #22d3ee;
    }

    .sidebar-live {
      display: flex;
      flex-direction: column;
      gap: 5px;
      color: #94a3b8;
      font-size: 11px;
    }

    .sidebar-live-row {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #6ee7b7;
      font-weight: 800;
    }

    .sidebar-live-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #34d399;
      box-shadow:
        0 0 9px #34d399;
    }

    @media (max-width: 700px) {
      .active-alarm-banner {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;

  document.head.appendChild(style);
}

function getProductKeysForChart() {
  if (chartProduct === "gasoline") {
    return [
      "regular",
      "premium",
      "dyed_gasoline",
    ];
  }

  if (chartProduct === "diesel") {
    return [
      "diesel",
      "dyed_diesel",
    ];
  }

  return [
    "diesel",
    "regular",
    "premium",
    "dyed_diesel",
    "dyed_gasoline",
    "def",
    "other",
  ];
}

function compactLitres(value) {
  const amount = Number(value || 0);

  if (amount >= 1000000) {
    return `${(
      amount / 1000000
    ).toFixed(2)}M L`;
  }

  if (amount >= 1000) {
    return `${(
      amount / 1000
    ).toFixed(0)}k L`;
  }

  return `${Math.round(amount)} L`;
}

function updateProductLegend(keys) {
  let legend = $("product-legend");

  if (!legend) {
    legend =
      document.createElement("div");

    legend.id = "product-legend";
    legend.className =
      "product-legend";

    $("monthly-note").insertAdjacentElement(
      "afterend",
      legend,
    );
  }

  const usedKeys = keys.filter((key) =>
    (chartData?.months || []).some(
      (month) =>
        Number(
          month.products?.[key] || 0,
        ) > 0,
    ),
  );

  legend.innerHTML = (
    usedKeys.length ? usedKeys : keys
  )
    .map(
      (key) => `
        <span class="legend-item">
          <span
            class="legend-colour"
            style="background:${
              visualProductColours[key]
            }"
          ></span>

          ${visualProductLabels[key]}
        </span>
      `,
    )
    .join("");
}

function drawProductMonthlyChart() {
  const panel = $("monthly-panel");

  if (!panel || !chartData) return;

  const months =
    chartData.months || [];

  const keys =
    getProductKeysForChart();

  const totals = months.map((month) =>
    keys.reduce(
      (sum, key) =>
        sum +
        Number(
          month.products?.[key] || 0,
        ),
      0,
    ),
  );

  const maximum =
    Math.max(...totals, 1);

  const startMonth =
    chartData.recorded_since
      ? new Date(
          chartData.recorded_since,
        ).getMonth()
      : null;

  const currentMonth =
    new Date().getMonth();

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  $("monthly-title").textContent =
    chartTitle;

  $("monthly-note").textContent =
    chartData.recorded_since
      ? `Delivery records available since ${displayDate(
          chartData.recorded_since,
        )} · ${fmt.format(
          chartData.delivery_count || 0,
        )} deliveries recorded`
      : "No delivery history is available yet.";

  updateProductLegend(keys);

  $("monthly-chart").innerHTML =
    months
      .map((month, index) => {
        const total = totals[index];

        const unavailable =
          startMonth === null ||
          index < startMonth;

        const stackHeight =
          unavailable
            ? 0
            : Math.max(
                total > 0 ? 4 : 0,
                (total / maximum) * 100,
              );

        const segments = keys
          .filter(
            (key) =>
              Number(
                month.products?.[key] ||
                  0,
              ) > 0,
          )
          .map((key) => {
            const value = Number(
              month.products?.[key] || 0,
            );

            return `
              <div
                class="month-segment"
                style="
                  flex:${value};
                  background:${
                    visualProductColours[
                      key
                    ]
                  };
                "
                title="${
                  visualProductLabels[key]
                }: ${litres(value)}"
              ></div>
            `;
          })
          .join("");

        return `
          <div
            class="
              month-column
              ${
                unavailable
                  ? "unavailable"
                  : ""
              }
              ${
                index === currentMonth
                  ? "current-month"
                  : ""
              }
            "
            title="${
              monthNames[index]
            }: ${
              unavailable
                ? "Not available"
                : litres(total)
            }"
          >
            <div class="month-value">
              ${
                unavailable
                  ? "—"
                  : compactLitres(total)
              }
            </div>

            <div class="month-track">
              <div
                class="month-stack"
                style="
                  height:${stackHeight}%;
                "
              >
                ${segments}
              </div>
            </div>

            <div class="month-label">
              ${monthNames[index]}
            </div>
          </div>
        `;
      })
      .join("");
}

function getSiteHealth(site) {
  const last = lastReport(site);
  const alarms =
    (site.alarms || []).length;

  if (!last) {
    return {
      level: "unknown",
      label: "No Report",
    };
  }

  if (!siteOnline(site)) {
    return {
      level: "offline",
      label: "Offline",
    };
  }

  if (alarms > 0) {
    return {
      level: "attention",
      label: "Attention",
    };
  }

  return {
    level: "online",
    label: "Healthy",
  };
}

function renderUpgradedSiteCards() {
  $("tanks").innerHTML =
    dashboardData.sites
      .map((site) => {
        const throughput =
          site.throughput || [];

        const alarms =
          site.alarms || [];

        const health =
          getSiteHealth(site);

        const total =
          throughput.reduce(
            (sum, tank) =>
              sum +
              Number(
                tank.delivered_litres ||
                  0,
              ),
            0,
          );

        const last =
          lastReport(site);

        const recordedSince =
          siteRecordedSince(site);

        return `
          <article
            class="
              tank
              site-card
              health-${health.level}
            "
            data-location="${
              site.site.location_id
            }"
            style="cursor:pointer"
          >
            <div class="tank-head">
              <div>
                <span class="eyebrow">
                  LOCATION
                  ${site.site.location_id}
                </span>

                <h3>
                  ${esc(site.site.name)}
                </h3>
              </div>

              <span
                class="
                  badge
                  health-badge
                  ${health.level}
                "
              >
                <span
                  class="health-dot"
                ></span>

                ${health.label}
              </span>
            </div>

            <div class="tank-values">
              <div>
                <span>
                  Recorded since
                  ${displayDate(
                    recordedSince,
                  )}
                </span>

                <strong>
                  ${litres(total)}
                </strong>
              </div>

              <div>
                <span>
                  Tanks reporting
                </span>

                <strong>
                  ${throughput.length}
                </strong>
              </div>
            </div>

            <div class="progress-label">
              <span>
                ${alarms.length}
                active alarm${
                  alarms.length === 1
                    ? ""
                    : "s"
                }
              </span>

              <span>
                ${
                  last
                    ? reportAge(last)
                    : "No report received"
                }
              </span>
            </div>
          </article>
        `;
      })
      .join("");

  document
    .querySelectorAll(".site-card")
    .forEach((card) => {
      card.addEventListener(
        "click",
        () => {
          renderSite(
            Number(
              card.dataset.location,
            ),
          );
        },
      );
    });
}

function ensureAlarmBanner() {
  if ($("active-alarm-banner")) {
    return;
  }

  const banner =
    document.createElement("section");

  banner.id =
    "active-alarm-banner";

  banner.className =
    "active-alarm-banner";

  banner.hidden = true;

  banner.innerHTML = `
    <div class="alarm-banner-message">
      <span
        class="alarm-banner-symbol"
      >
        !
      </span>

      <span id="alarm-banner-text">
      </span>
    </div>

    <button
      id="alarm-banner-button"
      class="alarm-banner-button"
      type="button"
    >
      View alarms
    </button>
  `;

  $("status-banner").insertAdjacentElement(
    "afterend",
    banner,
  );

  $("alarm-banner-button")
    .addEventListener(
      "click",
      () => {
        currentView = "alarms";
        renderAlarms();
      },
    );
}

function updateAlarmBanner() {
  ensureAlarmBanner();

  const alarms = allAlarms();
  const banner =
    $("active-alarm-banner");

  if (!alarms.length) {
    banner.hidden = true;
    return;
  }

  const affectedSites =
    new Set(
      alarms.map(
        (alarm) => alarm.locationId,
      ),
    ).size;

  $("alarm-banner-text").textContent =
    `${alarms.length} active critical alarm${
      alarms.length === 1 ? "" : "s"
    } across ${affectedSites} facilit${
      affectedSites === 1 ? "y" : "ies"
    }`;

  banner.hidden = false;
}

function ensureBackToSitesButton() {
  if ($("back-to-sites")) return;

  const button =
    document.createElement("button");

  button.id = "back-to-sites";
  button.type = "button";
  button.className =
    "back-sites-button";

  button.textContent =
    "← All Sites";

  button.addEventListener(
    "click",
    () => {
      currentView = "sites";
      renderSites();
    },
  );

  const actions =
    $("refresh").parentElement;

  actions.insertBefore(
    button,
    $("refresh"),
  );
}

function showBackToSites(show) {
  ensureBackToSitesButton();

  $("back-to-sites").style.display =
    show ? "inline-flex" : "none";
}

function addKpiIcons(
  labels,
) {
  const cards = [
    ...document.querySelectorAll(
      ".stats article",
    ),
  ];

  cards.forEach((card, index) => {
    let icon =
      card.querySelector(
        ".kpi-icon",
      );

    if (!icon) {
      icon =
        document.createElement(
          "span",
        );

      icon.className =
        "kpi-icon";

      card.prepend(icon);
    }

    icon.textContent =
      labels[index] || "•";
  });
}

function updateRegionalKpis() {
  const cards = [
    ...document.querySelectorAll(
      ".stats article",
    ),
  ];

  const sites =
    dashboardData.sites;

  const onlineCount =
    sites.filter(siteOnline).length;

  if (cards[3]) {
    cards[3].querySelector(
      "span:not(.kpi-icon)",
    ).textContent =
      "Sites online";

    cards[3].querySelector(
      "strong",
    ).textContent =
      `${onlineCount} / ${sites.length}`;

    cards[3].querySelector(
      "small",
    ).textContent =
      "Live facility health";
  }

  addKpiIcons([
    "G",
    "Σ",
    "!",
    "●",
  ]);
}

function updateSiteKpis() {
  const cards = [
    ...document.querySelectorAll(
      ".stats article",
    ),
  ];

  if (cards[3]) {
    cards[3].querySelector(
      "span:not(.kpi-icon)",
    ).textContent =
      "Tanks reporting";

    cards[3].querySelector(
      "small",
    ).textContent =
      "Current facility";
  }

  addKpiIcons([
    "G",
    "Σ",
    "!",
    "T",
  ]);
}

function updateSidebarLiveStatus() {
  const footer =
    document.querySelector(
      ".aside-foot",
    );

  if (!footer || !dashboardData) {
    return;
  }

  const refreshTime =
    dashboardData.generated_at
      ? new Date(
          dashboardData.generated_at,
        )
      : new Date();

  footer.innerHTML = `
    <div class="sidebar-live">
      <div class="sidebar-live-row">
        <span
          class="sidebar-live-dot"
        ></span>

        Live data
      </div>

      <span>
        Updated
        ${refreshTime.toLocaleTimeString(
          "en-CA",
          {
            hour: "numeric",
            minute: "2-digit",
          },
        )}
      </span>

      <span>
        DIPS Insight · Regional Pilot
      </span>
    </div>
  `;
}

function putSitesBeforeChart() {
  const chart =
    $("monthly-panel");

  if (
    chart &&
    throughputPanel &&
    chart.parentNode
  ) {
    chart.parentNode.insertBefore(
      throughputPanel,
      chart,
    );
  }
}

function putChartBeforeTanks() {
  const chart =
    $("monthly-panel");

  if (
    chart &&
    throughputPanel &&
    throughputPanel.parentNode
  ) {
    throughputPanel.parentNode.insertBefore(
      chart,
      throughputPanel,
    );
  }
}

addVisualUpgradeStyles();
ensureAlarmBanner();
ensureBackToSitesButton();

drawMonthlyChart =
  drawProductMonthlyChart;

renderSiteCards =
  renderUpgradedSiteCards;

const originalVisualOverview =
  renderOverview;

const originalVisualSites =
  renderSites;

const originalVisualSite =
  renderSite;

const originalVisualAlarms =
  renderAlarms;

renderOverview = function () {
  originalVisualOverview();

  putSitesBeforeChart();
  updateRegionalKpis();
  updateAlarmBanner();
  showBackToSites(false);
  updateSidebarLiveStatus();
};

renderSites = function () {
  originalVisualSites();

  putSitesBeforeChart();
  updateRegionalKpis();
  updateAlarmBanner();
  showBackToSites(false);
  updateSidebarLiveStatus();
};

renderSite = function (locationId) {
  originalVisualSite(locationId);

  putChartBeforeTanks();
  updateSiteKpis();
  updateAlarmBanner();
  showBackToSites(true);
  updateSidebarLiveStatus();
};

renderAlarms = function () {
  originalVisualAlarms();

  $("active-alarm-banner").hidden =
    true;

  showBackToSites(false);
  updateRegionalKpis();
  updateSidebarLiveStatus();
};

if (dashboardData) {
  render();
}


const recordedProgressStyle =
  document.createElement("style");

recordedProgressStyle.textContent = `
  .tank .badge.gas {
    color: #a7f3d0;
    border:
      1px solid
      rgba(52, 211, 153, 0.38);
    background:
      linear-gradient(
        135deg,
        rgba(6, 78, 59, 0.72),
        rgba(16, 185, 129, 0.18)
      );
  }

  .tank .progress {
    background:
      rgba(6, 78, 59, 0.35);
  }

  .tank .progress > i {
    background:
      linear-gradient(
        90deg,
        #047857 0%,
        #10b981 55%,
        #6ee7b7 100%
      ) !important;

    box-shadow:
      0 0 12px
      rgba(52, 211, 153, 0.38);
  }
`;

document.head.appendChild(
  recordedProgressStyle,
);
