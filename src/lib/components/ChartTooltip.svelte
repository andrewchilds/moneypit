<script lang="ts">
	export interface TooltipData {
		x: number;
		y: number;
		title: string;
		items: { label: string; value: string; color?: string }[];
	}

	interface Props {
		data: TooltipData | null;
		containerRect?: DOMRect | null;
	}

	let { data, containerRect = null }: Props = $props();

	const tooltipOffset = 12;

	// Determine if cursor is on left or right half of container
	const isLeftHalf = $derived.by(() => {
		if (!data || !containerRect) return true;
		return data.x < containerRect.width / 2;
	});

	// Calculate position: right of cursor on left half, left of cursor on right half
	const position = $derived.by(() => {
		if (!data) return { left: 0, top: 0 };

		let left;
		let top = data.y;

		if (isLeftHalf) {
			// Position to the right of cursor
			left = data.x + tooltipOffset;
		} else {
			// Position to the left of cursor
			left = data.x - tooltipOffset;
		}

		return { left, top };
	});
</script>

{#if data}
	<div class="chart-tooltip" class:left-half={isLeftHalf} style="left: {position.left}px; top: {position.top}px;">
		<div class="tooltip-title">{data.title}</div>
		<div class="tooltip-items">
			{#each data.items as item (item.label)}
				<div class="tooltip-item">
					{#if item.color}
						<span class="tooltip-color" style="background: {item.color}"></span>
					{/if}
					<span class="tooltip-label">{item.label}</span>
					<span class="tooltip-value">{item.value}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.chart-tooltip {
		position: absolute;
		transform: translate(-100%, -50%);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		pointer-events: none;
		z-index: 100;
		min-width: 180px;
		max-width: 220px;
	}

	.chart-tooltip.left-half {
		transform: translate(0, -50%);
	}

	.tooltip-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border-light);
		padding-bottom: var(--spacing-xs);
	}

	.tooltip-items {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tooltip-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 12px;
	}

	.tooltip-color {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.tooltip-label {
		color: var(--color-text-muted);
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tooltip-value {
		font-family: var(--font-mono);
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
	}
</style>
