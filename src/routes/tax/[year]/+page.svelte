<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { CircleHelp, FileCheck, FileWarning, Plus, Trash2, ChevronRight } from "lucide-svelte";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import type { PageData, ActionData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Question = PageData["status"]["modules"][number]["questions"][number];
	type Expected = PageData["status"]["expectedDocuments"][number];

	const year = $derived(data.status.year);
	const formTypes = $derived(Object.keys(data.formPresets));

	// Add-document modal, optionally prefilled from an expected document
	let showAddDocument = $state(false);
	let newFormType = $state("");
	let newIssuer = $state("");
	let newAccountId = $state("");
	let newStatus = $state("RECEIVED");

	function openAddDocument(expected?: Expected) {
		newFormType = expected?.formType ?? "";
		newIssuer = expected?.institution ?? "";
		newAccountId = expected?.accountIds[0] ?? "";
		newStatus = "RECEIVED";
		showAddDocument = true;
	}

	// Which documents have their add-line form open
	let addingLineFor = $state<string | null>(null);
	let lineBox = $state("");
	let lineLabel = $state("");
	let lineAmount = $state("");
	let lineCategory = $state("");

	function openAddLine(documentId: string) {
		addingLineFor = documentId;
		lineBox = "";
		lineLabel = "";
		lineAmount = "";
		lineCategory = "";
	}

	function boxesFor(formType: string) {
		return data.formPresets[formType]?.boxes ?? [];
	}

	function onBoxChange(formType: string) {
		const preset = boxesFor(formType).find((b) => b.box === lineBox);
		if (preset) lineLabel = preset.label;
	}

	function handleYearChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		goto(`/tax/${select.value}`);
	}

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
	}

	function formatAnswer(q: Question): string {
		if (q.answer === null) return "";
		if (q.type === "boolean") return q.answer ? "true" : "false";
		return String(q.answer);
	}

	function displayAnswer(q: Question): string {
		if (q.answer === null) return "";
		if (q.type === "boolean") return q.answer ? "Yes" : "No";
		if (q.type === "choice") return q.options?.find((o) => o.value === q.answer)?.label ?? String(q.answer);
		if (q.type === "amount") return formatCurrency(Number(q.answer));
		return String(q.answer);
	}

	const documentTotal = (doc: PageData["status"]["documents"][number]) =>
		doc.lines.reduce((sum, l) => sum + l.amount, 0);
</script>

