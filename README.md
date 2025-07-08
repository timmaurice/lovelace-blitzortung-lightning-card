# Blitzortung Lightning Card

A Home Assistant Lovelace card to display data from the [Blitzortung](https://www.blitzortung.org/) integration. It shows the distance, direction, and total count of recent lightning strikes. It also features an optional map view and an advanced radar chart for visualizing recent strike locations.

## Features

- Displays the distance to the latest lightning strike.
- Shows the total number of strikes detected.
- Indicates the direction (azimuth) of the latest strike with a compass or a radar chart.
- Optional `ha-map` integration to show the strike location relative to your home.
- Optional D3.js-powered radar chart to plot multiple recent strikes.

## Configuration

| Name                 | Type     | Required | Description                                                           | Default                     |
| -------------------- | -------- | -------- | --------------------------------------------------------------------- | --------------------------- |
| `type`               | `string` | `true`   | `custom:blitzortung-lightning-card`                                   |                             |
| `title`              | `string` | `false`  | The title of the card.                                                | `⚡ Lightning localization` |
| `distance`           | `string` | `true`   | The entity ID for the lightning distance sensor.                      |                             |
| `count`              | `string` | `true`   | The entity ID for the lightning strike counter sensor.                |                             |
| `azimuth`            | `string` | `true`   | The entity ID for the lightning azimuth sensor.                       |                             |
| `visualization_type` | `string` | `false`  | The visualization to show: `radar` or `compass`.                      | `radar`                     |
| `map`                | `string` | `false`  | The entity ID for the map `device_tracker` entity.                    |                             |
| `zoom`               | `number` | `false`  | The zoom level for the map.                                           | `8`                         |
| `radar_max_distance` | `number` | `false`  | The maximum distance for the radar chart. If not set, it auto-scales. | `100`                       |
| `radar_history_size` | `number` | `false`  | The number of recent strikes to show on the radar.                    | `20`                        |
| `radar_grid_color`   | `string` | `false`  | A CSS color for the radar grid lines and labels.                      | `var(--primary-text-color)` |
| `radar_strike_color` | `string` | `false`  | A CSS color for the strikes on the radar.                             | `var(--error-color)`        |

## Radar Chart

This card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot.

### How It Works

The card automatically listens for new strikes by monitoring the `count` entity you provide. When a new strike is detected, the card reads the corresponding `distance` and `azimuth` and adds the strike to a list. This list is saved in your browser's local storage, so the history persists across page reloads.
The strikes on the radar will gradually fade over time, with the most recent strike being the most prominent.

**This means you no longer need to create any YAML helpers or automations!** The radar chart works out of the box.

### Card Configuration for Radar

The radar is enabled by default. You can customize its appearance with these options:

- **Radar Max Distance**: Sets the maximum range of the radar chart in your distance unit (e.g., km or mi). If you leave it blank, it will adjust automatically based on the furthest strike.
- **Radar History Size**: Controls how many of the most recent strikes are stored and displayed. The default is 20.
- **Radar Grid Color**: Sets the color of the radar grid and labels.
- **Radar Strike Color**: Sets the color of the lightning strikes.
