# Correlate

Log a few self-defined metrics every day and see them side by side in a calendar, so patterns
between them are visible at a glance. Plain HTML/CSS/JS, no build step. This is a mock-up.

## Run

```
npm start            # python3 -m http.server 8080
# or any static server, e.g. npx serve .
```

Then open http://localhost:8080.

## Alternative UI

`tactical.html` is a second front-end over the same data and engine: a phosphor-green CRT look with
HUD readouts on the calendar scope, a TARGET DAY panel and a status bar (`css/tactical.css`,
`js/tactical.js`). Both UIs share `js/app.js`, so anything logged in one shows up in the other.

## Structure

- `index.html` — standard UI: metrics panel, calendar/graph, day entry (open `tactical.html` directly for the other skin)
- `css/styles.css` — theme tokens (light/dark), lanes, chips, graph
- `js/app.js` — data model, default metrics, rendering, persistence; exposes `window.Correlate` and fires `correlate:render`
- `tactical.html`, `css/tactical.css`, `js/tactical.js` — the tactical skin and its extra chrome

## Model

A **metric** has a name and an ordered list of **options**. Each option has a label, a colour and a
numeric value. A day holds at most one option per metric. Colour convention in the default metrics: one hue
per metric, lighter shades for lower values, so correlation reads by shade across lanes.

The **day score** is the sum of the values of the options logged that day.

## Views

The switch above the calendar toggles **Calendar** and **Graph** (`G` also toggles). The graph draws a **Day score**
strip first (always present, outside the metric filter, scaled from 0 to the month's highest score), then
one strip per visible metric on a shared day axis for the month: each logged day is a point in its option's
colour, placed by the option's rank within the metric (lowest value at the bottom), joined by a line in
the metric's middle colour and broken where days are unlogged. Weekends are shaded, today and the selected
day are marked, hovering a day shows every visible metric's option, and clicking a day selects it for day
entry. The metrics menu filters both views. The active view is kept in `settings.view`.

## Data

Everything the app persists lives in a single `localStorage` object under `correlate.v1`:

```
{
  version: 3,
  metrics:  [{ id, name, options: [{ id, label, color, value }] }],
  entries:  { "YYYY-MM-DD": { metricId: optionId } },
  settings: { theme: "light" | "dark" | "system", metricsCollapsed: bool,
              visible: null | [metricId], view: "calendar" | "graph" }
}
```

Every mutation writes the whole object back. First load creates five default metrics (Walking, Sleep,
Mood, Caffeine, Stress) with an empty log. Older installs that used the separate `correlate.mock.v1` and
`correlate.theme` keys are folded into the new object once, on the first load that finds them, and the old
keys are removed; version 1 stores carried generated sample entries, which are dropped on upgrade to
version 2; version 3 appends the Stress metric once to stores that lack it.

## Theme

The theme button in the top bar opens a Light / Dark / System menu. System follows the OS setting live.
`⌘⇧L` toggles light and dark directly. The choice is stored in `settings.theme` of the app's `localStorage` object.
The tactical UI ignores it and always renders dark.

## Metric filter

The button above the calendar ("All metrics" by default) opens a checklist: All at the top, then every
metric. Unchecked metrics lose their lane in each day cell (and their strip in the graph), so two or three
metrics can be compared across days without the others in the way; the day score in each cell still sums
every metric. Day entry still lists
every metric. The choice is kept in `settings.visible` (`null` when everything is shown, so new metrics
appear automatically).

## Keyboard

`←` / `→` previous and next month, `T` today, `G` graph/calendar, `⌘⇧L` toggle light/dark. Click a day to select it, then click option chips to log. A metric with nothing logged on the selected
day rests its chip row on the most recent earlier value (up to a week back), since a new day usually
resembles the one before; nothing is logged until a chip is tapped. Edit on a metric card reveals its options plus
+ Option, Duplicate (copies the metric and its options, placed right after it) and Delete. The < button in the
metrics pane header collapses the pane to a narrow rail; the choice is kept in `settings.metricsCollapsed`.
Drag a metric card by its grip to reorder metrics (the lane order in the calendar follows), and drag an
option row by its grip to reorder options within a metric (chip order in day entry follows). With a grip
focused, `↑` / `↓` move the item too.
