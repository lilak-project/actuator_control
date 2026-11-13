# Actuator Control

Web control and monitoring for the SMC **JXC91** electric actuator controllers
on the beamline, over EtherNet/IP.

Several axes can be connected at once, each on its own tab: live position,
servo and alarm signals, the 64-slot step table, and a per-profile position
limit that blocks moves when a stored step would run the axis too far.

```
backend/    FastAPI service + the JXC91 driver
frontend/   React UI (Mantine, drawn in NEON: ../neon_ui)
```

## Control and monitoring

One service, two modes (actuator_monitoring was folded in here). **Monitor**
shows every saved actuator, where each axis is or was last left, its stored
steps, and the movement history; nothing on it moves an axis. **Control** adds
Connect, Init, servo and moves.

Under the portal, control is for a portal manager or an admin of this service
(a portal grant with admin ticked, to the person or a group); everyone else the
portal lets in gets monitoring. The server enforces it -- every request that is
not a read answers 403 for a monitoring caller (`backend/app/access.py`,
checked by `backend/tools/check_access.py`). Someone who may control can still
switch to Monitor at the top. Run on its own, with no portal, everything is
allowed, as before.

The elog endpoint (`POST /api/elog`) moved here too, under the same name and
fields actuator_monitoring registered, so its log formats keep filling; elog
needs Discover run once against this service's URL.

## Running it

```bash
# 1. backend dependencies (once)
pip install -r backend/requirements.txt

# 2. build the UI (once, and after any frontend change)
cd frontend && npm install && npm run build && cd ..

# 3. start
cd backend && python run.py
```

`run.py` listens on `0.0.0.0:8080` and prints the LAN URL to open. It serves
both the API and the built UI, so there is one process and one port.

| | |
|---|---|
| `python run.py --port 8081` | different port |
| `python run.py --host 127.0.0.1` | this machine only |
| `http://<host>:8080/docs` | interactive API docs |

> This machine has no `python3-venv`, so the commands above install into the
> user site-packages. `apt install python3.10-venv` first if you would rather
> keep the dependencies in a virtualenv.

### Developing the UI

```bash
cd backend && python tools/simulator.py     # simulated axes on :8080
cd frontend && npm run dev                  # Vite on :5173, proxies /api and /ws
```

`tools/simulator.py` replaces only the CIP driver, so the API, the manager and
the UI under test are the real ones. Use it whenever you are away from the
hardware — it will never drive a real actuator.

## How it works

The driver keeps one background thread per axis that re-reads the controller's
input map every 250 ms. Status reads therefore cost no network I/O, which is
what makes the WebSocket broadcast cheap: the server pushes every connected
actuator to every browser five times a second, and the browsers never poll.

Commands go the other way as ordinary REST calls. They are slow — `Setup` waits
up to 20 s for the axis to home — so they run in a worker thread and never
touch the event loop.

```
browser ──REST──▶ FastAPI ──▶ ActuatorHub ──▶ ActuatorManager ──▶ JXC91 ──CIP──▶ controller
        ◀──WS──── broadcast ◀── snapshot (cached, no I/O) ◀───────┘
```

### Safety behaviour

Both of these are enforced in the backend; the UI greys the control out and
says why, but the check that matters is server-side.

- **Critical alarms** (192 encoder error, 196 position deviation overflow)
  block every command until the fault is cleared and Reset is pressed.
- **Position limit** — a profile may cap the axis travel. On connect, on a
  limit change, and after every step write, all 64 slots are scanned; if any
  stored position exceeds the cap, Move is refused until it is corrected.
  Writing a step above the cap is refused outright.

### Step editing

Slot **0** is reserved for Init. It is always named `Init`, its name and
position are read-only, and neither the UI nor the API will delete it. The
operator's own steps start at **1**, and `Step (6)` means six of those are
stored — the selector will not go past them.

Selecting a slot loads it, so there is no Read button — step through the table
with the full-height `<` and `>` buttons either side of the number, or type one
in. One **Save** commits the position and the name together — it stays disabled
until something actually differs from what is stored.

The selector always reaches exactly **one slot past** the registered range, and
that slot is marked `· new`: fill it in, press Save, and it is registered. A new
slot starts from a working preset — mode 1, 5 mm/s, 3000 mm/s² accel and decel,
5 mm/s push speed, 100 % move force, 0.5 mm width — rather than the zeros an
empty slot reads back as, and registering it always writes the whole preset even
with Full edit off.
**Delete** removes a step and pulls the ones above it down, so numbering stays
contiguous — deleting step 3 of 6 leaves steps 1–5, with the old 4, 5 and 6
renumbered. Their labels move with them, and the form reloads the slot
afterwards: what is on screen is whatever now occupies that number, never the
step that was just deleted. Mode, speed, acceleration, push force and the AREA window live
behind **Advanced** and stay read-only until **Full edit** is switched on —
routine repositioning should not be able to rewrite push force by accident.
With Full edit off, saving keeps every stored value and forces a plain absolute
move at 5 mm/s.

