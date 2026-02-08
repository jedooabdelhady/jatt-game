Mobile Deployment Checklist (iOS & Android)

- Hosting & TLS
  - Serve the app over HTTPS (valid cert). Use Nginx/Cloudflare as reverse proxy for TLS and WSS.
  - Proxy WebSocket (WSS) through the same domain to avoid mixed-content and CORS issues.

- Server
  - Ensure `server.js` listens on a reachable host and port; use environment `PORT`.
  - Use process manager (`pm2`, `systemd`) to run `node server.js` and restart on crash.
  - Enable rotating logs (already in `logs/`); monitor disk usage.

- Frontend
  - Add `<meta name="viewport" content="width=device-width,initial-scale=1">` to `index.html`.
  - Disable autoplay audio; require user interaction for sounds (we removed audio).
  - Test touch interactions and RTL layout on small screens (min-width, dVh usage).
  - Optimize assets: compress images, inline critical CSS, defer non-critical JS.

- PWA / Native wrappers
  - For a PWA: add service worker and manifest; test offline fallback and cache strategy.
  - For native apps: use Capacitor or Cordova (wrap `index.html`), enable WKWebView for iOS.
  - Test WKWebView specifics: long-running timers may be throttled in background.

- Network & WebSocket
  - Use WSS with sticky session / load balancer if scaling across nodes.
  - Tune pingInterval/pingTimeout in Socket.IO to avoid false disconnects on mobile networks.
  - Implement exponential reconnect backoff.

- Permissions & Battery
  - Avoid heavy background CPU usage; reduce intervals (we use 5s cleanup).
  - Handle visibilitychange events to pause non-essential updates.

- Testing matrix
  - iOS Safari (latest 2 versions), iOS WKWebView, Android Chrome (latest 2 versions), Android WebView.
  - Test on real devices with cellular (3G/4G) and Wi‑Fi.
  - Test join/rejoin, round start, voting under varying latencies.

- Common issues & fixes
  - WebSocket connection fails on iOS: ensure WSS + valid cert + no self-signed certs.
  - CORS errors: configure Socket.IO/CORS server-side to allow your origin.
  - Timers drifting: use server `startTime` (already implemented) and compute remaining on client.
  - Autoplay audio blocked: require explicit user gesture.

- Monitoring & debugging
  - Enable server logs, rotate daily, alert on high error rate.
  - Add client-side error reporting (Sentry/LogRocket) for production.

Quick commands

```powershell
# start server (Windows PowerShell)
$env:PORT=4000; node server.js

# run stress test (adjust TOTAL/CONCURRENCY)
node stress_logs.js
# or with env vars
$env:TOTAL=1000; $env:CONCURRENCY=50; node stress_logs.js
```
