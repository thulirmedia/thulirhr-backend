# Mother India City Shelters – ad landing page

Static page (no build). Open `index.html` or serve the folder (`npx http-server landing`).

Before running ads, edit the `CONFIG` block at the bottom of `index.html`:

- `leadEndpoint` – URL that accepts a JSON POST (webhook, Apps Script, CRM). Empty = lead opens a prefilled WhatsApp message.
- `gtagId`, `gadsLeadLabel` – Google Ads tag and conversion label (fires on lead submit).
- `metaPixelId` – Meta Pixel (fires `Lead` on submit, custom events on call/WhatsApp clicks).
- `offerDeadline` – ISO date for the countdown; empty = rolling 3-day timer.

UTM params, `gclid` and `fbclid` are captured and sent with each lead.