### What the commands do

| | |
|---|---|
| **Init** | Return to origin and establish the coordinate system. Needs a live servo, and leaves the servo on — so SV On is disabled after it, and Init is disabled after an SV Off. |
| **SV On / SV Off** | Energise or release the servo. Only the useful direction is enabled: after Init the servo is already on, so SV On greys out. SV Off leaves the stage where it stands, and the tab keeps showing which step that is. |
| **Disconnect** | Closes the session. If SV Off is legal at that moment it is sent first, so the axis is never left energised by a disconnect. |
| **Move** | Drive to the selected step. |
| **Stop** | Halt the move, discard the remaining travel, and clear resettable alarms. Also available with the servo off whenever a non-critical alarm is standing — group B–D alarms are ignored until RESET is pulsed (manual §15.1), so SV On does nothing until this is pressed. The axis is then *between* steps, which the UI reports as `Step -1 · stopped`; pick a step and Move again. |

### Unattended axes

An energised axis holds torque on the stage for no reason, so the server
switches the servo off after **5 minutes** without an operator command. The UI
marks it `Idle release`; SV On takes the axis back. Set
`ACTUATOR_IDLE_TIMEOUT=0` to disable, or to any number of seconds.

Every move, every servo release and every disconnect records where the axis was
left, in `data/last_positions.json`. That record is served by
`GET /api/last-positions` and shown on the Connect tab,
so where the stages are standing is legible with nothing connected at all.

### Status for the log

`GET /api/report.txt` answers with one fixed-column line per profile, whether or
not it is connected — so a shift log entry is one command:

```
curl -s http://<host>:8080/api/report.txt >> ~/beamline.log
```

```
Actuator status  2026-08-29T19:41:30+09:00

Actuator          IP             Conn  Servo  Step      Position  Alarm  Seen
R-W1 Downstream   192.168.1.150  x     -      -         0.00 mm   -      2026-08-29 19:40
L-W1 and Plastic  192.168.1.152  x     -      -         0.00 mm   -      2026-08-29 19:38
Collimator        192.168.1.153  o     on     3 · 3 cm  36.23 mm  -      -
```

`Conn` is o/x, `Servo` is the SVRE signal, `Step` is `stopped` when a move was
abandoned part-way and `-` when the axis has not been driven this session, and
`Alarm` lists every non-zero code. `Seen` is when the reading was taken and is
filled in only for a disconnected axis, whose position and step come from
`last_positions.json` and are therefore history, not status.

`GET /api/report` is the same data as JSON. In the UI, **Copy status** on the
Connect tab puts the text block on the clipboard; on a plain-http origin, where
browsers refuse clipboard writes, it shows the text to select instead.

### The two status files

The server keeps its own record in `backend/data`, and the two files answer
different questions:

| File | Question | Written |
| --- | --- | --- |
| `status.json` | where does everything stand *now*? | overwritten on every change, and at least once a minute |
| `status.jsonl` | what happened? | appended to, one line per change |

`status.json` holds the same rows as `GET /api/report` — one entry per profile
under `actuators`, connected or not. Because it is rewritten on a heartbeat as
well as on change, its `at` doubles as a liveness signal: a timestamp older than
a couple of minutes means the server is not running, not that the beamline is
quiet.

The log is what a watcher writes: it compares the same rows once a second and
appends whenever one changes — JSON Lines, one labelled object per
change, so nothing needs a key to the columns:

```json
{"at": "2026-08-29T19:58:45+09:00", "events": ["move 3"], "actuator": "Collimator",
 "ip": "192.168.1.153", "connected": true, "servo_on": true, "homed": true,
 "moving": true, "stopped": false, "step": 3, "step_name": "3 cm",
 "position_mm": 11.4, "alarms": []}
```

| Field | Meaning |
| --- | --- |
| `at` | when the change was seen; local time, ISO 8601 |
| `events` | what changed: `connect`, `disconnect`, `sv on`, `sv off`, `init`, `move N`, `settled`, `stop`, `alarm N`, `alarm clear` |
| `actuator`, `ip` | which axis, by profile name and address |
| `connected` | whether a session was open |
| `servo_on` | the SVRE signal |
| `homed` | the origin is established (Init has run) |
| `moving` | the BUSY signal |
| `stopped` | a move was abandoned part-way with Stop |
| `step`, `step_name` | the slot it was sent to, and its label; `null` before the axis is driven |
| `position_mm` | position at that instant, in millimetres |
| `alarms` | every non-zero alarm code standing at that instant |

