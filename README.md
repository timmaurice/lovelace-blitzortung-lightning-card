# Blitzortung Lightning Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://github.com/hacs/integration)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/timmaurice/lovelace-blitzortung-lightning-card?style=flat-square)
[![GH-downloads](https://img.shields.io/github/downloads/timmaurice/lovelace-blitzortung-lightning-card/total?style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/timmaurice/lovelace-blitzortung-lightning-card.svg?style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card/commits/master)
[![GH-code-size](https://img.shields.io/github/languages/code-size/timmaurice/lovelace-blitzortung-lightning-card.svg?color=red&style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card)
![GitHub](https://img.shields.io/github/license/timmaurice/lovelace-blitzortung-lightning-card?style=flat-square)

A Home Assistant Lovelace card to display data from the [Blitzortung](https://github.com/mrk-its/homeassistant-blitzortung) integration. It shows the distance, direction, and total count of recent lightning strikes. It also features a compass, a radar chart for visualizing recent strike locations, a history chart, and an optional map view.

![Blitzortung Lightning Card Screenshot](https://raw.githubusercontent.com/timmaurice/lovelace-blitzortung-lightning-card/main/image.png)

## Installation

### Prerequisites

This card requires the official [Blitzortung.org integration](https://github.com/mrk-its/homeassistant-blitzortung) to be installed and configured in Home Assistant.

You must have the following sensors from the integration:

- `sensor.blitzortung_lightning_distance`
- `sensor.blitzortung_lightning_counter`
- `sensor.blitzortung_lightning_azimuth`

For the map and radar features to work, you must also enable the creation of `geo_location` entities in the Blitzortung integration's options. The card automatically finds and uses `geo_location.lightning_strike_*` entities.

## Installation

### HACS (Recommended)

This card is available in the [Home Assistant Community Store (HACS)](https://hacs.xyz/).

<a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=timmaurice&repository=lovelace-blitzortung-lightning-card&category=plugin" target="_blank" rel="noreferrer noopener"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open your Home Assistant instance and open a repository inside the Home Assistant Community Store." /></a>

### Manual Installation

1.  Download the `blitzortung-lightning-card.js` file from the latest release.
2.  Place it in your `config/www` directory.
3.  Add the resource reference to your Lovelace configuration under `Settings` -> `Dashboards` -> `...` -> `Resources`.
    - URL: `/local/blitzortung-lightning-card.js`
    - Resource Type: `JavaScript Module`

## Usage

Once installed, add the card to your Lovelace dashboard.

You can add the card through the UI. When you add a new card, search for "Blitzortung Lightning Card" and configure it using the visual editor.

For YAML mode, here is a minimal configuration:

```yaml
type: custom:blitzortung-lightning-card
distance: sensor.blitzortung_lightning_distance
counter: sensor.blitzortung_lightning_counter
azimuth: sensor.blitzortung_lightning_azimuth
```

## Features

- A **compass rose** that shows the direction of the latest strike.
  - Displays the distance, direction, and total count of the latest lightning strike.
  - The entities inside the compass are clickable and show the entity's more-info dialog.
- A D3.js-powered **radar chart** to plot the location of multiple recent strikes.
  - Strikes on the radar gradually fade out over a configurable time period (`15m`, `30m`, or `1h`).
  - Tooltips on radar strikes show exact distance and azimuth on hover.
  - Customizable colors for the compass, radar, and strikes.
- An optional **history chart** showing the number of strikes in…
  - 10-minute intervals over the last hour or
  - 3-minute intervals over the last 15 minutes.
- An optional interactive **map** to show strike locations relative to your home.
  - Displays strikes from the same time period as the radar.
  - Stops auto-zooming on user interaction, allowing for free exploration.
  - Includes standard zoom controls and a recenter button.
  - Animated markers for new strikes on the map.
  - Supports theme override to force light or dark mode.

## Card Configuration

The card can be configured using the visual editor.

| Name                      | Type      | Description                                                                                                  | Default                     |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `type`                    | `string`  | **Required.** `custom:blitzortung-lightning-card`                                                            |                             |
| `distance`                | `string`  | **Required.** The entity ID for the lightning distance sensor.                                               |                             |
| `counter`                 | `string`  | **Required.** The entity ID for the lightning strike counter sensor.                                         |                             |
| `azimuth`                 | `string`  | **Required.** The entity ID for the lightning azimuth sensor.                                                |                             |
| `title`                   | `string`  | The title of the card.                                                                                       | `⚡ Lightning localization` |
| `auto_radar_max_distance` | `boolean` | If `true`, the radar's maximum distance will scale automatically to fit all strikes.                         | `false`                     |
| `radar_max_distance`      | `number`  | The maximum distance for the radar chart. Only used if `auto_radar_max_distance` is `false`.                 | `100`                       |
| `radar_period`            | `string`  | The time window for strikes shown on the radar and map. Can be `'15m'`, `'30m'`, or `'1h'`.                  | `'30m'`                     |
| `show_map`                | `boolean` | If `true`, displays an interactive map of recent strikes.                                                    | `false`                     |
| `map_theme_mode`          | `string`  | Overrides the map's theme. Can be `'auto'`, `'light'`, or `'dark'`. Defaults to `'auto'` (follows HA theme). | `'auto'`                    |
| `show_history_chart`      | `boolean` | If `true`, displays a bar chart of strike history.                                                           | `true`                      |
| `history_chart_period`    | `string`  | The time period for the history chart. Can be `'1h'` or `'15m'`.                                             | `'1h'`                      |
| `grid_color`              | `string`  | The color for the radar grid lines and labels. Accepts CSS colors (e.g., `#ffffff`, `var(--primary-color)`). | `var(--primary-text-color)` |
| `font_color`              | `string`  | The color for the font inside the compass and the history chart's axis labels.                               | `var(--primary-text-color)` |
| `strike_color`            | `string`  | The color for the lightning strikes on the radar.                                                            | `var(--error-color)`        |
| `history_chart_bar_color` | `string`  | A single color for the history chart bars. If set, it overrides the default theme with an opacity gradient.  | (default theme)             |

## How It Works

The card is designed to work out-of-the-box with the Blitzortung integration, without requiring any extra YAML helpers or automations.

- The **radar and map** features automatically use the `geo_location.lightning_strike_*` entities created by the integration.
- The **history chart** fetches data for your `counter` entity directly using the Home Assistant history API.

This approach ensures that the data is always in sync with Home Assistant and simplifies setup.

## Visualizations

### Compass and Radar Chart

The card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot, overlaid on a compass rose. The strikes on the radar will gradually fade out over a configurable time period (`15m`, `30m`, or `1h`), with the most recent strike being the most prominent.

You can customize its appearance with these options:

- **Tooltips**: Hovering over a strike on the radar will show a tooltip with its exact distance and azimuth.
- **Radar Max Distance**: By default, you set a fixed maximum range for the radar chart in your distance unit (e.g., km or mi). You can also enable automatic scaling, which will adjust the range based on the furthest strike. The editor provides a helpful tip for aligning this value with your Blitzortung integration settings.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

### History Chart

When enabled with `show_history_chart: true`, the card displays a bar chart showing the number of strikes over a configurable period. The default is 1 hour (with 10-minute intervals), but a 15-minute view (with 3-minute intervals) is also available via the `history_chart_period` option. The bars are color-coded by age, from red (most recent) through orange and yellow, to gray (oldest).

### Map Integration

The card uses the `geo_location.lightning_strike_*` entities to plot strikes from the configured radar time period on an interactive map. If your Home Assistant `zone.home` is configured, it will also be displayed as a reference point. The map features auto-zoom, which initially adjusts the view to fit all displayed strikes. This is automatically disabled when you interact with the map (pan or zoom), allowing for free exploration. The recenter button not only centers the map on the strikes but also re-enables auto-zoom. Standard `+/-` zoom controls are also provided for easy navigation. To enable this feature, simply toggle the "Show Map" option in the card's visual editor.

## Example Configuration

```yaml
type: custom:blitzortung-lightning-card
title: Lightning Strikes
distance: sensor.blitzortung_lightning_distance
counter: sensor.blitzortung_lightning_counter
azimuth: sensor.blitzortung_lightning_azimuth
radar_max_distance: 150
show_map: true
map_theme_mode: dark
show_history_chart: true
history_chart_period: 15m
grid_color: 'var(--secondary-text-color)'
font_color: 'var(--primary-text-color)'
strike_color: '#ffeb3b'
```
