<script lang="ts">
	import ChartTooltip, { type TooltipData } from './ChartTooltip.svelte';

	interface StackedBarSegment {
		label: string;
		value: number;
	}

	interface MonthlyStackedData {
		month: string;
		segments: StackedBarSegment[];
		total: number;
	}

	interface RunwayInfo {
		monthsRemaining: number;
		exhaustionDate: string; // YYYY-MM
		trendPerMonth: number;
	}

	interface Props {
		data: MonthlyStackedData[];
		height?: number;
		showTotalLine?: boolean;
		showRunway?: boolean;
		runwayMonths?: number; // How many recent months to use for trend (default 6)
		title?: string;
	}

	let { data, height = 220, showTotalLine = true, showRunway = false, runwayMonths = 6, title }: Props = $props();

	// Tooltip state
	let tooltip = $state<TooltipData | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);
	let containerRect = $state<DOMRect | null>(null);

	function formatTooltipCurrency(value: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	function formatTooltipMonth(month: string): string {
		const [year, m] = month.split('-');
		const date = new Date(Number(year), Number(m) - 1, 1);
		return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}

	function handleBarHover(event: MouseEvent, barData: typeof stackedBars[0], segment: { label: string; color: string }, segmentValue: number) {
		if (!containerEl) return;
		containerRect = containerEl.getBoundingClientRect();
		const svgRect = (event.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
		if (!svgRect) return;

		const x = event.clientX - containerRect.left;
		const y = event.clientY - containerRect.top;

		tooltip = {
			x,
			y,
			title: formatTooltipMonth(barData.month),
			items: [
				{ label: segment.label, value: formatTooltipCurrency(segmentValue), color: segment.color },
				{ label: 'Total', value: formatTooltipCurrency(barData.total) }
			]
		};
	}

	function handleBarLeave() {
		tooltip = null;
	}

	const padding = { top: 20, right: 60, bottom: 30, left: 60 };
	const width = 800;

	const chartWidth = $derived(width - padding.left - padding.right);
	const chartHeight = $derived(height - padding.top - padding.bottom);

	// Track which labels are disabled (toggled off)
	let disabledLabels = $state(new Set<string>());

	function toggleLabel(label: string) {
		const newSet = new Set(disabledLabels);
		if (newSet.has(label)) {
			newSet.delete(label);
		} else {
			newSet.add(label);
		}
		disabledLabels = newSet;
	}

	// Collect all unique segment labels across all months for consistent colors
	const allLabels = $derived.by(() => {
		const labelSet = new Set<string>();
		for (const d of data) {
			for (const seg of d.segments) {
				labelSet.add(seg.label);
			}
		}
		return Array.from(labelSet);
	});

	// Color palette for segments
	const colors = [
		'#4f46e5', // indigo
		'#0891b2', // cyan
		'#059669', // emerald
		'#d97706', // amber
		'#dc2626', // red
		'#7c3aed', // violet
		'#db2777', // pink
		'#2563eb', // blue
		'#65a30d', // lime
		'#ea580c' // orange
	];

	const labelColorMap = $derived.by(() => {
		const map = new Map<string, string>();
		allLabels.forEach((label, i) => {
			map.set(label, colors[i % colors.length]);
		});
		return map;
	});

	// Filter data based on enabled labels and recalculate totals
	const filteredData = $derived.by(() => {
		return data.map((d) => {
			const enabledSegments = d.segments.filter((seg) => !disabledLabels.has(seg.label));
			const newTotal = enabledSegments.reduce((sum, seg) => sum + seg.value, 0);
			return {
				month: d.month,
				segments: enabledSegments,
				total: newTotal
			};
		});
	});

	// Find max total for Y scale (use filtered data)
	const maxTotal = $derived(Math.max(...filteredData.map((d) => d.total), 0.01));

	// Number of future months to show when runway is enabled
	const futureMonthsToShow = 6;

	// Total bar slots (data + future projection space)
	const totalBarSlots = $derived(showRunway ? data.length + futureMonthsToShow : data.length);

	// Bar dimensions
	const barGap = $derived(Math.max(2, (chartWidth / totalBarSlots) * 0.15));
	const barWidth = $derived(Math.max(4, (chartWidth - barGap * (totalBarSlots + 1)) / totalBarSlots));

	// X position for bar center
	function xPos(index: number): number {
		return padding.left + barGap + index * (barWidth + barGap) + barWidth / 2;
	}

	// Y scale - value to pixel
	function yScale(value: number): number {
		return padding.top + chartHeight - (value / maxTotal) * chartHeight;
	}

	// Build stacked bar data for each month (using filtered data)
	const stackedBars = $derived.by(() => {
		return filteredData.map((d, i) => {
			const bars: { label: string; y: number; height: number; color: string }[] = [];
			let cumulative = 0;

			// Stack segments from bottom to top
			for (const seg of d.segments) {
				if (seg.value <= 0) continue;
				const segHeight = (seg.value / maxTotal) * chartHeight;
				bars.push({
					label: seg.label,
					y: yScale(cumulative + seg.value),
					height: segHeight,
					color: labelColorMap.get(seg.label) || '#888'
				});
				cumulative += seg.value;
			}

			return {
				month: d.month,
				x: xPos(i) - barWidth / 2,
				bars,
				total: d.total
			};
		});
	});

	// Build stepped total line path (using filtered data)
	const totalPath = $derived.by(() => {
		if (filteredData.length === 0 || !showTotalLine) return '';
		const segments: string[] = [];
		for (let i = 0; i < filteredData.length; i++) {
			const y = yScale(filteredData[i].total);
			const xLeft = xPos(i) - barWidth / 2;
			const xRight = xPos(i) + barWidth / 2;
			if (i === 0) {
				segments.push(`M${xLeft},${y}`);
			}
			segments.push(`H${xRight}`);
			if (i < filteredData.length - 1) {
				const midX = (xRight + xPos(i + 1) - barWidth / 2) / 2;
				const nextY = yScale(filteredData[i + 1].total);
				segments.push(`H${midX}`);
				segments.push(`V${nextY}`);
				segments.push(`H${xPos(i + 1) - barWidth / 2}`);
			}
		}
		return segments.join(' ');
	});

	// Format month label (YYYY-MM -> Mon 'YY or just Mon)
	function formatMonth(month: string): string {
		const [year, m] = month.split('-');
		const date = new Date(Number(year), Number(m) - 1, 1);
		if (data.length > 12) {
			return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
		}
		return date.toLocaleDateString('en-US', { month: 'short' });
	}

	// Format currency for axis
	function formatCurrency(value: number): string {
		if (Math.abs(value) >= 1000000) {
			return `$${(value / 1000000).toFixed(1)}M`;
		}
		if (Math.abs(value) >= 1000) {
			return `$${(value / 1000).toFixed(0)}k`;
		}
		return `$${value.toFixed(0)}`;
	}

	// Get Y-axis tick values
	const yTicks = $derived.by(() => {
		if (maxTotal <= 0) return [0];
		const step = Math.pow(10, Math.floor(Math.log10(maxTotal)));
		const ticks: number[] = [];
		let tick = 0;
		while (tick <= maxTotal) {
			ticks.push(tick);
			tick += step;
		}
		// Ensure we have at least the max
		if (ticks[ticks.length - 1] < maxTotal) {
			ticks.push(Math.ceil(maxTotal / step) * step);
		}
		return ticks.slice(0, 6);
	});

	// X-axis labels (show every nth month if too many)
	const labelStep = $derived(data.length > 12 ? Math.ceil(data.length / 12) : 1);

	// Calculate how many future bars to show for runway
	const runwayBars = $derived.by(() => {
		if (!showRunway) return 0;
		// Always show 6 future months when runway is enabled
		return futureMonthsToShow;
	});

	// Calculate weighted average burn rate (month-over-month change, using UNFILTERED data)
	// Burn rate reflects actual spending, independent of which assets are being viewed
	// More recent months get higher weight: 2, 2, 3, 3, 4, 4 (oldest to newest)
	const weightedBurnRate = $derived.by((): number | null => {
		if (!showRunway || data.length < 2) return null;

		const monthsToUse = Math.min(runwayMonths, data.length - 1);
		if (monthsToUse < 1) return null;

		// Calculate month-over-month changes for recent months
		const changes: number[] = [];
		for (let i = data.length - monthsToUse; i < data.length; i++) {
			changes.push(data[i].total - data[i - 1].total);
		}

		// Weights: 2, 2, 3, 3, 4, 4 (for up to 6 months, oldest to newest)
		const weights = [2, 2, 3, 3, 4, 4];

		let weightedSum = 0;
		let totalWeight = 0;
		for (let i = 0; i < changes.length; i++) {
			// Map to weights array from the end (most recent gets weight 4)
			const weightIndex = weights.length - changes.length + i;
			const weight = weights[Math.max(0, weightIndex)] ?? 2;
			weightedSum += changes[i] * weight;
			totalWeight += weight;
		}

		return weightedSum / totalWeight;
	});

	// Calculate runway projection
	// Uses unfiltered burn rate but filtered current total (selected assets)
	const runway = $derived.by((): RunwayInfo | null => {
		if (!showRunway || weightedBurnRate === null || weightedBurnRate >= 0) return null;

		const currentTotal = filteredData.length > 0 ? filteredData[filteredData.length - 1].total : 0;
		if (currentTotal <= 0) return null;

		// Months until zero: currentTotal / |burnRate|
		const monthsRemaining = Math.ceil(currentTotal / Math.abs(weightedBurnRate));

		// Calculate exhaustion date
		const lastMonth = data[data.length - 1].month;
		const [year, month] = lastMonth.split('-').map(Number);
		const exhaustionDate = new Date(year, month - 1 + monthsRemaining, 1);
		const exhaustionMonth = `${exhaustionDate.getFullYear()}-${String(exhaustionDate.getMonth() + 1).padStart(2, '0')}`;

		return {
			monthsRemaining,
			exhaustionDate: exhaustionMonth,
			trendPerMonth: weightedBurnRate
		};
	});

	// Build runway projection path (using filtered data)
	const runwayPath = $derived.by(() => {
		if (!runway || runwayBars === 0 || filteredData.length === 0) return '';

		const lastIndex = filteredData.length - 1;
		const lastTotal = filteredData[lastIndex].total;
		const lastXRight = xPos(lastIndex) + barWidth / 2;

		const segments: string[] = [`M${lastXRight},${yScale(lastTotal)}`];

		// Project forward
		for (let i = 1; i <= runwayBars; i++) {
			const projectedTotal = Math.max(0, lastTotal + runway.trendPerMonth * i);
			const futureX = lastXRight + i * (barWidth + barGap);

			// Draw horizontal then vertical step
			if (i === 1) {
				const midX = lastXRight + (barWidth + barGap) / 2;
				segments.push(`H${midX}`);
				segments.push(`V${yScale(projectedTotal)}`);
				segments.push(`H${futureX}`);
			} else {
				const prevX = lastXRight + (i - 1) * (barWidth + barGap);
				const midX = (prevX + futureX) / 2;
				segments.push(`H${midX}`);
				segments.push(`V${yScale(projectedTotal)}`);
				segments.push(`H${futureX}`);
			}

			if (projectedTotal <= 0) break;
		}

		return segments.join(' ');
	});

	// Format runway date for display
	function formatRunwayDate(month: string): string {
		const [year, m] = month.split('-');
		const date = new Date(Number(year), Number(m) - 1, 1);
		return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
	}
</script>

<div class="chart-container" bind:this={containerEl}>
{#if title}
	<h3 class="chart-title">{title}</h3>
{/if}

<svg viewBox="0 0 {width} {height}" class="chart" preserveAspectRatio="xMidYMid meet">
	<!-- Burn rate indicator (top right) -->
	{#if weightedBurnRate !== null && showRunway}
		<text
			x={width - padding.right}
			y={padding.top - 4}
			text-anchor="end"
			class="burn-rate"
			class:negative={weightedBurnRate < 0}
			class:positive={weightedBurnRate > 0}
		>
			{weightedBurnRate < 0 ? '' : '+'}{formatCurrency(weightedBurnRate)}/mo
		</text>
		{#if runway && weightedBurnRate < 0}
			<text
				x={width - padding.right}
				y={padding.top + 10}
				text-anchor="end"
				class="months-remaining"
			>
				{runway.monthsRemaining} months remaining
			</text>
		{/if}
	{/if}

	<!-- Y-axis grid lines and labels -->
	{#each yTicks as tick (tick)}
		<line
			x1={padding.left}
			y1={yScale(tick)}
			x2={width - padding.right}
			y2={yScale(tick)}
			stroke="var(--color-border)"
			stroke-width="1"
			stroke-opacity="0.5"
		/>
		<text
			x={padding.left - 8}
			y={yScale(tick)}
			text-anchor="end"
			dominant-baseline="middle"
			class="axis-label"
		>
			{formatCurrency(tick)}
		</text>
	{/each}

	<!-- Stacked bars -->
	{#each stackedBars as bar (bar.month)}
		{@const monthData = filteredData.find(d => d.month === bar.month)}
		{#each bar.bars as seg (seg.label)}
			{@const segmentValue = monthData?.segments.find(s => s.label === seg.label)?.value ?? 0}
			<rect
				x={bar.x}
				y={seg.y}
				width={barWidth}
				height={seg.height}
				fill={seg.color}
				rx="2"
				class="bar-segment"
				onmousemove={(e) => handleBarHover(e, bar, seg, segmentValue)}
				onmouseleave={handleBarLeave}
				role="img"
				aria-label="{seg.label}: {formatTooltipCurrency(segmentValue)}"
			/>
		{/each}
	{/each}

	<!-- Total line -->
	{#if totalPath}
		<path d={totalPath} fill="none" stroke="var(--color-text)" stroke-width="2" opacity="0.7" />
	{/if}

	<!-- Runway projection -->
	{#if runwayPath && runway}
		<path
			d={runwayPath}
			fill="none"
			stroke="var(--color-danger)"
			stroke-width="2"
			stroke-dasharray="6,4"
			opacity="0.8"
		/>
		<!-- Zero line indicator where runway ends -->
		{@const endX = xPos(data.length - 1) + barWidth / 2 + runwayBars * (barWidth + barGap)}
		<circle cx={endX} cy={yScale(0)} r="4" fill="var(--color-danger)" />
		<text x={endX} y={yScale(0) - 10} text-anchor="middle" class="runway-label">
			{formatRunwayDate(runway.exhaustionDate)}
		</text>
	{/if}

	<!-- X-axis labels -->
	{#each filteredData as d, i (d.month)}
		{#if i % labelStep === 0}
			<text x={xPos(i)} y={height - 8} text-anchor="middle" class="axis-label">
				{formatMonth(d.month)}
			</text>
		{/if}
	{/each}
</svg>

<ChartTooltip data={tooltip} {containerRect} />
</div>

<div class="legend">
	{#each allLabels as label (label)}
		<button
			class="legend-item"
			class:disabled={disabledLabels.has(label)}
			onclick={() => toggleLabel(label)}
			type="button"
		>
			<span
				class="legend-color"
				style="background: {labelColorMap.get(label)}"
				class:faded={disabledLabels.has(label)}
			></span>
			{label}
		</button>
	{/each}
</div>

<style>
	.chart-container {
		position: relative;
	}

	.chart-title {
		margin: 0 0 var(--spacing-sm);
		font-size: 16px;
		font-weight: 500;
	}

	.chart {
		width: 100%;
		height: auto;
		max-height: 280px;
	}

	.bar-segment {
		cursor: pointer;
		transition: opacity 0.1s;
	}

	.bar-segment:hover {
		opacity: 0.8;
	}

	.axis-label {
		font-size: 11px;
		font-family: var(--font-mono);
		fill: var(--color-text-muted);
	}

	.runway-label {
		font-size: 10px;
		font-family: var(--font-mono);
		fill: var(--color-danger);
		font-weight: 500;
	}

	.burn-rate {
		font-size: 12px;
		font-family: var(--font-mono);
		font-weight: 500;
		fill: var(--color-text-muted);
	}

	.burn-rate.negative {
		fill: var(--color-danger);
	}

	.burn-rate.positive {
		fill: var(--color-success);
	}

	.months-remaining {
		font-size: 11px;
		font-family: var(--font-mono);
		fill: var(--color-danger);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--spacing-md);
		margin-top: var(--spacing-sm);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: none;
		border: none;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 12px;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.legend-item:hover {
		background: var(--color-bg-alt);
	}

	.legend-item.disabled {
		opacity: 0.5;
		text-decoration: line-through;
	}

	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		transition: opacity 0.15s;
	}

	.legend-color.faded {
		opacity: 0.3;
	}
</style>
