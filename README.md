# DS3 Guide Numpad Controller

A tiny, optional helper that lets you walk through the
[Dark Souls III 100% guide](https://ds3-community-guide.vercel.app) from your
numpad, without alt-tabbing out of the game. Press a key, the guide steps to the
next entry. Press the capture key, the Steam screenshot you just took is submitted
to that step as a contribution.

It is completely optional. The guide works fine without it. This just makes it
more comfortable to follow along, and to contribute, while you play.

## Controls

Play mode:

    8 / 2   move up / down a step
    5       tick the step done
    4 / 6   previous / next chapter
    9       capture a Steam screenshot and submit it to the highlighted step
    0       switch to screenshot-edit mode

Screenshot-edit mode:

    4 / 6   pick one of the step's screenshots
    9       replace the selected screenshot
    7       suggest removing it
    0       back to play

Every screenshot is credited to you and reviewed before it appears. You need to be
signed in to the guide to contribute.

## Is this a keylogger?

Short answer: no, and you can verify every line here yourself.

It watches a **small, fixed set of numpad keys** (move, tick, change chapter,
capture, edit). Nothing else is read. When you press one, it sends the *name of
the action* (text like `"nav-down"`) to your own computer at `127.0.0.1`. The
capture key copies the screenshot **you** took with Steam into a local folder so
your own browser tab can upload it. It never records a key, never writes one to a
file, and never sends anything out to the internet. The only thing that ever
receives a message is the guide tab you opened yourself.

The whole list of keys it polls is right here in [`numpad.ps1`](numpad.ps1):

```powershell
$MAP = @{
  0x68 = "nav-up";       # 8
  0x62 = "nav-down";     # 2
  0x65 = "toggle";       # 5  tick the step
  0x64 = "chapter-prev"; # 4
  0x66 = "chapter-next"; # 6
  0x67 = "delete-shot";  # 7
  0x60 = "edit-toggle";  # 0
}
$CAPTURE_KEY = 0x69      # 9  take a Steam screenshot and submit it
```

There is no code path that reads any other key, and no code path that writes a
keystroke to a log. If that ever changes, it will be a visible change in this
public repo.

## How it works

Three small parts, all open:

1. **[`numpad.ps1`](numpad.ps1)** polls the numpad keys. On a press it does a
   single local POST of `{ "action": "nav-down" }` to the controller. A capture
   also copies the Steam screenshot you took into a local folder. It stores
   nothing else.
2. **[`controller.js`](controller.js)** is a small local server bound to
   `127.0.0.1` only. It holds open a Server-Sent Events stream, relays each action
   to any connected guide tab, and serves a captured screenshot back to that tab so
   it can upload it. It keeps no history.
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
