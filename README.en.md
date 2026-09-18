<div align="center">

<img src="docs/screenshots/icon.png" width="120" alt="Kairos" />

# Kairos

**The right moment** · A minimal desktop calendar and reminder widget for Windows

[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)](#)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](#)
[![License](https://img.shields.io/badge/license-MIT-3DA639)](#license)

A calendar card that lives on your desktop. No app to open — just glance at it and know what today looks like.

[简体中文](README.md) · **English**

> **Heads-up:** the app UI is currently in Simplified Chinese only — English localization is on the roadmap.
> This document describes the current build.

</div>

---

## Why "Kairos"

Greek has two words for time. *Chronos* is time as it ticks by. *Kairos* is **the right moment** — the instant when something should happen.

A reminder tool was never really about *what time is it*. It's about *when should I remember this*. That's where the name comes from, and that's what the icon shows: a time ring with a gap, and a single dot resting in it.

## Features

**Calendar & to-dos**
- A frameless, frosted-glass card that stays on your desktop. Drag it anywhere, resize from 8 directions; position and size are remembered across restarts
- **Lunar calendar & 24 solar terms**: each cell shows the lunar date, with traditional festivals and solar terms substituted automatically and color-coded. The lunar calendar comes from the built-in ICU Chinese calendar (zero dependencies, zero data tables); solar terms are computed from the sun's apparent ecliptic longitude
- **Dark mode** follows the system, or force light/dark in settings
- **Sits on the desktop** by default — it does *not* float above your work windows, so it gets covered when you switch to another app and is only there when you look at the desktop. Can be switched back to "always on top" in settings
- Repeat rules (daily / weekdays / weekly / monthly) and lead time (on time / 5 / 15 / 30 minutes early)
- Colored dots on each date cell show at a glance which days have something scheduled

**Two independent reminder channels (per to-do)**

| System notification | Strong reminder | What happens |
| :---: | :---: | --- |
| ✅ | ❌ | Windows toast at the scheduled time — unobtrusive |
| ❌ | ✅ | In-app reminder window pops up |
| ✅ | ✅ | **Toast first; if still unhandled after 5 minutes, escalates to the reminder window** |
| ❌ | ❌ | Just a note on the calendar — no interruption at all |

Both labels in the to-do list **are clickable** — toggle them right there, no need to delete and recreate.

**Chinese public holidays**
- Built in from the official State Council announcements: holidays in red, and **make-up workdays (调休补班) marked "班"**
- Covers 2025 and 2026. Years without data gracefully degrade to "public holidays only" — it never invents dates

**Calendar sync**
- **Outlook direct**: detects a local Outlook desktop install and reads from it — no export needed
- **ICS file**: just pick a `.ics` file
- **ICS subscription**: paste a `webcal://` or `https://` URL and it refreshes on a schedule
- Multiple sources coexist, each with its own toggle and color. **A failed sync records the reason and keeps existing data** — your calendar never goes blank because of a flaky network

## Screenshots

<div align="center">

<img src="docs/screenshots/calendar.png" width="360" alt="Main calendar window" />

<sub>The main card — "today" highlighted in blue, the three Mid-Autumn Festival days in red,<br />Sep 20 marked "班" (a make-up workday), lunar dates and solar terms below each day number,<br />and synced events from your computer calendar listed under the to-dos</sub>

<br /><br />

<img src="docs/screenshots/reminder.png" width="330" alt="Strong reminder window" />

<sub>The strong reminder — a separate window, always kept above everything else</sub>

</div>

## Getting started

### Install

Download `Kairos-x.y.z-setup.exe` from [Releases](../../releases) and run it.

The installer is **not code-signed**, so Windows SmartScreen will warn about an unknown publisher — click *More info → Run anyway*.

You can choose the install directory. **Uninstalling does not delete your data** (to-dos, layout and settings stay in `%APPDATA%\Kairos\`).

### Run from source

```bash
git clone https://github.com/jinmingzhi2005/kairoskairos.git Kairos
cd Kairos
npm install
npm run dev      # dev mode with HMR
```

Requires Node.js ≥ 18.

## Usage

On launch you get a calendar card parked in the top-right of your primary display. Drag the header to move it, drag the bottom-right corner to resize — it remembers where it was.

| Action | How |
| --- | --- |
| Open / close settings | The gear icon in the card's top-right corner |
| Should the calendar cover other windows? | Settings → "Sits on the desktop" (turn off for always-on-top) |
| Lunar calendar / dark mode / holidays | Separate toggles in the settings panel |
| Show / hide the calendar | Left-click the tray icon, or `Alt+Space` |
| Add a to-do | Pick a date → type a title → choose a time and reminder channels → add |
| Change reminder channels | **Click the "系统通知" / "强提醒" labels right on the to-do row** |
| Quit | Right-click the tray icon → Quit |

The card snaps to screen edges. And if you drag it off-screen, don't worry — it gets pulled back into view on next launch.

## Development

```
src/
├── main/            Main process
│   ├── index.ts         Entry: single-instance lock, data directory migration
│   ├── ipc.ts           IPC registration, tray callbacks, reminder dispatch, theming
│   ├── logger.ts        Synchronous file logging (the first thing to check on startup issues)
│   ├── services/
│   │   ├── todoService.ts     To-dos and reminder scheduling (two-stage escalation lives here)
│   │   ├── calendarSync.ts    Sync source management and fetching
│   │   ├── icsParser.ts       Hand-written ICS parser (zero-dependency pure functions)
│   │   ├── outlookService.ts  Reads Outlook via COM through a command-line script
│   │   ├── win32.ts           Pushes a window to the bottom of the Z-order (for desktop mode)
│   │   └── settingsService.ts / autostart.ts / displayService.ts / cardStore.ts
│   └── windows/
│       ├── calendarWindow.ts  Calendar window + size compensation
│       └── reminderWindow.ts  Strong reminder popup
├── preload/         contextBridge allow-listed API
├── renderer/        Two renderer entries
│   ├── index.html      Calendar window
│   ├── reminder.html   Reminder popup
│   └── src/{calendar,reminder,components,hooks,lib,styles}
└── shared/          Types, IPC channel constants, holiday data, lunar/solar terms, repeat rules
```

### A few design decisions

- **Two renderer entries.** The strong reminder is its own window rather than a view inside the calendar window, so a reminder can never be affected by whatever state the calendar is in.
- **Hand-written ICS parser.** It ships inside a single `app.asar`, and every runtime dependency is one more thing that can break packaging. Being a zero-dependency pure function also means it can be unit-tested without booting Electron at all.
- **The lunar calendar is not computed by hand.** It comes straight from the runtime's built-in ICU Chinese calendar (`Intl.DateTimeFormat('zh-CN-u-ca-chinese')`) — no data tables to maintain or get wrong. Solar terms, which ICU doesn't provide, *are* computed: the moment the sun's apparent ecliptic longitude crosses a multiple of 15°.
- **Window size compensation.** On Windows, a frameless transparent window's actual bounds differ from the requested size by a few pixels. Without compensating, every drag-resize accumulates drift. All of it is absorbed inside the main process — the renderer only ever sees "nominal geometry".
- **Reminder scheduling lives in the main process.** The renderer can be recycled (window hidden, crashed and recreated) and reminders still fire.
- **Desktop mode sinks the window on blur, not on a timer.** Click the card and it naturally rises (you're using it); click elsewhere and it settles back down — more natural than polling which window is focused.

## Testing

```bash
npm run verify          # everything in one command
```

| Command | What it covers |
| --- | --- |
| `npm run typecheck` | Type checks for both main and renderer projects |
| `npm run test:unit` | 40 assertions: holiday resolution, lunar calendar and solar terms, ICS parsing (pure functions, no Electron) |
| `npm run test:reminders` | 17 assertions: reminder scheduling, including all four channel combinations and two-stage escalation |
| `npm run test:tray` | 5 assertions: reminder data channel; test reminders must not touch real data |
| `npm run test:sync` | 13 assertions: real ICS file → cache → IPC, end to end |
| `npm run test:window` | 10 assertions: window layering (calendar must not be on top, reminder must be) |
| `npm run smoke` | Render smoke test + layout guards (dot sizes, child overflow), exports preview images for visual review |

These tests **run the real main process and assert on data read back**, not mocks that have been hollowed out to the point of meaninglessness. `test:reminders`, for example, writes a to-do file, boots the actual app, then reads `todos.json` to verify which entries fired and which correctly did not.

Anything with "wait N minutes" semantics exposes an environment variable so it can be tested: `KAIROS_TICK_MS` (scheduler polling interval) and `KAIROS_ESCALATE_MS` (toast → strong reminder delay). Compress them to 1.5s / 3s and the whole two-stage chain verifies in seconds.

## Building

```bash
npm run icons                              # generate icons at all sizes
KAIROS_OUT_DIR=out npm run build           # emit JS bundles
npm run clean:artifacts                    # purge orphaned files from earlier builds
node scripts/run.mjs electron-builder --win nsis --publish never
```

Output lands in `release/`.

> `clean:artifacts` is not optional. Builds use `emptyOutDir: false`, which means files from
> previous builds linger in `assets/` and get bundled into the installer. The script decides
> what's orphaned based on **what the HTML actually references** — not by guessing from the
> hash in the filename. (I got that wrong once and deleted the current build.)

## Data & privacy

**Everything stays on your machine.** No telemetry, no uploads:

```
%APPDATA%\Kairos\
├── todos.json          To-dos
├── card.json           Card position and size
├── settings.json       Settings
├── syncSources.json    Calendar sync sources
├── syncEvents.json     Cached synced events
└── kairos.log          Runtime log
```

The only time it touches the network is when you add an ICS subscription URL — in which case it fetches that URL. Outlook integration is entirely local, over COM.

## Known limitations

1. **Holiday data needs a manual yearly update.** The State Council publishes the next year's schedule around November; 2025 and 2026 are included. Years without data fall back to public holidays only.
2. **Chinese holidays only for now.** The data structure is already region-aware — adding another country is a matter of adding one table.
3. **No full timezone conversion for ICS.** Events with `TZID=` are interpreted as local time (UTC timestamps ending in `Z` are converted correctly).
4. **No `EXDATE` / `BYSETPOS`.** Complex recurrence rules degrade to a single event rather than crashing.
5. **Windows installer only.** The code itself is cross-platform, but macOS and Linux have not been adapted or tested.

## Roadmap

- [x] Lunar calendar and solar terms <sub>v1.2.0</sub>
- [x] Dark mode following the system <sub>v1.2.0</sub>
- [ ] Configurable escalation delay (currently hard-coded at 5 minutes)
- [ ] Holidays for more countries / regions
- [ ] Lunar-calendar-based recurrence (e.g. "remind me every New Year's Eve")
- [ ] Drag-to-reorder and grouping for to-dos
- [ ] Two-way sync for calendar subscriptions (currently read-only)
- [ ] English UI

## License

[MIT](LICENSE) © 2026 Kairos
