# Blitzortung Lightning Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://github.com/hacs/integration)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/timmaurice/lovelace-blitzortung-lightning-card?style=flat-square)
[![GH-downloads](https://img.shields.io/github/downloads/timmaurice/lovelace-blitzortung-lightning-card/total?style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/timmaurice/lovelace-blitzortung-lightning-card.svg?style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card/commits/master)
[![GH-code-size](https://img.shields.io/github/languages/code-size/timmaurice/lovelace-blitzortung-lightning-card.svg?style=flat-square)](https://github.com/timmaurice/lovelace-blitzortung-lightning-card)
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
distance_entity: sensor.blitzortung_lightning_distance
counter_entity: sensor.blitzortung_lightning_counter
azimuth_entity: sensor.blitzortung_lightning_azimuth
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

## Localization

This card is localized for the following languages:

- English
- German
- Dutch
- French
- Russian
- Slovenian
- Ukrainian

If you would like to contribute translations for other languages, please open a pull request.

## Card Configuration

The card can be configured using the visual editor.

| Name                         | Type      | Description                                                                                                                     | Default                     |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `type`                       | `string`  | **Required.** `custom:blitzortung-lightning-card`                                                                               |                             |
| `distance_entity`            | `string`  | **Required.** The entity ID for the lightning distance sensor. The editor filters for entities ending in `_distance`.           |                             |
| `counter_entity`             | `string`  | **Required.** The entity ID for the lightning strike counter sensor. The editor filters for entities ending in `_counter`.      |                             |
| `azimuth_entity`             | `string`  | **Required.** The entity ID for the lightning azimuth sensor. The editor filters for entities ending in `_azimuth`.             |                             |
| `latitude`                   | `number`  | **Optional.** Override the latitude from your Home Assistant configuration.                                                     | (HA default)                |
| `longitude`                  | `number`  | **Optional.** Override the longitude from your Home Assistant configuration.                                                    | (HA default)                |
| `overwrite_home_location`    | `boolean` | If `true`, allows manually setting latitude and longitude to override the Home Assistant default location.                      | `false`                     |
| `title`                      | `string`  | The title of the card.                                                                                                          | `⚡ Lightning localization` |
| `font_color`                 | `string`  | The color for the font inside the compass and the history chart's axis labels.                                                  | `var(--primary-text-color)` |
| `show_radar`                 | `boolean` | If `true`, displays the compass and radar chart.                                                                                | `true`                      |
| `lightning_detection_radius` | `number`  | **Required.** The maximum distance for the radar chart scale and for filtering strikes. Should match the integration's setting. | `100`                       |
| `period`                     | `string`  | The time window for strikes shown on the radar, map, and history chart. Can be `'15m'`, `'30m'`, or `'1h'`.                     | `'1h'`                      |
| `grid_color`                 | `string`  | The color for the radar grid lines and labels. Accepts CSS colors (e.g., `#ffffff`, `var(--primary-color)`).                    | `var(--primary-text-color)` |
| `strike_color`               | `string`  | The color for the lightning strikes on the radar.                                                                               | `var(--error-color)`        |
| `show_grid_labels`           | `boolean` | If `true`, displays distance labels on the radar grid.                                                                          | `true`                      |
| `show_history_chart`         | `boolean` | If `true`, displays a bar chart of strike history.                                                                              | `true`                      |
| `history_chart_bar_color`    | `string`  | A single color for the history chart bars. If set, it overrides the default theme with an opacity gradient.                     | (default theme)             |
| `show_map`                   | `boolean` | If `true`, displays an interactive map of recent strikes.                                                                       | `true`                      |
| `map_theme_mode`             | `string`  | Overrides the map's theme. Can be `'auto'`, `'light'`, or `'dark'`. Defaults to `'auto'` (follows HA theme).                    | `'auto'`                    |

## Visualizations

### Compass and Radar Chart

The card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot, overlaid on a compass rose. The strikes on the radar will gradually fade out over a configurable time period (`15m`, `30m`, or `1h`), with the most recent strike being the most prominent.

You can customize its appearance with these options:

- **Lightning Detection Radius**: This required setting defines the maximum range for the radar chart and filters strikes on both the radar and map. The editor provides a helpful tip for aligning this value with your Blitzortung integration settings for the best visual experience.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

## How It Works

The card is designed to work out-of-the-box with the Blitzortung integration, without requiring any extra YAML helpers or automations.

- The card uses your default Home Assistant location. You can override this with manual latitude and longitude settings in the card's configuration for better accuracy.
- The **radar and map** features automatically use all `geo_location.lightning_strike_*` entities created by the Blitzortung integration.
- The **history chart** fetches data for your `counter` entity directly using the Home Assistant history API.

This approach ensures that the data is always in sync with Home Assistant and simplifies setup.

## Visualizations

### Compass and Radar Chart

The card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot, overlaid on a compass rose. The strikes on the radar will gradually fade out over a configurable time period (`15m`, `30m`, or `1h`), with the most recent strike being the most prominent.

You can customize its appearance with these options:

- **Tooltips**: Hovering over a strike on the radar will show a tooltip with its exact distance and azimuth.
- **Lightning Detection Radius**: This required setting defines the maximum range for the radar chart and filters strikes on both the radar and map. The editor provides a helpful tip for aligning this value with your Blitzortung integration settings for the best visual experience.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

### History Chart

When enabled with `show_history_chart: true`, the card displays a bar chart showing the number of strikes over a configurable period. The default is 1 hour (with 10-minute intervals), but 30-minute (5-minute intervals) and 15-minute (3-minute intervals) views are also available via the `period` option. The bars are color-coded by age, from red (most recent) through orange and yellow, to gray (oldest).

### Map Integration

The card uses the `geo_location.lightning_strike_*` entities to plot strikes from the configured radar time period on an interactive map. If your Home Assistant `zone.home` is configured, it will also be displayed as a reference point. The map features auto-zoom, which initially adjusts the view to fit all displayed strikes. This is automatically disabled when you interact with the map (pan or zoom), allowing for free exploration. The recenter button not only centers the map on the strikes but also re-enables auto-zoom. Standard `+/-` zoom controls are also provided for easy navigation. To enable this feature, simply toggle the "Show Map" option in the card's visual editor.

## Example Configuration

```yaml
type: custom:blitzortung-lightning-card
title: Lightning Strikes
distance_entity: sensor.blitzortung_lightning_distance
counter_entity: sensor.blitzortung_lightning_counter
azimuth_entity: sensor.blitzortung_lightning_azimuth
lightning_detection_radius: 150
show_map: true
map_theme_mode: dark
show_history_chart: true
period: 15m
grid_color: 'var(--secondary-text-color)'
font_color: 'var(--primary-text-color)'
strike_color: '#ffeb3b'
```

![Star History Chart](https://api.star-history.com/svg?repos=timmaurice/lovelace-blitzortung-lightning-card&type=Date)
