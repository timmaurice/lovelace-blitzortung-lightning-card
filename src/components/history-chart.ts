import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';
import { BlitzortungCardConfig, HomeAssistant } from '../types';
import { localize } from '../localize';
import { formatNumber } from '../utils';

// The fallback size, for when the element has not been laid out (or cannot be, as in jsdom).
const HISTORY_CHART_WIDTH = 280;
const HISTORY_CHART_HEIGHT = 115;
// Vertical room per y-axis tick, so a chart stretched beside a taller tile gets a finer scale.
const PX_PER_Y_TICK = 35;
const HISTORY_CHART_MARGIN = { top: 15, right: 5, bottom: 35, left: 30 };

export class BlitzortungHistoryChart extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: BlitzortungCardConfig;
  @property({ attribute: false }) public historyData: Array<{ timestamp: number; value: number }> = [];
  @property({ type: Boolean }) public editMode = false;
  private _resizeObserver?: ResizeObserver;

  // The chart is drawn at the element's own size rather than scaled from a fixed shape, so a
  // half-width chart can fill the height of the tiles beside it instead of following its width.
  connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._renderChart());
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  private _processHistoryData(historyData: Array<{ timestamp: number; value: number }>): number[] {
    const period = this.config.period ?? '1h';
    let bucketDurationMinutes: number;
    let numBuckets: number;

    if (period === '15m') {
      bucketDurationMinutes = 3;
      numBuckets = 5;
    } else if (period === '30m') {
      bucketDurationMinutes = 5;
      numBuckets = 6;
    } else {
      bucketDurationMinutes = 10;
      numBuckets = 6;
    }

    if (historyData.length < 2) {
      return Array(numBuckets).fill(0);
    }

    // Calculate deltas (increases) between consecutive history points
    const deltas = [];
    for (let i = 1; i < historyData.length; i++) {
      const strikeCount = historyData[i].value - historyData[i - 1].value;
      if (strikeCount > 0) {
        deltas.push({
          timestamp: historyData[i].timestamp,
          count: strikeCount,
        });
      }
    }

    // Assign deltas to time buckets
    const now = Date.now();
    const buckets = Array(numBuckets).fill(0);
    for (const delta of deltas) {
      const ageMinutes = (now - delta.timestamp) / (60 * 1000);
      if (ageMinutes < bucketDurationMinutes * buckets.length) {
        const bucketIndex = Math.floor(ageMinutes / bucketDurationMinutes);
        buckets[bucketIndex] += delta.count;
      }
    }
    return buckets;
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has('historyData') || changedProperties.has('config') || changedProperties.has('editMode')) {
      this._renderChart();
    }
  }

  private _renderChart() {
    if (!this.config || !this.hass) return;
    const width = this.clientWidth || HISTORY_CHART_WIDTH;
    const height = this.clientHeight || HISTORY_CHART_HEIGHT;
    let buckets = this._processHistoryData(this.historyData);

    // Use sample data for editor preview if no real data is available
    if (this.editMode && !buckets.some((c) => c > 0)) {
      if (this.config.period === '15m') {
        buckets = [2, 1, 4, 1, 2];
      } else if (this.config.period === '30m') {
        buckets = [1, 2, 4, 1, 2, 1];
      } else {
        buckets = [1, 2, 4, 1, 2, 1];
      }
    }

    const period = this.config.period ?? '1h';
    const barColor = this.config.history_chart_bar_color;
    let defaultColors: string[];
    let xAxisLabels: string[];
    if (period === '15m') {
      xAxisLabels = ['-3', '-6', '-9', '-12', '-15'];
      defaultColors = ['#8B0000', '#D22B2B', '#FF7F00', '#FFD700', '#CCCCCC'];
    } else if (period === '30m') {
      xAxisLabels = ['-5', '-10', '-15', '-20', '-25', '-30'];
      defaultColors = ['#8B0000', '#B22222', '#D22B2B', '#FF7F00', '#FFD700', '#CCCCCC'];
    } else {
      xAxisLabels = ['-10', '-20', '-30', '-40', '-50', '-60'];
      defaultColors = ['#8B0000', '#B22222', '#D22B2B', '#FF7F00', '#FFD700', '#CCCCCC'];
    }

    if (this.config.invert_history_direction) {
      buckets = buckets.slice().reverse();
      xAxisLabels = xAxisLabels.slice().reverse();
      defaultColors = defaultColors.slice().reverse();
    }

    const barFillColors = barColor ? Array(buckets.length).fill(barColor) : defaultColors;

    const chartWidth = width - HISTORY_CHART_MARGIN.left - HISTORY_CHART_MARGIN.right;
    const chartHeight = height - HISTORY_CHART_MARGIN.top - HISTORY_CHART_MARGIN.bottom;

    // A floor of 5 keeps a quiet hour from drawing one stray strike as a full-height bar, while
    // still letting a typical storm use most of the height.
    const yMax = Math.max(5, max(buckets) ?? 0);
    const xScale = scaleLinear().domain([0, buckets.length]).range([0, chartWidth]);

    // Rounded with the same tick count the axis is drawn with, so the top of the scale is labelled.
    const yTickCount = Math.max(4, Math.floor(chartHeight / PX_PER_Y_TICK));
    const yScale = scaleLinear().domain([0, yMax]).range([chartHeight, 0]).nice(yTickCount);

    const svgRoot = select(this).selectAll('svg').data([null]).join('svg').attr('viewBox', `0 0 ${width} ${height}`);

    const svg = svgRoot
      .selectAll('g.history-main-group')
      .data([null])
      .join('g')
      .attr('class', 'history-main-group')
      .attr('transform', `translate(${HISTORY_CHART_MARGIN.left}, ${HISTORY_CHART_MARGIN.top})`);

    // Y-axis with labels
    const yAxis = svg.selectAll('g.y-axis').data([null]).join('g').attr('class', 'y-axis');
    const yTicks = yScale.ticks(yTickCount);
    yAxis
      .selectAll('text')
      .data(yTicks, (d) => d as number)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('x', -8)
            .attr('y', (d) => yScale(d))
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .style('font-size', '10px')
            .style('fill', this.config.font_color ?? 'var(--secondary-text-color)')
            .text((d) => formatNumber(this.hass, d, 0, 0)),
        (update) => update.attr('y', (d) => yScale(d)).text((d) => formatNumber(this.hass, d, 0, 0)),
        (exit) => exit.remove(),
      );

    // X-axis labels
    const xAxisGroup = svg
      .selectAll('g.x-axis')
      .data([null])
      .join('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${chartHeight})`);

    xAxisGroup
      .selectAll('text.x-label')
      .data(xAxisLabels)
      .join('text')
      .attr('class', 'x-label')
      .attr('x', (d, i) => xScale(i + 0.5))
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', this.config.font_color ?? 'var(--secondary-text-color)')
      .text((d) => d);

    // Add x-axis unit label
    xAxisGroup
      .selectAll('text.x-unit-label')
      .data([localize(this.hass, 'component.blc.card.minutes_ago')])
      .join('text')
      .attr('class', 'x-unit-label')
      .attr('x', chartWidth)
      .attr('y', 30)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', this.config.font_color ?? 'var(--secondary-text-color)')
      .text((d) => d);

    // Bars
    const opacityScale = barColor
      ? scaleLinear()
          .domain([0, buckets.length - 1])
          .range(this.config.invert_history_direction ? [0.2, 1] : [1, 0.2])
      : null;

    svg
      .selectAll('g.bars')
      .data([null])
      .join('g')
      .attr('class', 'bars')
      .selectAll('.bar')
      .data(buckets)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d, i) => xScale(i))
      .attr('width', xScale(1) - xScale(0) - 2)
      .attr('fill', (d, i) => barFillColors[i])
      .attr('fill-opacity', (d, i) => (opacityScale ? opacityScale(i) : 1))
      .attr('y', (d) => yScale(d))
      .attr('height', (d) => chartHeight - yScale(d));

    // Add text labels on top of the bars
    svg
      .selectAll('g.bar-labels')
      .data([null])
      .join('g')
      .attr('class', 'bar-labels')
      .selectAll('.bar-label')
      .data(buckets)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', (d, i) => xScale(i + 0.5))
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', this.config.font_color ?? 'var(--primary-text-color)')
      .text((d) => (d > 0 ? formatNumber(this.hass, d, 0, 0) : ''))
      .attr('y', (d) => yScale(d) - 4);
  }

  protected createRenderRoot() {
    return this;
  }
}

customElements.define('blitzortung-history-chart', BlitzortungHistoryChart);
