export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
	let targetEl: HTMLElement | null;

	function update(newTarget: HTMLElement | string) {
		if (typeof newTarget === 'string') {
			targetEl = document.querySelector(newTarget);
		} else {
			targetEl = newTarget;
		}

		if (targetEl) {
			targetEl.appendChild(node);
		}
	}

	update(target);

	return {
		update,
		destroy() {
			if (node.parentNode) {
				node.parentNode.removeChild(node);
			}
		}
	};
}