Loading it is one line — `[json.loads(line) for line in open(path)]` — and
`GET /api/log.txt` renders the same records as a table for reading:

```
Time                       Event        Actuator    Conn  Servo  Step      Position  Alarm
2026-08-29T19:58:40+09:00  connect      Collimator  o     off    -         0.00 mm   -
2026-08-29T19:58:43+09:00  sv on, init  Collimator  o     on     -         0.00 mm   -
2026-08-29T19:58:45+09:00  move 3       Collimator  o     on     3 · 3 cm  11.40 mm  -
2026-08-29T19:58:48+09:00  settled      Collimator  o     on     3 · 3 cm  36.23 mm  -
2026-08-29T19:58:54+09:00  sv off       Collimator  o     off    3 · 3 cm  36.23 mm  -
```

Comparing state rather than hooking each command is deliberate: it catches what
the controller does on its own — an alarm latching, a move finishing, the idle
watchdog releasing a servo — as well as what the operator asks for, and there is
one place that decides what counts as a change. Position is deliberately not
compared (it moves continuously, which would write a line per tick); it is
recorded on every line instead.

It runs whether or not a browser is open, writes a final record for each axis
when the server stops, and rotates to `status.jsonl.1` at 5 MB. `GET /api/log`
serves the tail as JSON and `GET /api/log.txt` as the table above — `?lines=500`
for more than the default 200. The Reference tab links to both and lists the
fields.

Set `ACTUATOR_STATUS_LOG` to another path to move it, or to nothing to switch it
off; see the configuration table below for the rest.

### Interface

Built for a lit bench, read from a metre away, operated by people who should
never have to hunt for a control:

- **Two halves per tab.** The first card is the axis: where it is, and the
  commands that decide whether it can move at all (Init, SV On, SV Off,
  Disconnect). The second is the job: pick a step, set its position, Move, Stop,
  Save or Delete.
- **One button size.** Every command button is 156×46, so no control is easier
  to hit by accident than its neighbour and each row reads as one surface.
- **Minimum / Rich.** One switch in the header, shared by every tab, because
  reading depth is a property of the operator rather than of one axis. Minimum
  is the running view: the step, the position, the rail, and the signals that
  are currently true, with Advanced folded away — even the name/IP line is dropped, since the tab already
  carries it. Rich adds that line back plus target, speed, force and OUT, and
  lists every signal with its state, and opens Advanced — the view for working
  out why something is not READY.
- **The chart is the axis.** A rail from 0 to the profile maximum, with every
  registered step marked on it and the live position riding along. "Where is
  it, where can it go, where is it going" is one glance.
- **Light theme only.** A dark panel washes out under bench lighting.
- **Large targets.** Move is a full-width primary button; the commands beside
  it are all the same size, so none is easier to hit by accident than another.
- **Two cards per tab.** The axis on top, the step you are driving it to below.
- **Fixed header.** The tabs stay at the top of the window however far the page
  scrolls, so switching axes never needs a scroll first.
- **Connect is a tab.** The first tab lists every saved actuator with where it
  was last left, connects one in a click, and holds the profile settings. The
  header above it carries nothing but Minimum / Rich.
- **One-line status for the log.** *Copy status* on the Connect tab puts a
  fixed-column snapshot of every profile — connected, servo, step, position,
  alarm — on the clipboard. `GET /api/report.txt` is the same thing for a
  script; `GET /api/report` is the JSON behind it.
- **Reference is a tab too.** An icon at the far end of the row opens the two
  things you cannot look up from the panel itself: how to change the homing
  speed (a controller parameter that is not on EtherNet/IP), and every alarm
  code with its group, how it clears, and what to check. The manuals are served
  from `/docs`, so they open in a tab rather than living on somebody's laptop.
- **Tabs are coloured by state.** Two lines — the axis name, and underneath it
  what it is doing and which step it is parked at. Green means Init is done and
  the servo is live, grey means it is not (either reason), red is a critical
  alarm, and Connect keeps its blue. From across the room the tab row says which
  axes are live before any word is readable.
- **Tabs shed detail, not tabs.** As the window narrows a tab drops its second
  line, then clips its name — so every axis stays reachable instead of wrapping
  onto a second row.


## Layout

