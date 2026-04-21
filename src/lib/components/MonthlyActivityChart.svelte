<script lang="ts">
	import ChartTooltip, { type TooltipData } from './ChartTooltip.svelte';

	interface MonthlyData {
		month: string;
		debits: number;
		credits: number;
		endBalance: number;
	}

	interface Props {
		data: MonthlyData[];
		height?: number;
	}

	let { data, height = 200 }: Props = $props();

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

	function handleBarHover(event: MouseEvent, monthData: MonthlyData, type: 'debit' | 'credit') {
		if (!containerEl) return;
		containerRect = containerEl.getBoundingClientRect();

		const x = event.clientX - containerRect.left;
		const y = event.clientY - containerRect.top;

		const items: TooltipData['items'] = [];
		if (type === 'debit') {
			items.push({ label: 'In (Debits)', value: formatTooltipCurrency(monthData.debits), color: 'var(--color-success)' });
		} else {
			items.push({ label: 'Out (Credits)', value: formatTooltipCurrency(monthData.credits), color: 'var(--color-danger)' });
		}
		items.push({ label: 'Balance', value: formatTooltipCurrency(monthData.endBalance) });

		tooltip = {
			x,
			y,
			title: formatTooltipMonth(monthData.month),
			items
		};
	}

	function handleBarLeave() {
		tooltip = null;
	}

	const padding = { top: 20, right: 60, bottom: 30, left: 50 };
	const width = 800;

	const chartWidth = $derived(width - padding.left - padding.right);
	const chartHeight = $derived(height - padding.top - padding.bottom);

	// Find max values for scaling bars (centered at zero)
	const maxGain = $derived(Math.max(...data.map((d) => d.debits), 0.01));
	const maxLoss = $derived(Math.max(...data.map((d) => d.credits), 0.01));
	const maxFlow = $derived(Math.max(maxGain, maxLoss));

	// Balance range for the line
	const balances = $derived(data.map((d) => d.endBalance));
	const minBalance = $derived(Math.min(...balances, 0));
	const maxBalance = $derived(Math.max(...balances, 0));
	const balanceRange = $derived(Math.max(maxBalance - minBalance, 0.01));

	// Bar dimensions
	const barGap = $derived(Math.max(2, chartWidth / data.length * 0.15));
	const barWidth = $derived(Math.max(4, (chartWidth - barGap * (data.length + 1)) / data.length));

	// Center Y for bars (zero line)
	const centerY = $derived(padding.top + chartHeight / 2);
	const halfHeight = $derived(chartHeight / 2);

	// X position for bar center
	function xPos(index: number): number {
		return padding.left + barGap + index * (barWidth + barGap) + barWidth / 2;
	}

	// Bar heights scaled to half the chart
	function barHeightGain(value: number): number {
		return (value / maxFlow) * halfHeight * 0.9;
	}

	function barHeightLoss(value: number): number {
		return (value / maxFlow) * halfHeight * 0.9;
	}

	// For balance line: scale to full height
	function yScaleBalance(value: number): number {
		return padding.top + chartHeight - ((value - minBalance) / balanceRange) * chartHeight;
	}

	// Build stepped balance line path (horizontal across bar, vertical step between bars)
	const balancePath = $derived.by(() => {
		if (data.length === 0) return '';
		const segments: string[] = [];
		for (let i = 0; i < data.length; i++) {
			const y = yScaleBalance(data[i].endBalance);
			const xLeft = xPos(i) - barWidth / 2;
			const xRight = xPos(i) + barWidth / 2;
			if (i === 0) {
				segments.push(`M${xLeft},${y}`);
			}
			// Horizontal line across the bar
			segments.push(`H${xRight}`);
			// If not last, go to midpoint between bars, then step vertically
			if (i < data.length - 1) {
				const midX = (xRight + xPos(i + 1) - barWidth / 2) / 2;
				const nextY = yScaleBalance(data[i + 1].endBalance);
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
		if (Math.abs(value) >= 1000) {
			return `$${(value / 1000).toFixed(0)}k`;
		}
		return `$${value.toFixed(0)}`;
	}

	// Get tick values for balance axis (right side)
	const balanceTicks = $derived.by(() => {
		const range = maxBalance - minBalance;
		const step = Math.pow(10, Math.floor(Math.log10(range))) || 1;
		const ticks: number[] = [];
		let tick = Math.ceil(minBalance / step) * step;
		while (tick <= maxBalance) {
			ticks.push(tick);
			tick += step;
		}
		return ticks.slice(0, 5);
	});

	// Get tick values for in/out axis (left side) - symmetric around zero
	const flowTicks = $derived.by(() => {
		const step = Math.pow(10, Math.floor(Math.log10(maxFlow))) || 1;
		const ticks: number[] = [0];
		let tick = step;
		while (tick <= maxFlow) {
			ticks.push(tick);
			ticks.push(-tick);
			tick += step;
		}
		return ticks.sort((a, b) => b - a).slice(0, 5);
	});

	// Y position for flow ticks (centered at zero)
	function yScaleFlow(value: number): number {
		return centerY - (value / maxFlow) * halfHeight * 0.9;
	}

	// X-axis labels (show every nth month if too many)
	const labelStep = $derived(data.length > 12 ? Math.ceil(data.length / 12) : 1);
</script>

<div class="chart-container" bind:this={containerEl}>
<svg viewBox="0 0 {width} {height}" class="chart" preserveAspectRatio="xMidYMid meet">
	<!-- Zero line -->
	<line
		x1={padding.left}
		y1={centerY}
		x2={width - padding.right}
		y2={centerY}
		stroke="var(--color-border)"
		stroke-width="1"
	/>

	<!-- In/Out axis (left side) -->
	{#each flowTicks as tick (tick)}
		<text
			x={padding.left - 8}
			y={yScaleFlow(tick)}
			text-anchor="end"
			dominant-baseline="middle"
			class="axis-label flow-label"
		>
			{formatCurrency(Math.abs(tick))}
		</text>
	{/each}

	<!-- Bars -->
	{#each data as d, i (d.month)}
		<!-- Gain bar (green, above zero) -->
		{#if d.debits > 0}
			<rect
				x={xPos(i) - barWidth / 2}
				y={centerY - barHeightGain(d.debits)}
				width={barWidth}
				height={barHeightGain(d.debits)}
				fill="var(--color-success)"
				fill-opacity="0.7"
				rx="2"
				class="bar-segment"
				onmousemove={(e) => handleBarHover(e, d, 'debit')}
				onmouseleave={handleBarLeave}
				role="img"
				aria-label="In: {formatTooltipCurrency(d.debits)}"
			/>
		{/if}
		<!-- Loss bar (red, below zero) -->
		{#if d.credits > 0}
			<rect
				x={xPos(i) - barWidth / 2}
				y={centerY}
				width={barWidth}
				height={barHeightLoss(d.credits)}
				fill="var(--color-danger)"
				fill-opacity="0.7"
				rx="2"
				class="bar-segment"
				onmousemove={(e) => handleBarHover(e, d, 'credit')}
				onmouseleave={handleBarLeave}
				role="img"
				aria-label="Out: {formatTooltipCurrency(d.credits)}"
			/>
		{/if}
	{/each}

	<!-- Balance line (stepped) -->
	{#if balancePath}
		<path d={balancePath} fill="none" stroke="var(--color-primary)" stroke-width="2" />
	{/if}

	<!-- X-axis labels -->
	{#each data as d, i (d.month)}
		{#if i % labelStep === 0}
			<text
				x={xPos(i)}
				y={height - 8}
				text-anchor="middle"
				class="axis-label"
			>
				{formatMonth(d.month)}
			</text>
		{/if}
	{/each}

	<!-- Balance axis (right side) -->
	{#each balanceTicks as tick (tick)}
		<text
			x={width - padding.right + 8}
			y={yScaleBalance(tick)}
			text-anchor="start"
			dominant-baseline="middle"
			class="axis-label balance-label"
		>
			{formatCurrency(tick)}
		</text>
	{/each}
</svg>

<ChartTooltip data={tooltip} {containerRect} />
</div>

<div class="legend">
	<span class="legend-item">
		<span class="legend-color gain"></span>
		In (Debits)
	</span>
	<span class="legend-item">
		<span class="legend-color loss"></span>
		Out (Credits)
	</span>
	<span class="legend-item">
		<span class="legend-color balance"></span>
		Balance
	</span>
</div>

<style>
	.chart-container {
		position: relative;
	}

	.chart {
		width: 100%;
		height: auto;
		max-height: 250px;
	}

	.bar-segment {
		cursor: pointer;
		transition: fill-opacity 0.1s;
	}

	.bar-segment:hover {
		fill-opacity: 0.9;
	}

	.axis-label {
		font-size: 11px;
		fill: var(--color-text-muted);
	}

	.balance-label,
	.flow-label {
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.legend {
		display: flex;
		justify-content: center;
		gap: var(--spacing-lg);
		margin-top: var(--spacing-sm);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}

	.legend-color.gain {
		background: var(--color-success);
		opacity: 0.5;
	}

	.legend-color.loss {
		background: var(--color-danger);
		opacity: 0.5;
	}

	.legend-color.balance {
		background: var(--color-primary);
	}
</style>
