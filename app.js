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