```
docs/                     manuals (PDF + text) and the homing-speed procedure
backend/
  run.py                  entry point, LAN URL discovery
  requirements.txt
  data/
    profiles.json         saved axes; deleted IPs are remembered as hidden
    step_names.json       step labels, per actuator IP
    last_positions.json   where each axis was last left standing
  tools/simulator.py      fake axes for UI development
  app/
    main.py               FastAPI app, CORS, static UI mount
    config.py             paths and tunables (env-overridable)
    schemas.py            request/response models
    dependencies.py       actuator lookup, error -> HTTP status
    net.py                which LAN URL to tell the operator to open
    routers/
      profiles.py         profile CRUD
      actuators.py        connect, commands, step table
      reference.py        alarm table for the help screen
      report.py           status snapshot and status-log tail
    reporting.py          the rows behind both the report and the log
    logbook.py            watcher that writes a line on every change
      status.py           WebSocket broadcast
    hardware/
      jxc91.py            CIP driver: codecs, operations, polling thread
      alarms.py           alarm code table
      manager.py          per-axis session state and guards
      hub.py              registry of open connections
    store/
      profiles.py         profiles.json
      step_names.py       step_names.json
      status_log.py       status.jsonl, append and rotate
      snapshot.py         status.json, atomic overwrite

frontend/src/
  App.tsx                 NEON screen: top bar, tabs, layout
  index.css               actuator's own layout on NEON's tokens
  components/             status panel, move panel, controls, connect + help panels
  hooks/                  status stream, position history, profiles, actions
  lib/                    API client, types, gating rules, formatting
```

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `ACTUATOR_DATA_DIR` | `backend/data` | where the JSON files live |
| `ACTUATOR_STATIC_DIR` | `frontend/dist` | built UI to serve |
| `ACTUATOR_BROADCAST_INTERVAL` | `0.2` | seconds between status pushes |
| `ACTUATOR_IDLE_TIMEOUT` | `300` | seconds before an idle servo is released; `0` disables |
| `ACTUATOR_STATUS_LOG` | `backend/data/status.jsonl` | change log path; empty or `0` disables |
| `ACTUATOR_STATUS_SNAPSHOT` | `backend/data/status.json` | current-state path; empty or `0` disables |
| `ACTUATOR_STATUS_LOG_MAX_BYTES` | `5000000` | rotate to `status.jsonl.1` past this size |
| `ACTUATOR_LOG_INTERVAL` | `1.0` | seconds between logbook comparisons |
| `ACTUATOR_DOCS_DIR` | `docs` | manuals served read-only at `/docs` |

### Maintenance

`tools/set_step_speed.py` rewrites the speed of every registered step on one or
more axes. It previews by default and writes only with `--apply`. Stop the
server first — two clients writing the same step table is not something the
controller arbitrates.

```bash
cd backend
python tools/set_step_speed.py --speed 5                    # preview every axis
python tools/set_step_speed.py --speed 5 --apply            # commit
python tools/set_step_speed.py --speed 5 --ip 192.168.1.153 --apply
```

**Return-to-origin speed cannot be set from here.** Init asserts the
controller's SETUP signal and nothing else. How fast the axis homes is the
`ORIG speed` return-to-origin parameter (manual §10.3), and §4.4 lists exactly
one object on EtherNet/IP — *SMC Step Data Object, class 67h, instances 1-64,
attribute 100*. There is no parameter object on the network, so `ORIG speed`
is reachable only over the controller's serial/USB port.

To change it, from the ACT Controller help (§5.1, §5.3.5):

1. Connect the PC to the controller with the **JXC-W2A-C** USB cable — ACT
   Controller talks over a COM port, never over Ethernet.
2. Open **ACT Controller** in **Normal mode** (Easy mode has no parameter
   window) and let it find the controller.
3. **Parameter window → Upload** to read what is currently in the controller.
4. Edit the return-to-origin **`ORIG speed`**. Its allowable range depends on
   the actuator, not the controller — check the actuator catalogue.
5. **Download** to write it back. It takes effect immediately (`■` in the
   manual's Write column), no restart needed.

Either value of the `Para protect` basic parameter (1 or 2) permits editing
return-to-origin parameters, so protection is not in the way.

The whole procedure is written up in [`docs/init-speed.html`](docs/init-speed.html) —
what to check before touching anything, why the network cannot reach the
parameter, the ACT Controller steps, and the other return-to-origin parameters
worth changing (an origin sensor makes `ORIG mode 2` a better fix than a slower
speed).

Both manuals are in [`docs/`](docs/) as PDF and as extracted text, so they can
be grepped:

    docs/JXC91_operation_manual_SFOD-OMT0006-G.*   controller, objects, alarms
    docs/ACT_Controller_help_JXC-OMU0010-A.*       the setting software
    docs/init-speed.html                           the procedure, written up

Profiles and step names are plain JSON and can be edited by hand while the
server is stopped.