<div class="tax-prep-page">
	<header class="page-header">
		<h1>Tax Prep</h1>
		<div class="header-actions">
			<a href="/reports/tax?year={year}" class="report-link">Tax Report <ChevronRight size={16} /></a>
			<select class="year-select" value={year} onchange={handleYearChange}>
				{#each data.availableYears as y (y)}
					<option value={y}>{y}</option>
				{/each}
			</select>
		</div>
	</header>

	<StatsGrid>
		<StatCard label="Open Questions" variant={data.status.openQuestions > 0 ? "negative" : "positive"}>
			{#snippet icon()}<CircleHelp size={24} />{/snippet}
			{data.status.openQuestions}
		</StatCard>
		<StatCard label="Missing Documents" variant={data.status.missingDocuments > 0 ? "negative" : "positive"}>
			{#snippet icon()}<FileWarning size={24} />{/snippet}
			{data.status.missingDocuments}
		</StatCard>
		<StatCard label="Documents On Hand" variant="positive">
			{#snippet icon()}<FileCheck size={24} />{/snippet}
			{data.status.documents.length}
		</StatCard>
	</StatsGrid>

	{#if form?.error}
		<div class="error-banner">{form.error}</div>
	{/if}

	<!-- Questions -->
	{#if data.status.modules.length === 0}
		<section class="section">
			<p class="muted">No tax modules are enabled for this book. Enable one in Settings to get a questionnaire.</p>
		</section>
	{/if}

	{#each data.status.modules as module (module.moduleId)}
		{@const visible = module.questions.filter((q) => q.visible)}
		{#if visible.length > 0}
			<section class="section">
				<h2>{module.name}</h2>
				<div class="questions">
					{#each visible as q (q.key)}
						<form method="POST" action="?/answer" use:enhance class="question" class:answered={q.answered}>
							<input type="hidden" name="key" value={q.key} />
							<div class="question-text">
								<label for="q-{q.key}">{q.prompt}</label>
								{#if q.description}
									<p class="hint">{q.description}</p>
								{/if}
								{#if q.carryForward}
									<span class="tag">carries forward</span>
								{:else if q.answered && q.answerYear === null}
									<span class="tag">from an earlier year</span>
								{/if}
							</div>
							<div class="question-input">
								{#if q.type === "boolean"}
									<select id="q-{q.key}" name="value" value={formatAnswer(q)}>
										<option value="">—</option>
										<option value="true">Yes</option>
										<option value="false">No</option>
									</select>
								{:else if q.type === "choice"}
									<select id="q-{q.key}" name="value" value={formatAnswer(q)}>
										<option value="">—</option>
										{#each q.options ?? [] as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if q.type === "amount" || q.type === "number"}
									<input
										id="q-{q.key}"
										type="number"
										name="value"
										step={q.type === "amount" ? "0.01" : "1"}
										value={formatAnswer(q)}
										placeholder={q.type === "amount" ? "0.00" : ""}
									/>
								{:else if q.type === "date"}
									<input id="q-{q.key}" type="date" name="value" value={formatAnswer(q)} />
								{:else}
									<input id="q-{q.key}" type="text" name="value" value={formatAnswer(q)} />
								{/if}
								<Button variant="secondary" size="sm" type="submit">Save</Button>
							</div>
							{#if q.answered}
								<span class="current">{displayAnswer(q)}</span>
							{/if}
						</form>
					{/each}
				</div>
			</section>
		{/if}
	{/each}

	<!-- Expected documents -->
	<section class="section">
		<div class="section-header">
			<h2>Expected Documents</h2>
			<Button variant="primary" size="sm" onclick={() => openAddDocument()}>
				<Plus size={16} /> Add document
			</Button>
		</div>
		<p class="muted">
			Inferred from this year's transactions and your answers. Mark one not applicable if it won't arrive.
		</p>
		{#if data.status.expectedDocuments.length === 0}
			<p class="muted">Nothing expected yet.</p>
		{:else}
			<table class="table">
				<thead>
					<tr>
						<th>Form</th>
						<th>From</th>
						<th>Why</th>
						<th>Status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.status.expectedDocuments as exp (exp.formType + exp.institution + exp.reason)}
						<tr>
							<td class="mono">{exp.formType}</td>
							<td>{exp.institution || "—"}</td>
							<td class="muted">{exp.reason}</td>
							<td>
								<span class="status status-{exp.status}">
									{exp.status === "received" ? "Received" : exp.status === "not_applicable" ? "N/A" : "Missing"}
								</span>
							</td>
							<td class="actions">
								{#if exp.status === "missing"}
									<Button size="sm" onclick={() => openAddDocument(exp)}>Add</Button>
									<form method="POST" action="?/addDocument" use:enhance>
										<input type="hidden" name="formType" value={exp.formType} />
										<input type="hidden" name="issuer" value={exp.institution || exp.formType} />
										<input type="hidden" name="accountId" value={exp.accountIds[0] ?? ""} />
										<input type="hidden" name="status" value="NOT_APPLICABLE" />
										<Button variant="ghost" size="sm" type="submit">Mark N/A</Button>
									</form>
								{:else if exp.documentId}
									<a href="#doc-{exp.documentId}">View</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<!-- Documents on hand -->
	<section class="section">
		<h2>Documents</h2>
		{#if data.status.documents.length === 0}
			<p class="muted">No documents recorded for {year}.</p>
		{/if}
		{#each data.status.documents as doc (doc.id)}
			<article class="document" id="doc-{doc.id}" class:na={doc.status === "NOT_APPLICABLE"}>
				<header class="document-header">
					<div>
						<span class="mono form-type">{doc.formType}</span>
						<strong>{doc.issuer}</strong>
						{#if doc.account}
							<span class="muted">· {doc.account.path}</span>
						{/if}
						{#if doc.status === "NOT_APPLICABLE"}
							<span class="tag">not applicable</span>
						{/if}
						{#if doc.notes}
							<p class="hint">{doc.notes}</p>
						{/if}
					</div>
					<div class="document-actions">
						{#if doc.status === "NOT_APPLICABLE"}
							<form method="POST" action="?/setDocumentStatus" use:enhance>
								<input type="hidden" name="id" value={doc.id} />
								<input type="hidden" name="status" value="RECEIVED" />
								<Button variant="ghost" size="sm" type="submit">Mark received</Button>
							</form>
						{:else}
							<Button variant="ghost" size="sm" onclick={() => openAddLine(doc.id)}><Plus size={14} /> Line</Button>
						{/if}
						<form method="POST" action="?/deleteDocument" use:enhance>
							<input type="hidden" name="id" value={doc.id} />
							<Button variant="ghost" size="sm" type="submit"><Trash2 size={14} /></Button>
						</form>
					</div>
				</header>

				{#if doc.lines.length > 0}
					<table class="table lines">
						<thead>
							<tr>
								<th>Box</th>
								<th>Label</th>
								<th>Tax category</th>
								<th class="amount">Amount</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each doc.lines as line (line.id)}
								<tr>
									<td class="mono">{line.box}</td>
									<td>{line.label}</td>
									<td class:muted={!line.taxCategory}>{line.taxCategory?.name ?? "not mapped"}</td>
									<td class="amount">{formatCurrency(line.amount)}</td>
									<td class="actions">
										<form method="POST" action="?/deleteLine" use:enhance>
											<input type="hidden" name="id" value={line.id} />
											<Button variant="ghost" size="sm" type="submit"><Trash2 size={14} /></Button>
										</form>
									</td>
								</tr>
							{/each}
							<tr class="total-row">
								<td></td>
								<td colspan="2"><strong>Total</strong></td>
								<td class="amount"><strong>{formatCurrency(documentTotal(doc))}</strong></td>
								<td></td>
							</tr>
						</tbody>
					</table>
				{/if}

				{#if addingLineFor === doc.id}
					<form
						method="POST"
						action="?/addLine"
						class="line-form"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === "success") addingLineFor = null;
								await update();
							}}
					>
						<input type="hidden" name="documentId" value={doc.id} />
						<div class="form-group">
							<label for="box-{doc.id}">Box</label>
							{#if boxesFor(doc.formType).length > 0}
								<input
									id="box-{doc.id}"
									name="box"
									list="boxes-{doc.id}"
									bind:value={lineBox}
									onchange={() => onBoxChange(doc.formType)}
									required
								/>
								<datalist id="boxes-{doc.id}">
									{#each boxesFor(doc.formType) as b (b.box)}
										<option value={b.box}>{b.label}</option>
									{/each}
								</datalist>
							{:else}
								<input id="box-{doc.id}" name="box" bind:value={lineBox} required />
							{/if}
						</div>
						<div class="form-group grow">
							<label for="label-{doc.id}">Label</label>
							<input id="label-{doc.id}" name="label" bind:value={lineLabel} placeholder="From the form" />
						</div>
						<div class="form-group">
							<label for="amount-{doc.id}">Amount</label>
							<input id="amount-{doc.id}" type="number" step="0.01" name="amount" bind:value={lineAmount} required />
						</div>
						<div class="form-group grow">
							<label for="category-{doc.id}">Tax category</label>
							<select id="category-{doc.id}" name="category" bind:value={lineCategory}>
								<option value="">Guess from the box</option>
								<option value="none">Not mapped</option>
								{#each data.taxCategories as c (c.id)}
									<option value={c.id}>{c.name}{c.scheduleRef ? ` (${c.scheduleRef})` : ""}</option>
								{/each}
							</select>
						</div>
						<div class="form-actions">
							<Button variant="secondary" size="sm" onclick={() => (addingLineFor = null)}>Cancel</Button>
							<Button variant="primary" size="sm" type="submit">Add line</Button>
						</div>
					</form>
				{/if}
			</article>
		{/each}
	</section>
</div>

<Modal bind:open={showAddDocument} title="Add document" onclose={() => (showAddDocument = false)}>
	<form
		method="POST"
		action="?/addDocument"
		class="modal-form"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === "success") showAddDocument = false;
				await update();
			}}
	>
		<div class="form-group">
			<label for="new-form-type">Form type</label>
			<input id="new-form-type" name="formType" list="form-types" bind:value={newFormType} required placeholder="1099-INT" />
			<datalist id="form-types">
				{#each formTypes as t (t)}
					<option value={t}>{data.formPresets[t].name}</option>
				{/each}
			</datalist>
		</div>
		<div class="form-group">
			<label for="new-issuer">Issuer</label>
			<input id="new-issuer" name="issuer" bind:value={newIssuer} required placeholder="Bank, broker, or employer" />
		</div>
		<div class="form-group">
			<label for="new-account">Account (optional)</label>
			<select id="new-account" name="accountId" bind:value={newAccountId}>
				<option value="">—</option>
				{#each data.accounts as a (a.id)}
					<option value={a.id}>{a.path}</option>
				{/each}
			</select>
		</div>
		<div class="form-group">
			<label for="new-status">Status</label>
			<select id="new-status" name="status" bind:value={newStatus}>
				<option value="RECEIVED">Received</option>
				<option value="NOT_APPLICABLE">Not applicable</option>
			</select>
		</div>
		<div class="form-group">
			<label for="new-notes">Notes</label>
			<input id="new-notes" name="notes" placeholder="Distribution code, account number, etc." />
		</div>
		<div class="form-actions">
			<Button variant="secondary" onclick={() => (showAddDocument = false)}>Cancel</Button>
			<Button variant="primary" type="submit">Add</Button>
		</div>
	</form>
</Modal>

<style>
	.tax-prep-page {
		max-width: 900px;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.page-header h1 {
		margin: 0;
		font-size: 24px;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.report-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-primary);
		text-decoration: none;
	}

	.year-select {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 16px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}

	.error-banner {
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
		background: var(--color-danger-light);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
	}

	.section {
		margin-bottom: var(--spacing-xl);
		padding: var(--spacing-lg);
		background: var(--color-bg);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-lg);
	}

	.section h2 {
		margin: 0 0 var(--spacing-sm);
		font-size: 18px;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
	}

	.muted {
		color: var(--color-text-muted);
		font-size: 14px;
		margin: 0 0 var(--spacing-md);
	}

	.hint {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.tag {
		display: inline-block;
		margin-top: 4px;
		padding: 1px 6px;
		font-size: 11px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
	}

	.questions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.question {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--spacing-xs) var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		border-left: 3px solid var(--color-warning);
	}

	.question.answered {
		border-left-color: var(--color-success);
	}

	.question-text label {
		font-size: 14px;
	}

	.question-input {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.question-input input,
	.question-input select {
		width: 220px;
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 14px;
	}

	.current {
		grid-column: 1 / -1;
		font-size: 12px;
		color: var(--color-success);
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}

	.table th {
		text-align: left;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 2px solid var(--color-border);
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.table td {
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border-light);
	}

	.table .amount,
	.table th.amount {
		text-align: right;
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.table .actions {
		display: flex;
		gap: var(--spacing-xs);
		justify-content: flex-end;
		align-items: center;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.status {
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		font-size: 12px;
	}

	.status-received {
		background: var(--color-success-light);
		color: var(--color-success);
	}

	.status-missing {
		background: var(--color-warning-light);
		color: var(--color-text);
	}

	.status-not_applicable {
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
	}

	.document {
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
	}

	.document.na {
		opacity: 0.7;
	}

	.document-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-md);
	}

	.document-header .form-type {
		display: inline-block;
		margin-right: var(--spacing-sm);
		padding: 2px 6px;
		background: var(--color-bg-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.document-actions {
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.lines {
		margin-top: var(--spacing-sm);
	}

	.total-row {
		background: var(--color-bg-alt);
	}

	.line-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-md);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-group.grow {
		flex: 1;
		min-width: 160px;
	}

	.form-group label {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.form-group input,
	.form-group select {
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 14px;
	}

	.form-actions {
		display: flex;
		gap: var(--spacing-sm);
		justify-content: flex-end;
	}

	.modal-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		min-width: 360px;
	}

	@media (max-width: 700px) {
		.question {
			grid-template-columns: 1fr;
		}
	}
</style>
