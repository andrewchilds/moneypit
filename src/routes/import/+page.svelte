<script lang="ts">
	import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, Eye, Settings2 } from "lucide-svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Dropdown from "$lib/components/ui/Dropdown.svelte";
	import { enhance } from "$app/forms";

	let { data, form } = $props();

	interface PreviewTransaction {
		date: string;
		description: string;
		memo?: string;
		amount: number;
		side: "debit" | "credit";
		isDuplicate: boolean;
	}

	interface PreviewData {
		transactions: PreviewTransaction[];
		total: number;
		duplicates: number;
		filename: string;
	}

	interface CSVPreviewData {
		headers: string[];
		rows: Record<string, string>[];
		filename: string;
	}

	interface CSVFilter {
		column: string;
		exclude: string[];
	}

	interface CSVMapping {
		dateColumn: string;
		amountColumn?: string;
		debitColumn?: string;
		creditColumn?: string;
		descriptionColumn: string;
		memoColumn?: string;
		amountSign?: "standard" | "inverted";
		filters?: CSVFilter[];
	}

	let selectedFile = $state<File | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let accountId = $state("");
	let isUploading = $state(false);
	let isPreviewing = $state(false);
	let isLoadingCSV = $state(false);
	let previewData = $state<PreviewData | null>(null);
	let previewError = $state<string | null>(null);

	// CSV mapping state
	let csvPreview = $state<CSVPreviewData | null>(null);
	let dateColumn = $state("");
	let descriptionColumn = $state("");
	let amountMode = $state<"single" | "split">("single");
	let amountColumn = $state("");
	let debitColumn = $state("");
	let creditColumn = $state("");
	let memoColumn = $state("");
	let invertAmounts = $state(false);
	let filters = $state<{ column: string; excludeValues: string }[]>([]);

	const accountOptions = $derived([
		{ value: "", label: "Select account..." },
		...data.accounts.map((a) => ({ value: a.id, label: `${a.type}: ${a.path}` }))
	]);

	const columnOptions = $derived([
		{ value: "", label: "Select column..." },
		...(csvPreview?.headers.map((h) => ({ value: h, label: h })) ?? [])
	]);

	const optionalColumnOptions = $derived([
		{ value: "", label: "None" },
		...(csvPreview?.headers.map((h) => ({ value: h, label: h })) ?? [])
	]);

	const detectedFileType = $derived.by(() => {
		if (!selectedFile) return null;
		if (selectedFile.name.match(/\.(ofx|qfx)$/i)) return "ofx";
		if (selectedFile.name.match(/\.csv$/i)) return "csv";
		return null;
	});

	const selectedAccount = $derived(data.accounts.find((a) => a.id === accountId));

	const currentMapping = $derived.by((): CSVMapping | null => {
		if (!dateColumn || !descriptionColumn) return null;
		if (amountMode === "single" && !amountColumn) return null;
		if (amountMode === "split" && !debitColumn && !creditColumn) return null;

		const mapping: CSVMapping = {
			dateColumn,
			descriptionColumn
		};

		if (amountMode === "single") {
			mapping.amountColumn = amountColumn;
		} else {
			if (debitColumn) mapping.debitColumn = debitColumn;
			if (creditColumn) mapping.creditColumn = creditColumn;
		}

		if (memoColumn) mapping.memoColumn = memoColumn;
		if (invertAmounts) mapping.amountSign = "inverted";

		// Add filters
		const activeFilters = filters
			.filter((f) => f.column && f.excludeValues.trim())
			.map((f) => ({
				column: f.column,
				exclude: f.excludeValues.split(",").map((v) => v.trim()).filter(Boolean)
			}));
		if (activeFilters.length > 0) {
			mapping.filters = activeFilters;
		}

		return mapping;
	});

	const canPreview = $derived(
		selectedFile &&
			accountId &&
			(detectedFileType === "ofx" || (detectedFileType === "csv" && currentMapping))
	);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			selectedFile = input.files[0];
			// Reset CSV state when file changes
			csvPreview = null;
			previewData = null;
			previewError = null;
			// Auto-load CSV preview
			if (selectedFile.name.match(/\.csv$/i)) {
				loadCSVPreview();
			}
		}
	}

	function clearFile() {
		selectedFile = null;
		previewData = null;
		previewError = null;
		csvPreview = null;
		resetMappingState();
		if (fileInputRef) {
			fileInputRef.value = "";
		}
	}

	function resetMappingState() {
		dateColumn = "";
		descriptionColumn = "";
		amountMode = "single";
		amountColumn = "";
		debitColumn = "";
		creditColumn = "";
		memoColumn = "";
		invertAmounts = false;
		filters = [];
	}

	async function loadCSVPreview() {
		if (!selectedFile) return;

		isLoadingCSV = true;
		const formData = new FormData();
		formData.append("file", selectedFile);

		try {
			const response = await fetch("/import/csv-preview", {
				method: "POST",
				body: formData
			});
			const result = await response.json();
			if (response.ok) {
				csvPreview = result;
				autoDetectMapping(result.headers);
			} else {
				previewError = result.error || "Failed to read CSV file";
			}
		} catch {
			previewError = "Failed to read CSV file";
		} finally {
			isLoadingCSV = false;
		}
	}

	function autoDetectMapping(headers: string[]) {
		const lowerHeaders = headers.map((h) => h.toLowerCase());

		// Detect date column
		const datePatterns = ["date", "transaction date", "posting date", "trans date"];
		for (const pattern of datePatterns) {
			const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
			if (idx !== -1) {
				dateColumn = headers[idx];
				break;
			}
		}

		// Detect description column
		const descPatterns = ["description", "memo", "payee", "merchant", "name"];
		for (const pattern of descPatterns) {
			const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
			if (idx !== -1) {
				descriptionColumn = headers[idx];
				break;
			}
		}

		// Detect amount column(s)
		const hasDebit = lowerHeaders.some((h) => h === "debit" || h.includes("debit"));
		const hasCredit = lowerHeaders.some((h) => h === "credit" || h.includes("credit"));

		if (hasDebit || hasCredit) {
			amountMode = "split";
			const debitIdx = lowerHeaders.findIndex((h) => h === "debit" || h.includes("debit"));
			const creditIdx = lowerHeaders.findIndex((h) => h === "credit" || h.includes("credit"));
			if (debitIdx !== -1) debitColumn = headers[debitIdx];
			if (creditIdx !== -1) creditColumn = headers[creditIdx];
		} else {
			amountMode = "single";
			const amountPatterns = ["amount", "sum", "total"];
			for (const pattern of amountPatterns) {
				const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
				if (idx !== -1) {
					amountColumn = headers[idx];
					break;
				}
			}
		}

		// Detect memo column (if different from description)
		if (descriptionColumn) {
			const memoIdx = lowerHeaders.findIndex(
				(h) => (h.includes("memo") || h.includes("note")) && headers[lowerHeaders.indexOf(h)] !== descriptionColumn
			);
			if (memoIdx !== -1) {
				memoColumn = headers[memoIdx];
			}
		}

		// Auto-invert for liability accounts (credit cards show charges as positive)
		if (selectedAccount?.type === "LIABILITY") {
			invertAmounts = true;
		}
	}

	async function handlePreview() {
		if (!selectedFile || !accountId) return;
		if (detectedFileType === "csv" && !currentMapping) return;

		isPreviewing = true;
		previewError = null;
		const formData = new FormData();
		formData.append("file", selectedFile);
		formData.append("accountId", accountId);
		if (currentMapping) {
			formData.append("mapping", JSON.stringify(currentMapping));
		}

		try {
			const response = await fetch("/import/preview", {
				method: "POST",
				body: formData
			});
			const result = await response.json();
			if (response.ok) {
				previewData = result;
			} else {
				previewError = result.error || "Failed to generate preview";
				previewData = null;
			}
		} catch {
			previewError = "Failed to generate preview";
			previewData = null;
		} finally {
			isPreviewing = false;
		}
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			selectedFile = e.dataTransfer.files[0];
			csvPreview = null;
			previewData = null;
			previewError = null;
			// Update the file input so form submission includes the file
			if (fileInputRef) {
				const dt = new DataTransfer();
				dt.items.add(selectedFile);
				fileInputRef.files = dt.files;
			}
			// Auto-load CSV preview
			if (selectedFile.name.match(/\.csv$/i)) {
				loadCSVPreview();
			}
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
	}
