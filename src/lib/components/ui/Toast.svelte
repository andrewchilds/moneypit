<script lang="ts" module>
	export interface ToastMessage {
		id: string;
		type: 'success' | 'error' | 'info' | 'warning';
		message: string;
	}

	let toasts = $state<ToastMessage[]>([]);

	export function showToast(type: ToastMessage['type'], message: string, duration = 4000) {
		const id = crypto.randomUUID();
		toasts = [...toasts, { id, type, message }];

		if (duration > 0) {
			setTimeout(() => {
				dismissToast(id);
			}, duration);
		}
	}

	export function dismissToast(id: string) {
		toasts = toasts.filter((t) => t.id !== id);
	}
</script>

<script lang="ts">
	import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-svelte';

	const icons = {
		success: CheckCircle,
		error: AlertCircle,
		info: Info,
		warning: AlertTriangle
	};
</script>

{#if toasts.length > 0}
	<div class="toast-container">
		{#each toasts as toast (toast.id)}
			{@const Icon = icons[toast.type]}
			<div class="toast toast-{toast.type}" role="alert">
				<Icon size={18} />
				<span class="toast-message">{toast.message}</span>
				<button class="toast-close" onclick={() => dismissToast(toast.id)} aria-label="Dismiss">
					<X size={16} />
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: var(--spacing-lg);
		right: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		z-index: 1100;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		animation: slide-in 0.2s ease;
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.toast-success {
		background: var(--color-success-light);
		color: var(--color-success);
	}

	.toast-error {
		background: var(--color-danger-light);
		color: var(--color-danger);
	}

	.toast-info {
		background: var(--color-info-light);
		color: #087990;
	}

	.toast-warning {
		background: var(--color-warning-light);
		color: #997404;
	}

	.toast-message {
		flex: 1;
	}

	.toast-close {
		display: flex;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
	}

	.toast-close:hover {
		opacity: 1;
	}
</style>
