# Blitzortung Lightning Card

A Home Assistant Lovelace card to display data from the [Blitzortung](https://github.com/mrk-its/homeassistant-blitzortung) integration. It shows the distance, direction, and total count of recent lightning strikes. It also features a compass, a radar chart for visualizing recent strike locations, a history chart, and an optional map view.

![Blitzortung Lightning Card Screenshot](https://raw.githubusercontent.com/timmaurice/lovelace-blitzortung-lightning-card/main/image.png)

## Installation

### HACS (Recommended)

This card is available in the [Home Assistant Community Store (HACS)](https://hacs.xyz/).

1.  Open HACS.
2.  Go to "Frontend" and click the `+` button.
3.  Search for "Blitzortung Lightning Card" and install it.

### Manual Installation

1.  Download the `blitzortung-lightning-card.js` file from the latest release.
2.  Place it in your `config/www` directory.
3.  Add the resource reference to your Lovelace configuration.

## Features

- Displays the distance, direction, and total count of the latest lightning strike.
- A compass rose that shows the direction of the latest strike.
- A D3.js-powered radar chart to plot the location of multiple recent strikes.
- A history chart showing the number of strikes in 10-minute intervals over the last hour.
- Optional `ha-map` integration to show strike locations relative to your home.
- Strike history is stored in the browser's local storage to persist across reloads.
- Tooltips on radar strikes show exact distance and azimuth on hover.
- Animated markers for new strikes on the map.
- Customizable colors for the compass, radar, and strikes.

## Card Configuration

| Name                   | Type      | Required | Description                                                           | Default                     |
| ---------------------- | --------- | -------- | --------------------------------------------------------------------- | --------------------------- |
| `type`                 | `string`  | `true`   | `custom:blitzortung-lightning-card`                                   |                             |
| `title`                | `string`  | `false`  | The title of the card.                                                | `⚡ Lightning localization` |
| `distance`             | `string`  | `true`   | Entity ID for the lightning distance sensor.                          |                             |
| `count`                | `string`  | `true`   | Entity ID for the lightning strike counter sensor.                    |                             |
| `azimuth`              | `string`  | `true`   | Entity ID for the lightning azimuth sensor.                           |                             |
| `show_map`             | `boolean` | `false`  | Enables the map view.                                                 | `false`                     |
| `show_history_chart`   | `boolean` | `false`  | Enables the history bar chart.                                        | `false`                     |
| `history_chart_period` | `string`  | `false`  | The time period for the history chart. Can be `'1h'` or `'15m'`.      | `'1h'`                      |
| `radar_max_distance`   | `number`  | `false`  | The maximum distance for the radar chart. If not set, it auto-scales. | `100`                       |
| `radar_history_size`   | `number`  | `false`  | The number of recent strikes to show on the radar and map.            | `20`                        |
| `grid_color`           | `string`  | `false`  | A CSS color for the radar/compass grid lines and labels.              | `var(--primary-text-color)` |
| `strike_color`         | `string`  | `false`  | A CSS color for the strikes on the radar and the compass pointer.     | `var(--error-color)`        |

## How It Works

The card automatically listens for new strikes by monitoring the `count` entity you provide. When a new strike is detected, the card reads the corresponding `distance` and `azimuth` and adds the strike to a list. This list is saved in your browser's local storage, so the history persists across page reloads.

**This means you no longer need to create any YAML helper or automation!** The card works out of the box.

## Visualizations

### Compass and Radar Chart

The card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot, overlaid on a compass rose. The strikes on the radar will gradually fade over time, with the most recent strike being the most prominent.

You can customize its appearance with these options:

- **Tooltips**: Hovering over a strike on the radar will show a tooltip with its exact distance and azimuth.
- **Radar Max Distance**: Sets the maximum range of the radar chart in your distance unit (e.g., km or mi). If you leave it blank, it will adjust automatically based on the furthest strike.
- **Radar History Size**: Controls how many of the most recent strikes are stored and displayed. The default is 20.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

### History Chart

When enabled with `show_history_chart: true`, the card displays a bar chart showing the number of strikes over a configurable period. The default is 1 hour (with 10-minute intervals), but a 15-minute view (with 3-minute intervals) is also available via the `history_chart_period` option. The bars are color-coded by age, from white (most recent) to dark red (oldest).

### Map Integration

The card reads the latitude and longitude for each new strike directly from the attributes of your configured `distance` sensor (e.g., `sensor.blitzortung_lightning_distance`). It then plots the strike history on the map. If your Home Assistant `zone.home` is configured, it will also be displayed as a reference point. The map automatically zooms to fit all displayed points.

To enable this feature, simply toggle the "Show Map" option in the card's visual editor. This will set the `show_map: true` option in your YAML configuration. The previous manual setup of a `device_tracker` is no longer needed.

## Example Configuration

```yaml
type: custom:blitzortung-lightning-card
title: Lightning Strikes
distance: sensor.blitzortung_lightning_distance
count: sensor.blitzortung_lightning_counter
azimuth: sensor.blitzortung_lightning_azimuth
show_map: true
show_history_chart: true
history_chart_period: '1h'
radar_max_distance: 150
radar_history_size: 30
grid_color: '#555'
strike_color: 'orange'
```
