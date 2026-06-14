# DS3 Guide Numpad Controller

A tiny, optional helper that lets you walk through the
[Dark Souls III 100% guide](https://ds3-community-guide.vercel.app) from your
numpad, without alt-tabbing out of the game. Press a key, the guide steps to the
next entry. That is the whole idea.

It is completely optional. The guide works fine without it. This just makes it
more comfortable to follow along while you play, and (soon) to send a screenshot
to the guide from the same keypad.

## Is this a keylogger?

Short answer: no, and you can verify every line here yourself.

It watches for **exactly two keys**, numpad **8** and numpad **2**. Nothing else
is read. When you press one, it sends the *name of the action* (the text
`"nav-up"` or `"nav-down"`) to your own computer at `127.0.0.1`. It never records
the key, never writes it to a file, and never sends it anywhere on the internet.
The only thing that ever receives a message is the guide tab you opened yourself.

The two keys it polls are right here in [`numpad.ps1`](numpad.ps1):

```powershell
$MAP = @{ 0x68 = "nav-up"; 0x62 = "nav-down" }   # 0x68 = numpad 8, 0x62 = numpad 2
```

There is no code path that reads any other key, and no code path that writes a
log. If that ever changes, it will be a visible change in this public repo.

## How it works

Three small parts, all open:

1. **[`numpad.ps1`](numpad.ps1)** polls the two numpad keys. On a press it does a
   single local POST of `{ "action": "nav-down" }` to the controller. It stores
   nothing.
2. **[`controller.js`](controller.js)** is a ~90-line local server bound to
   `127.0.0.1` only. It holds open a Server-Sent Events stream and relays each
   action to any connected guide tab. It keeps no history.
3. **The guide page** connects to the controller **only if you opted in** and
   then moves through the steps. That connection lives in the guide's own source,
   in `connectController()`:

   ```js
   function connectController() {
     if (!cloud.mode) return;
     // Opt-in only: do NOT touch 127.0.0.1 on a normal visit.
     let optedIn = false;
     try { optedIn = localStorage.getItem("ds-controller") === "1"; } catch {}
     if (!optedIn) return;
     // ... subscribes to http://127.0.0.1:10030/api/events and on "nav-up"/"nav-down"
     //     scrolls to the previous/next step.
   }
   ```

## Why it is safe

- **Local only.** The server binds to `127.0.0.1`, so nothing on your network or
  the internet can reach it. See `server.listen(PORT, "127.0.0.1", ...)` in
  [`controller.js`](controller.js).
- **Locked to one site.** Only the published guide's origin is allowed to receive
  events (the `ALLOWED` list in [`controller.js`](controller.js)). A random
  website cannot listen in.
- **Opt-in on both ends.** The guide never connects unless you turn it on, and
  your browser shows its own one-time "allow access to devices on this network"
  prompt that you control. Decline it and nothing happens.
- **No persistence, no telemetry.** No files written, no analytics, no network
  calls out. Read the source; there is nothing else in it.
- **Public and small.** Two short files plus a server. Any developer can read the
  whole thing in a few minutes.

## Install and run (Windows)

1. Install [Node.js](https://nodejs.org) once.
2. Download this repo (green **Code** button -> **Download ZIP**, or `git clone`).
3. In a terminal in this folder:

   ```
   node controller.js
   ```

4. Open the guide in Chrome or Edge, turn the controller on from the guide's
   controller page, and click **Allow** on the browser's device-access prompt.
5. Press numpad **8** / **2** to step up / down. Stop any time with `Ctrl+C`.

## Stop using it

Close the terminal (`Ctrl+C`) and turn it off on the guide. The browser also lets
you revoke the device-access permission in its site settings at any time.

## License

MIT. See [LICENSE](LICENSE).
