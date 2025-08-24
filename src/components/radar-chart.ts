import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { max } from 'd3-array';
import { scaleLinear, scalePow } from 'd3-scale';
import { select } from 'd3-selection';
import { BlitzortungCardConfig, HomeAssistant } from '../types';
import { localize } from '../localize';

type Strike = { distance: number; azimuth: number; timestamp: number; latitude: number; longitude: number };

const RADAR_CHART_WIDTH = 220;
const RADAR_CHART_HEIGHT = 220;
const RADAR_CHART_MARGIN = 20;

export class BlitzortungRadarChart extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: BlitzortungCardConfig;
  @property({ attribute: false }) public strikes: Strike[] = [];
  @property({ type: Number }) public maxAgeMs!: number;

  private _showTooltip(event: MouseEvent, strike: Strike): void {
    this.dispatchEvent(new CustomEvent('show-tooltip', { detail: { event, strike }, bubbles: true, composed: true }));
  }

  private _moveTooltip(event: MouseEvent): void {
    this.dispatchEvent(new CustomEvent('move-tooltip', { detail: { event }, bubbles: true, composed: true }));
  }

  private _hideTooltip(): void {
    this.dispatchEvent(new CustomEvent('hide-tooltip', { bubbles: true, composed: true }));
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has('strikes') || changedProperties.has('config')) {
      this._renderChart();
    }
  }

  private _renderChart() {
    const now = Date.now();
    const halfMaxAge = now - this.maxAgeMs / 2;
    const endOfLife = now - this.maxAgeMs;

    const chartRadius = Math.min(RADAR_CHART_WIDTH, RADAR_CHART_HEIGHT) / 2 - RADAR_CHART_MARGIN;
    const autoRadar = this.config.auto_radar_max_distance === true;
    const maxDistance = autoRadar
      ? (max(this.strikes, (d) => d.distance) ?? 100)
      : (this.config.radar_max_distance ?? 100);

    const rScale = scaleLinear().domain([0, maxDistance]).range([0, chartRadius]);
    const opacityScale = scalePow().exponent(0.7).domain([now, halfMaxAge, endOfLife]).range([1, 0.25, 0]).clamp(true);

    const svgRoot = select(this)
      .selectAll('svg')
      .data([null])
      .join('svg')
      .attr('viewBox', `0 0 ${RADAR_CHART_WIDTH} ${RADAR_CHART_HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-labelledby', 'radar-title radar-desc');

    svgRoot
      .selectAll('desc')
      .data([null])
      .join('desc')
      .attr('id', 'radar-desc')
      .text(
        `Showing the ${this.strikes.length} most recent strikes. The center is your location. Strikes are plotted by distance and direction.`,
      );

    const svg = svgRoot
      .selectAll('g.radar-main-group')
      .data([null])
      .join('g')
      .attr('class', 'radar-main-group')
      .attr('transform', `translate(${RADAR_CHART_WIDTH / 2}, ${RADAR_CHART_HEIGHT / 2})`);

    // Add background circles (grid)
    const gridCircles = rScale.ticks(4).slice(1);
    svg
      .selectAll('.grid-circle')
      .data(gridCircles)
      .join(
        (enter) => enter.append('circle').attr('class', 'grid-circle').style('fill', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('r', (d) => rScale(d))
      .style('stroke', this.config.grid_color ?? 'var(--primary-text-color)')
      .style('opacity', 0.3);

    const cardinalPoints = [
      { label: localize(this.hass, 'component.blc.card.directions.N'), angle: 0 },
      { label: localize(this.hass, 'component.blc.card.directions.E'), angle: 90 },
      { label: localize(this.hass, 'component.blc.card.directions.S'), angle: 180 },
      { label: localize(this.hass, 'component.blc.card.directions.W'), angle: 270 },
    ];

    svg
      .selectAll('.cardinal-line')
      .data(cardinalPoints)
      .join('line')
      .attr('class', 'cardinal-line')
      .style('stroke', this.config.grid_color ?? 'var(--primary-text-color)')
      .style('opacity', 0.3)
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d) => rScale(maxDistance) * Math.cos(((d.angle - 90) * Math.PI) / 180))
      .attr('y2', (d) => rScale(maxDistance) * Math.sin(((d.angle - 90) * Math.PI) / 180));

    svg
      .selectAll('.cardinal-label')
      .data(cardinalPoints)
      .join('text')
      .attr('class', 'cardinal-label')
      .text((d) => d.label)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle')
      .style('fill', this.config.font_color ?? this.config.grid_color ?? 'var(--primary-text-color)')
      .style('font-size', '10px')
      .attr('x', (d) => (rScale(maxDistance) + 10) * Math.cos(((d.angle - 90) * Math.PI) / 180))
      .attr('y', (d) => (rScale(maxDistance) + 10) * Math.sin(((d.angle - 90) * Math.PI) / 180));

    // Plot the strikes
    const strikeDots = svg
      .selectAll<SVGCircleElement, Strike>('circle.strike-dot')
      .data(this.strikes, (d) => d.timestamp)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('class', (d, i) => 'strike-dot' + (i === 0 ? ' new-strike-dot' : ''))
            .style('fill', this.config.strike_color ?? 'var(--error-color)')
            .style('fill-opacity', (d) => opacityScale(d.timestamp))
            .attr('r', 3),
        (update) =>
          update
            .attr('class', (d, i) => 'strike-dot' + (i === 0 ? ' new-strike-dot' : ''))
            .style('fill', this.config.strike_color ?? 'var(--error-color)')
            .style('fill-opacity', (d) => opacityScale(d.timestamp))
            .attr('r', 3),
        (exit) => exit.remove(),
      );
    // Set position and tooltip for all dots (new and updated)
    strikeDots
      .attr('cx', (d) => rScale(d.distance) * Math.cos(((d.azimuth - 90) * Math.PI) / 180))
      .attr('cy', (d) => rScale(d.distance) * Math.sin(((d.azimuth - 90) * Math.PI) / 180))
      .style('cursor', 'pointer')
      .on('mouseover', (event, d) => this._showTooltip(event, d))
      .on('mousemove', (event) => this._moveTooltip(event))
      .on('mouseout', () => this._hideTooltip());
  }

  protected createRenderRoot() {
    return this;
  }
}

customElements.define('blitzortung-radar-chart', BlitzortungRadarChart);