</script>

<div class="import-page">
	<header class="page-header">
		<h1>Import</h1>
	</header>

	{#if form?.success && form?.result}
		<div class="result-card success">
			<CheckCircle size={24} />
			<div class="result-content">
				<h3>Import Complete</h3>
				<ul class="result-stats">
					<li><strong>{form.result.imported}</strong> transactions imported</li>
					{#if form.result.skipped > 0}
						<li><strong>{form.result.skipped}</strong> duplicates skipped</li>
					{/if}
				</ul>
				{#if form.result.duplicates.length > 0}
					<details class="duplicates-list">
						<summary>View duplicates</summary>
						<ul>
							{#each form.result.duplicates as dup, i (i)}
								<li>{dup}</li>
							{/each}
						</ul>
					</details>
				{/if}
			</div>
			<Button variant="secondary" onclick={clearFile}>Import Another</Button>
		</div>
	{:else}
		<div class="import-form">
			<form
				method="POST"
				action="?/import"
				enctype="multipart/form-data"
				use:enhance={() => {
					isUploading = true;
					return async ({ update }) => {
						isUploading = false;
						await update();
					};
				}}
			>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="drop-zone" class:has-file={selectedFile} ondrop={handleDrop} ondragover={handleDragOver}>
					{#if selectedFile}
						<div class="file-info">
							{#if detectedFileType === "ofx"}
								<FileText size={32} />
							{:else}
								<FileSpreadsheet size={32} />
							{/if}
							<div class="file-details">
								<span class="file-name">{selectedFile.name}</span>
								<span class="file-size">{(selectedFile.size / 1024).toFixed(1)} KB</span>
							</div>
							<Button variant="ghost" size="sm" onclick={clearFile}>Remove</Button>
						</div>
					{:else}
						<Upload size={32} />
						<p>Drag and drop a file here, or click to browse</p>
						<span class="supported-formats">Supports OFX, QFX, and CSV files</span>
					{/if}

					<input
						bind:this={fileInputRef}
						type="file"
						name="file"
						accept=".ofx,.qfx,.csv"
						onchange={handleFileChange}
						class="file-input"
					/>
				</div>

				{#if selectedFile}
					<div class="form-fields">
						<div class="form-group">
							<label for="account">Target Account</label>
							<Dropdown options={accountOptions} bind:value={accountId} />
							<input type="hidden" name="accountId" value={accountId} />
							<small class="hint">The bank account or credit card this statement is from</small>
						</div>

						<input type="hidden" name="fileType" value={detectedFileType} />
						{#if currentMapping}
							<input type="hidden" name="mapping" value={JSON.stringify(currentMapping)} />
						{/if}
					</div>

					{#if detectedFileType === "csv"}
						{#if isLoadingCSV}
							<div class="loading-csv">Reading CSV file...</div>
						{:else if csvPreview}
							<div class="mapping-section">
								<div class="mapping-header">
									<Settings2 size={18} />
									<h3>Column Mapping</h3>
								</div>

								<div class="mapping-grid">
									<div class="form-group">
										<label for="dateColumn">Date Column</label>
										<Dropdown options={columnOptions} bind:value={dateColumn} />
									</div>

									<div class="form-group">
										<label for="descriptionColumn">Description Column</label>
										<Dropdown options={columnOptions} bind:value={descriptionColumn} />
									</div>

									<div class="form-group">
										<label for="memoColumn">Memo Column</label>
										<Dropdown options={optionalColumnOptions} bind:value={memoColumn} />
									</div>
								</div>

								<div class="amount-section">
									<div class="amount-mode-toggle">
										<button
											type="button"
											class="mode-btn"
											class:active={amountMode === "single"}
											onclick={() => (amountMode = "single")}
										>
											Single Amount Column
										</button>
										<button
											type="button"
											class="mode-btn"
											class:active={amountMode === "split"}
											onclick={() => (amountMode = "split")}
										>
											Separate Debit/Credit
										</button>
									</div>

									{#if amountMode === "single"}
										<div class="mapping-grid single-row">
											<div class="form-group">
												<label for="amountColumn">Amount Column</label>
												<Dropdown options={columnOptions} bind:value={amountColumn} />
											</div>
										</div>
									{:else}
										<div class="mapping-grid">
											<div class="form-group">
												<label for="debitColumn">Debit Column (Money In)</label>
												<Dropdown options={optionalColumnOptions} bind:value={debitColumn} />
											</div>

											<div class="form-group">
												<label for="creditColumn">Credit Column (Money Out)</label>
												<Dropdown options={optionalColumnOptions} bind:value={creditColumn} />
											</div>
										</div>
									{/if}
								</div>

								<label class="invert-toggle">
									<input type="checkbox" bind:checked={invertAmounts} />
									<span>Invert amounts</span>
									<small>Check this if positive numbers represent money going out (common for credit card statements)</small>
								</label>

								<div class="filter-section">
									<div class="filter-header">
										<span>Exclude Rows</span>
										<button
											type="button"
											class="add-filter-btn"
											onclick={() => (filters = [...filters, { column: "", excludeValues: "" }])}
										>
											+ Add Filter
										</button>
									</div>
									{#if filters.length > 0}
										<div class="filter-list">
											{#each filters as filter, i (i)}
												<div class="filter-row">
													<Dropdown
														options={columnOptions}
														bind:value={filter.column}
														placeholder="Column..."
													/>
													<input
														type="text"
														class="filter-input"
														placeholder="Values to exclude (comma-separated)"
														bind:value={filter.excludeValues}
													/>
													<button
														type="button"
														class="remove-filter-btn"
														onclick={() => (filters = filters.filter((_, idx) => idx !== i))}
													>
														×
													</button>
												</div>
											{/each}
										</div>
									{:else}
										<p class="filter-hint">Filter out rows by column values (e.g., exclude "Dividend Received" transactions)</p>
									{/if}
								</div>

								{#if csvPreview.rows.length > 0}
									<div class="csv-sample">
										<h4>Sample Data</h4>
										<div class="sample-table-wrapper">
											<table class="sample-table">
												<thead>
													<tr>
														{#each csvPreview.headers as header (header)}
															<th class:mapped={header === dateColumn || header === descriptionColumn || header === amountColumn || header === debitColumn || header === creditColumn || header === memoColumn}>
																{header}
															</th>
														{/each}
													</tr>
												</thead>
												<tbody>
													{#each csvPreview.rows.slice(0, 3) as row, idx (idx)}
														<tr>
															{#each csvPreview.headers as header (header)}
																<td class:mapped={header === dateColumn || header === descriptionColumn || header === amountColumn || header === debitColumn || header === creditColumn || header === memoColumn}>
																	{row[header] || ""}
																</td>
															{/each}
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					{/if}

					{#if !previewData && (detectedFileType === "ofx" || csvPreview)}
						<div class="form-actions">
							<Button variant="primary" onclick={handlePreview} disabled={isPreviewing || !canPreview}>
								{#if isPreviewing}
									Loading preview...
								{:else}
									<Eye size={16} />
									Preview Import
								{/if}
							</Button>
						</div>
					{/if}

					{#if previewError}
						<div class="error-message">
							<AlertCircle size={18} />
							{previewError}
						</div>
					{/if}

					{#if previewData}
						<div class="preview-section">
							<div class="preview-header">
								<div>
									<h3>Preview: {previewData.filename}</h3>
									<p class="preview-hint">
										{previewData.total} transactions
										{#if previewData.duplicates > 0}
											<span class="duplicate-warning">({previewData.duplicates} duplicates will be skipped)</span>
										{/if}
									</p>
								</div>
								<Button variant="ghost" size="sm" onclick={() => (previewData = null)}>Change</Button>
							</div>
							<div class="preview-table-wrapper">
								<table class="preview-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Description</th>
											<th class="text-right">Credit (Out)</th>
											<th class="text-right">Debit (In)</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#each previewData.transactions.slice(0, 20) as tx, idx (idx)}
											<tr class:duplicate={tx.isDuplicate}>
												<td class="date-cell">{formatDate(tx.date)}</td>
												<td class="desc-cell">
													{tx.description}
													{#if tx.memo}
														<span class="memo">{tx.memo}</span>
													{/if}
												</td>
												<td class="amount-cell text-right">
													{#if tx.side === "credit"}
														{formatCurrency(tx.amount)}
													{/if}
												</td>
												<td class="amount-cell text-right">
													{#if tx.side === "debit"}
														{formatCurrency(tx.amount)}
													{/if}
												</td>
												<td class="status-cell">
													{#if tx.isDuplicate}
														<span class="duplicate-badge">Duplicate</span>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
								{#if previewData.transactions.length > 20}
									<p class="preview-truncated">Showing 20 of {previewData.transactions.length} transactions</p>
								{/if}
							</div>
							<div class="form-actions">
								<Button variant="primary" type="submit" disabled={isUploading}>
									{#if isUploading}
										Importing...
									{:else}
										<Upload size={16} />
										Import {previewData.total - previewData.duplicates} Transactions
									{/if}
								</Button>
							</div>
						</div>
					{/if}

					{#if form?.error}
						<div class="error-message">
							<AlertCircle size={18} />
							{form.error}
						</div>
					{/if}
				{/if}
			</form>
		</div>
	{/if}
</div>

<style>
	.import-page {
		max-width: 900px;
	}

	.page-header h1 {
		margin: 0 0 var(--spacing-lg);
		font-size: 24px;
	}

	.import-form {
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
	}

	.drop-zone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.drop-zone:hover {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.drop-zone.has-file {
		border-style: solid;
		border-color: var(--color-success);
		background: var(--color-success-light);
		cursor: default;
	}

	.drop-zone p {
		margin: var(--spacing-sm) 0 0;
	}

	.supported-formats {
		font-size: 12px;
		margin-top: var(--spacing-xs);
	}

	.file-input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.has-file .file-input {
		display: none;
	}

	.file-info {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		color: var(--color-success);
	}

	.file-details {
		display: flex;
		flex-direction: column;
	}

	.file-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.file-size {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.form-fields {
		margin-top: var(--spacing-lg);
		display: grid;
		gap: var(--spacing-md);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group label {
		font-weight: 500;
		font-size: 13px;
	}

	.hint {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		margin-top: var(--spacing-md);
		background: var(--color-danger-light);
		color: var(--color-danger);
		border-radius: var(--radius-sm);
	}

	.form-actions {
		margin-top: var(--spacing-lg);
	}

	.result-card {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-md);
		padding: var(--spacing-lg);
		border-radius: var(--radius-lg);
	}

	.result-card.success {
		background: var(--color-success-light);
		color: var(--color-success);
	}

	.result-content {
		flex: 1;
	}

	.result-content h3 {
		margin: 0 0 var(--spacing-sm);
		color: var(--color-text);
	}

	.result-stats {
		list-style: none;
		margin: 0;
		padding: 0;
		color: var(--color-text);
	}

	.result-stats li {
		padding: var(--spacing-xs) 0;
	}

	.duplicates-list {
		margin-top: var(--spacing-sm);
		font-size: 13px;
		color: var(--color-text-muted);
	}

	.duplicates-list summary {
		cursor: pointer;
	}

	.duplicates-list ul {
		margin: var(--spacing-sm) 0 0;
		padding-left: var(--spacing-md);
	}

	.loading-csv {
		margin-top: var(--spacing-lg);
		padding: var(--spacing-md);
		text-align: center;
		color: var(--color-text-muted);
	}

	.mapping-section {
		margin-top: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-md);
	}

	.mapping-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
		color: var(--color-text);
	}

	.mapping-header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}

	.mapping-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.mapping-grid.single-row {
		grid-template-columns: 1fr;
		max-width: 300px;
	}

	.amount-section {
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}

	.amount-mode-toggle {
		display: flex;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-md);
	}

	.mode-btn {
		flex: 1;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-sm);
		font-size: 13px;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.mode-btn:hover {
		border-color: var(--color-primary);
	}

	.mode-btn.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.invert-toggle {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.invert-toggle input {
		margin: 0;
	}

	.invert-toggle span {
		font-weight: 500;
	}

	.invert-toggle small {
		flex-basis: 100%;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-left: calc(16px + var(--spacing-sm));
	}

	.filter-section {
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}

	.filter-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.filter-header span {
		font-weight: 500;
		font-size: 13px;
	}

	.add-filter-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-sm);
		font-size: 12px;
		cursor: pointer;
	}

	.add-filter-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.filter-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.filter-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: center;
	}

	.filter-input {
		flex: 1;
		padding: var(--spacing-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.filter-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.remove-filter-btn {
		padding: var(--spacing-xs) var(--spacing-sm);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: 18px;
		cursor: pointer;
		line-height: 1;
	}

	.remove-filter-btn:hover {
		color: var(--color-danger);
	}

	.filter-hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.csv-sample {
		margin-top: var(--spacing-md);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border-light);
	}

	.csv-sample h4 {
		margin: 0 0 var(--spacing-sm);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.sample-table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-sm);
	}

	.sample-table {
		min-width: 100%;
		font-size: 12px;
		background: var(--color-bg);
	}

	.sample-table th,
	.sample-table td {
		padding: var(--spacing-xs) var(--spacing-sm);
		white-space: nowrap;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sample-table th {
		background: var(--color-bg-alt);
		font-weight: 500;
		text-align: left;
	}

	.sample-table th.mapped,
	.sample-table td.mapped {
		background: var(--color-primary-light);
	}

	.preview-section {
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-lg);
		border-top: 1px solid var(--color-border-light);
	}

	.preview-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-md);
	}

	.preview-section h3 {
		margin: 0 0 var(--spacing-xs);
		font-size: 14px;
	}

	.preview-hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.duplicate-warning {
		color: var(--color-warning);
	}

	.preview-table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
	}

	.preview-table {
		min-width: 100%;
		font-size: 13px;
	}

	.preview-table th,
	.preview-table td {
		white-space: nowrap;
	}

	.preview-table .text-right {
		text-align: right;
	}

	.preview-table .date-cell {
		width: 100px;
	}

	.preview-table .desc-cell {
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preview-table .desc-cell .memo {
		display: block;
		font-size: 11px;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preview-table .amount-cell {
		width: 100px;
		font-family: var(--font-mono);
	}

	.preview-table .status-cell {
		width: 80px;
	}

	.preview-table tr.duplicate {
		opacity: 0.5;
	}

	.duplicate-badge {
		font-size: 10px;
		padding: 2px 6px;
		background: var(--color-warning-light);
		color: var(--color-warning);
		border-radius: var(--radius-sm);
	}

	.preview-truncated {
		padding: var(--spacing-sm);
		text-align: center;
		font-size: 12px;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border-light);
		margin: 0;
	}
</style>
