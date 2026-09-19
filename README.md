# DIPS Insight Dashboard

Standalone North Battleford proof-of-concept dashboard for Netlify.

## Netlify environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DASHBOARD_USER`
- `DASHBOARD_PASSWORD`
- `NB_LOCATION_ID` (use `48`)

The service-role key is used only inside the Netlify Function and is never sent to the browser.

