# SeatServe (hosted version)
Node 22.5+ + Express + built-in SQLite (no native build, works on Windows), with live updates (SSE) to the owner dashboard. The mock UPI gateway runs on the server and prices are always recalculated server-side.

## Run locally
    npm install
    OWNER_PIN=1234 SECRET=any-long-random-text npm start
Open http://localhost:3000 (customer) and http://localhost:3000/#owner (owner).

## Deploy (Render, about 5 minutes)
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > pick the repo. Build command: `npm install`. Start command: `npm start`.
3. Environment variables: `OWNER_PIN` (your PIN) and `SECRET` (long random text).
4. For data to survive restarts, add a Disk (mount path `/data`) and set `DB_PATH=/data/seatserve.db`. Free plans without a disk reset orders on restart, which is fine for a demo.
5. Open `https://<your-app>.onrender.com/#owner`, log in, go to "Seat QR stickers", generate and print the stickers. The sticker links use your live domain automatically.

## Next steps
Swap the mock payment in `/api/pay` for your 0%-commission UPI gateway (create payment, verify webhook, then save the order); add signed seat tokens in the QR links; add SMS or WhatsApp updates.
