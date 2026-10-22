# Trade Pulse – group buying for MSMEs (demo)

Plain HTML, CSS and JavaScript. No build step, no install.

## Run it
Keep the files in one folder: `index.html`, `style.css`, `app.js`, `config.js`. All settings (Google client ID, Maps key, factory location) live in `config.js`.

- Email and password login, and the whole demo: just open `index.html` in Chrome, Edge or Firefox.
- Google sign-in: it must run from a web address, not from a file. In the folder, run
  `python3 -m http.server 8000` (or `npx serve -l 8000`) and open `http://localhost:8000`.

## Turn on Google sign-in
Google needs a client ID that only you can create (it is free):
1. Go to the Google Cloud Console and create or pick a project.
2. Open Google Auth Platform (older guides call it the OAuth consent screen). If asked, click Get started, enter an app name and your email, and choose External.
3. Under Audience, add your own Google account as a Test user. While the app is in Testing, only listed test users can sign in.
4. Under Clients, click Create client and choose Web application.
5. Under Authorized JavaScript origins add `http://localhost:8000` (the origin must match exactly, including the port). When you host the app, add its `https://` address too. Leave the redirect URIs empty.
6. Click Create, copy the Client ID and paste it into `config.js`. No client secret is needed.
7. Start the local server (`python3 -m http.server 8000`), open `http://localhost:8000` and reload. The "Continue with Google" button now opens the real Google account chooser.

If the button shows an error, check that the origin in step 5 matches the address bar exactly, and try an incognito window. Google can take a few minutes to apply changes.

New Google users are asked for their business name and distance from the hub, so the 50 km corridor rule still applies.

## Products
13 sample retail products across Packaging, Stationery, Household, Electricals, Food staples and Hardware (carry bags, billing rolls, packing tape, LED bulbs, floor cleaner, cooking oil, atta, notebooks and more). Every card shows the price if you buy alone, the price at each tier with its percentage off, and a savings example for one buyer. Filter by category, search, or sort by biggest discount. Products, suppliers and prices are sample data.

## Turn on Google Maps
The corridor tab shows a simple diagram until you add a Maps key. With a key it becomes a live Google Map with the 50 km circle, the factory hub, neighbouring businesses and a draggable pin for your own business. Dragging the pin outside 50 km is refused.
1. In the Google Cloud Console, use the same project and enable the Maps JavaScript API (APIs & Services, then Library).
2. Google Maps needs a billing account on the project. Maps usage has a monthly free allowance, so check Google's current pricing before you share the app widely.
3. Open APIs & Services, then Credentials, then Create credentials, then API key.
4. Restrict the key. Under Application restrictions choose Websites and add `http://localhost:8000/*` (add your `https://` address when you host the app). Under API restrictions choose Maps JavaScript API.
5. Paste the key into `config.js` as `googleMapsApiKey`.
6. In `config.js` set `hub` to your factory's latitude and longitude. The default is a placeholder.
7. Reload `http://localhost:8000` and open My corridor.

The neighbouring businesses on the map are sample data placed at their stated distance from the hub.

## Demo login
- Email: `demo@msme.in`
- Password: `Demo@1234`

You can also create an account. Registration is refused if the distance from the factory hub is over 50 km.

## Demo script (about 3 minutes)
1. Log in. Show the group deals and how the pool bar moves toward Tier 1.
2. Join the bolts deal with 2,000 pcs. Choose "Delivery to my address" (enter an address and date) or "Collect from the factory". Money, including freight, is locked in escrow, not paid to the factory.
3. Click "Neighbours join" until Tier 1 unlocks, then "Deadline passes". The price locks.
4. Open My orders. Click "Demo: factory marks as dispatched". Vehicle, driver, ETA and a handover code appear on the order.
5. Click "Confirm delivery and release payment". The factory and transporter are paid and the price difference comes back to you.
6. Try the other path: join a deal, then click "Deadline passes" before Tier 1. Everyone is refunded in full.
7. Open My corridor to show the 50 km map.

## What is real and what is simulated
- Real in the browser: Google sign-in (once you add a client ID), salted PBKDF2 password hashing, session expiry (30 min), lockout after 5 failed logins, input validation, HTML escaping.
- Simulated: escrow, payments, other businesses in the pool, factory dispatch.
- Data is stored in the browser's localStorage. Use "Reset demo data" in the footer to start over.

## Before a real launch
Move accounts and sessions to a server (for example Node.js with a database), verify Google ID tokens on that server, and connect a licensed escrow or payment-aggregator partner.
