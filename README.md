# Blitzortung Lightning Card

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg)](https://github.com/hacs/integration)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/timmaurice/lovelace-blitzortung-lightning-card)
![GitHub](https://img.shields.io/github/license/timmaurice/lovelace-blitzortung-lightning-card)

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

1.  Open HACS.
2.  Go to "Frontend" > "Explore & Add Repositories".
3.  Search for "Blitzortung Lightning Card" and install it.
4.  Add the card to your Lovelace dashboard.

    ```yaml
    - type: custom:blitzortung-lightning-card
      distance: sensor.blitzortung_lightning_distance # The entity for the distance to the latest strike
      counter: sensor.blitzortung_lightning_counter # The entity for the total strike count
      azimuth: sensor.blitzortung_lightning_azimuth # The entity for the direction of the latest strike
    ```

### Manual Installation

1.  Download the `blitzortung-lightning-card.js` file from the latest release.
2.  Place it in your `config/www` directory.
3.  Add the resource reference to your Lovelace configuration.
    - URL: `/local/blitzortung-lightning-card.js`
    - Resource Type: `JavaScript Module`
4.  Add the card to your dashboard.

## Features

- A **compass rose** that shows the direction of the latest strike.
  - Displays the distance, direction, and total count of the latest lightning strike.
  - The entities inside the compass are clickable and show the entity's more-info dialog.
- A D3.js-powered **radar chart** to plot the location of multiple recent strikes.
  - Tooltips on radar strikes show exact distance and azimuth on hover.
  - Customizable colors for the compass, radar, and strikes.
- An optional **history chart** showing the number of strikes in…
  - 10-minute intervals over the last hour or
  - 3-minute intervals over the last 15 minutes.
- An optional interactive **map** to show strike locations relative to your home.
  - Stops auto-zooming on user interaction, allowing for free exploration.
  - Includes standard zoom controls and a recenter button.
  - Animated markers for new strikes on the map.

## Card Configuration

The card can be configured using the visual editor.

| Name                   | Type      | Description                                                                                                  | Default                     |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `type`                 | `string`  | **Required.** `custom:blitzortung-lightning-card`                                                            |                             |
| `distance`             | `string`  | **Required.** The entity ID for the lightning distance sensor.                                               |                             |
| `counter`              | `string`  | **Required.** The entity ID for the lightning strike counter sensor.                                         |                             |
| `azimuth`              | `string`  | **Required.** The entity ID for the lightning azimuth sensor.                                                |                             |
| `title`                | `string`  | The title of the card.                                                                                       | `⚡ Lightning localization` |
| `radar_max_distance`   | `number`  | The maximum distance (in your HA distance unit) for the radar chart. Auto-scales if not set.                 | `100`                       |
| `show_map`             | `boolean` | If `true`, displays an interactive map of recent strikes.                                                    | `false`                     |
| `show_history_chart`   | `boolean` | If `true`, displays a bar chart of strike history.                                                           | `true`                      |
| `history_chart_period` | `string`  | The time period for the history chart. Can be `'1h'` or `'15m'`.                                             | `'1h'`                      |
| `grid_color`           | `string`  | The color for the radar grid lines and labels. Accepts CSS colors (e.g., `#ffffff`, `var(--primary-color)`). | `var(--primary-text-color)` |
| `font_color`           | `string`  | The color for the font inside the compass and the history chart's axis labels.                               | `var(--primary-text-color)` |
| `strike_color`         | `string`  | The color for the lightning strikes on the radar.                                                            | `var(--error-color)`        |

## How It Works

The card uses the `geo_location.lightning_strike_*` entities created by the Blitzortung integration to display recent strikes on the radar and map. For the history chart, it fetches data for your `counter` entity using the Home Assistant history API. This approach ensures that the data is always in sync with Home Assistant and does not require any extra helpers or automation.

**This means you no longer need to create any YAML helper or automation!** The card works out of the box as long as the integration is configured correctly.

## Visualizations

### Compass and Radar Chart

The card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot, overlaid on a compass rose. The strikes on the radar will gradually fade over time, with the most recent strike being the most prominent.

You can customize its appearance with these options:

- **Tooltips**: Hovering over a strike on the radar will show a tooltip with its exact distance and azimuth.
- **Radar Max Distance**: Sets the maximum range of the radar chart in your distance unit (e.g., km or mi). If you leave it blank, it will adjust automatically based on the furthest strike.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

### History Chart

When enabled with `show_history_chart: true`, the card displays a bar chart showing the number of strikes over a configurable period. The default is 1 hour (with 10-minute intervals), but a 15-minute view (with 3-minute intervals) is also available via the `history_chart_period` option. The bars are color-coded by age, from white (most recent) to dark red (oldest).

### Map Integration

The card uses the `geo_location.lightning_strike_*` entities to plot strikes on an interactive map. If your Home Assistant `zone.home` is configured, it will also be displayed as a reference point. The map features auto-zoom, which initially adjusts the view to fit all displayed strikes. This is automatically disabled when you interact with the map (pan or zoom), allowing for free exploration. The recenter button not only centers the map on the strikes but also re-enables auto-zoom. Standard `+/-` zoom controls are also provided for easy navigation. To enable this feature, simply toggle the "Show Map" option in the card's visual editor.

## Example Configuration

```yaml
type: custom:blitzortung-lightning-card
title: Lightning Strikes
distance: sensor.blitzortung_lightning_distance
counter: sensor.blitzortung_lightning_counter
azimuth: sensor.blitzortung_lightning_azimuth
radar_max_distance: 150
show_map: true
show_history_chart: true
history_chart_period: 15m
grid_color: 'var(--secondary-text-color)'
font_color: 'var(--primary-text-color)'
strike_color: '#ffeb3b'
```
