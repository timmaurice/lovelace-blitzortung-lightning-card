# Blitzortung Lightning Card

A Home Assistant Lovelace card to display data from the [Blitzortung](https://github.com/mrk-its/homeassistant-blitzortung) integration. It shows the distance, direction, and total count of recent lightning strikes. It also features an optional map view and an advanced radar chart for visualizing recent strike locations.

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

- Displays the distance to the latest lightning strike.
- Shows the total number of strikes detected.
- Indicates the direction (azimuth) of the latest strike with a compass or a radar chart.
- Optional `ha-map` integration to show the strike location relative to your home.
- Optional D3.js-powered radar chart to plot multiple recent strikes.

## Card Configuration

| Name                 | Type     | Required | Description                                                           | Default                     |
| -------------------- | -------- | -------- | --------------------------------------------------------------------- | --------------------------- |
| `type`               | `string` | `true`   | `custom:blitzortung-lightning-card`                                   |                             |
| `title`              | `string` | `false`  | The title of the card.                                                | `⚡ Lightning localization` |
| `distance`           | `string` | `true`   | Entity ID for the lightning distance sensor.                          |                             |
| `count`              | `string` | `true`   | Entity ID for the lightning strike counter sensor.                    |                             |
| `azimuth`            | `string` | `true`   | Entity ID for the lightning azimuth sensor.                           |                             |
| `map`                | `string` | `false`  | Entity ID for the map `device_tracker` entity.                        | `(none)`                    |
| `zoom`               | `number` | `false`  | Zoom level for the map.                                               | `8`                         |
| `radar_max_distance` | `number` | `false`  | The maximum distance for the radar chart. If not set, it auto-scales. | `100`                       |
| `radar_history_size` | `number` | `false`  | The number of recent strikes to show on the radar.                    | `20`                        |
| `grid_color`         | `string` | `false`  | A CSS color for the radar/compass grid lines and labels.              | `var(--primary-text-color)` |
| `strike_color`       | `string` | `false`  | A CSS color for the strikes on the radar and the compass pointer.     | `var(--error-color)`        |

## Radar Chart

This card includes a D3.js-powered radar chart to display the location of recent lightning strikes as a polar scatter plot.

### How It Works

The card automatically listens for new strikes by monitoring the `count` entity you provide. When a new strike is detected, the card reads the corresponding `distance` and `azimuth` and adds the strike to a list. This list is saved in your browser's local storage, so the history persists across page reloads.
The strikes on the radar will gradually fade over time, with the most recent strike being the most prominent.

**This means you no longer need to create any YAML helper or automation!** The radar chart works out of the box.

### Card Configuration for Radar

The radar is enabled by default. You can customize its appearance with these options:

- **Radar Max Distance**: Sets the maximum range of the radar chart in your distance unit (e.g., km or mi). If you leave it blank, it will adjust automatically based on the furthest strike.
- **Radar History Size**: Controls how many of the most recent strikes are stored and displayed. The default is 20.
- **Grid Color**: Sets the color of the radar grid, compass rose, and labels.
- **Strike Color**: Sets the color of the lightning strikes on the radar and the pointer on the compass.

## Map Integration

This card can display the location of the latest lightning strike on a map.

### How It Works

The card uses a `device_tracker` entity which holds the latitude and longitude of the strike.

The Blitzortung integration typically creates this entity for you automatically (e.g., `device_tracker.blitzortung_lightning_map`). You just need to add this entity ID to the card's `map` configuration option.

### Manual Setup

If the `device_tracker` entity is not available, or if you want to use a custom one, you can create it manually.

1.  **Define the Device Tracker:**
    Add the following to your `/config/known_devices.yaml` file. If the file doesn't exist, create it.

    ```yaml
    blitzortung_lightning_map:
      name: ⚡️
      icon: mdi:weather-lightning
      track: true
    ```

2.  **Create an Automation to Update the Location:**
    The `device_tracker` needs to be updated whenever a new strike is detected. You can do this with an automation that calls the `device_tracker.see` service. This automation requires sensors that provide the latitude and longitude of the strike, which should be available from your lightning data integration.

    Here is an example automation:

    ```yaml
    alias: Blitzortung Lightning Map
    description: ""
    triggers:
    - entity_id:
        - sensor.blitzortung_kaarst_lightning_distance
        trigger: state
    actions:
    - data_template:
        dev_id: blitzortung_lightning_map
        gps:
            - "{{ state_attr('sensor.blitzortung_kaarst_lightning_distance','lat') }}"
            - "{{ state_attr('sensor.blitzortung_kaarst_lightning_distance','lon') }}"
        host_name: Blitzortung Lightning
        action: device_tracker.see
    ```

**Note:**
You may need to adjust `sensor.blitzortung_lightning_counter`, `sensor.blitzortung_lightning_latitude`, and `sensor.blitzortung_lightning_longitude` to match the entity IDs provided by your integration.

## Example Configuration

```yaml
type: custom:blitzortung-lightning-card
distance: sensor.blitzortung_lightning_distance
count: sensor.blitzortung_lightning_counter
azimuth: sensor.blitzortung_lightning_azimuth
map: device_tracker.blitzortung_lightning_map
zoom: 8
radar_max_distance: 150
radar_history_size: 30
grid_color: '#555'
strike_color: 'orange'
```
