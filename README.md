# Opal Express backend

This is a standalone Express and Socket.IO service. Deploy it independently from
the Next.js website; the desktop recorder connects to this service, and this
service calls the website's `/api/recording/...` endpoints.

## Local development

1. Copy `.env.example` to `.env` and fill in the ImageKit and Groq keys.
2. Set `NEXT_API_HOST` to the website's API base URL, including `/api/` and a
   trailing slash.
3. Run `npm ci` and `npm run dev`.
4. Check `http://localhost:5001/health` for `{"status":"ok"}`.

## Production on Render

1. Keep this repository separate from `Opal` and `Opal-Desktop`.
2. In Render, create a Blueprint from the `Opal-expres-app` GitHub repository.
   Render will read `render.yaml` and create the `opal-express` web service.
3. Choose a plan that does not spin down while idle; a sleeping service is not
   suitable for a live Socket.IO recording session and may incur hosting cost.
4. Set the prompted `NEXT_API_HOST` to the production website's API base URL,
   for example `https://your-web-domain.example/api/`.
5. Enter `IMAGEKIT_PRIVATE_KEY` and `GROQ_API_KEY` as Render secret environment
   variables. Never commit their values.
6. After Render deploys, check `https://<your-service>.onrender.com/health`.
7. Set the desktop repository's `VITE_SOCKET_URL` Actions variable to
   `https://<your-service>.onrender.com`. The Socket.IO client will negotiate a
   secure WebSocket connection automatically.

`CORS_ORIGINS` includes `null` for the packaged Electron app's `file://` origin
and `http://localhost:5173` for local desktop development. The web frontend does
not connect directly to this service.
