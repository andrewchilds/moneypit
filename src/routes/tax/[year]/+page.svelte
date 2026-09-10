<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { CircleHelp, FileCheck, FileWarning, Plus, Trash2, ChevronRight, Briefcase, FileUp, FileText, Crosshair } from "lucide-svelte";
	import { sniffFileText } from "$lib/pdf/client";
	import { detectFormType } from "$lib/documentFigures";
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
	let newBusinessId = $state("");
	let newStatus = $state("RECEIVED");

	let newFile = $state<File | null>(null);
	let newFileInput = $state<HTMLInputElement | undefined>();

	function openAddDocument(expected?: Expected) {
		newFormType = expected?.formType ?? "";
		newIssuer = expected?.institution ?? "";
		newAccountId = expected?.accountIds[0] ?? "";
		newBusinessId = expected?.businessId ?? "";
		newStatus = "RECEIVED";
		newFile = null;
		if (newFileInput) newFileInput.value = "";
		showAddDocument = true;
	}

	/** A dropped or chosen file can tell us which form it is. */
	async function onNewFileChange() {
		newFile = newFileInput?.files?.[0] ?? null;
		if (!newFile || newFormType) return;
		const detected = detectFormType(await sniffFileText(newFile));
		if (detected && !newFormType) newFormType = detected;
	}

	function onModalDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file || !newFileInput) return;
		const dt = new DataTransfer();
		dt.items.add(file);
		newFileInput.files = dt.files;
		void onNewFileChange();
	}

	// Attach a file to an existing document straight from its card
	function submitAttach(e: Event) {
		(e.currentTarget as HTMLInputElement).form?.requestSubmit();
	}

	// Businesses: one Schedule C each
	const businesses = $derived(data.status.businesses);
	let newBusinessName = $state("");
	let renamingBusiness = $state<string | null>(null);
	let renameValue = $state("");

	const accountsOf = (businessId: string) => data.businessAccounts.filter((a) => a.businessId === businessId);
	const unassignedAccounts = $derived(businesses.length > 0 ? data.businessAccounts.filter((a) => !a.businessId) : []);
	const businessName = (id: string | null) => businesses.find((b) => b.id === id)?.name ?? null;


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

	const expenseAccounts = $derived(data.accounts.filter((a) => a.type === "EXPENSE"));
	const accountPath = (id: string) => data.accounts.find((a) => a.id === id)?.path ?? id;
	const answeredAccounts = (q: Question): string[] => (Array.isArray(q.answer) ? q.answer : []);

	function displayAnswer(q: Question): string {
		if (q.answer === null) return "";
		if (q.type === "boolean") return q.answer ? "Yes" : "No";
		if (q.type === "choice") return q.options?.find((o) => o.value === q.answer)?.label ?? String(q.answer);
		if (q.type === "amount") return formatCurrency(Number(q.answer));
		if (q.type === "accounts") return answeredAccounts(q).map(accountPath).join(", ");
		return String(q.answer);
	}

	const documentTotal = (doc: PageData["status"]["documents"][number]) =>
		doc.lines.reduce((sum, l) => sum + l.amount, 0);

	const reconciliationsOf = (documentId: string) => data.status.reconciliations.filter((r) => r.documentId === documentId);
	const reconciliationLabel = { matched: "Matched", variance: "Variance", no_transactions: "No transactions" } as const;
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

	<!-- Businesses -->
	{#if data.hasPerBusinessModule}
		<section class="section">
			<div class="section-header">
				<h2>Businesses</h2>
			</div>
			<p class="muted">
				Each business files its own Schedule C. Accounts with Schedule C categories are assigned to one, and the
				Schedule C questions below are asked once per business.
				{#if businesses.length === 0}
					With no businesses, the book is treated as a single business.
				{/if}
			</p>
			{#each businesses as b (b.id)}
				<article class="business">
					<header class="business-header">
						{#if renamingBusiness === b.id}
							<form
								method="POST"
								action="?/renameBusiness"
								class="inline-form"
								use:enhance={() =>
									async ({ result, update }) => {
										if (result.type === "success") renamingBusiness = null;
										await update();
									}}
							>
								<input type="hidden" name="id" value={b.id} />
								<input name="name" bind:value={renameValue} required aria-label="Business name" />
								<Button variant="primary" size="sm" type="submit">Save</Button>
								<Button variant="secondary" size="sm" onclick={() => (renamingBusiness = null)}>Cancel</Button>
							</form>
						{:else}
							<div class="business-title">
								<Briefcase size={16} />
								<strong>{b.name}</strong>
							</div>
							<div class="document-actions">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										renamingBusiness = b.id;
										renameValue = b.name;
									}}>Rename</Button
								>
								<form method="POST" action="?/deleteBusiness" use:enhance>
									<input type="hidden" name="id" value={b.id} />
									<Button variant="ghost" size="sm" type="submit"><Trash2 size={14} /></Button>
								</form>
							</div>
						{/if}
					</header>
					{#if accountsOf(b.id).length > 0}
						<ul class="account-list">
							{#each accountsOf(b.id) as a (a.id)}
								<li>
									<a href="/accounts/{a.id}">{a.path}</a>
									<form method="POST" action="?/assignAccount" use:enhance>
										<input type="hidden" name="accountId" value={a.id} />
										<input type="hidden" name="businessId" value="" />
										<button type="submit" class="link-button">unassign</button>
									</form>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">No accounts assigned yet.</p>
					{/if}
				</article>
			{/each}

			{#if unassignedAccounts.length > 0}
				<div class="unassigned">
					<p class="unassigned-title">
						{unassignedAccounts.length} account{unassignedAccounts.length === 1 ? "" : "s"} with Schedule C categories
						{unassignedAccounts.length === 1 ? "has" : "have"} no business. Pick one for each so the report splits correctly.
					</p>
					<ul class="account-list">
						{#each unassignedAccounts as a (a.id)}
							<li>
								<a href="/accounts/{a.id}">{a.path}</a>
								<form method="POST" action="?/assignAccount" use:enhance class="inline-form">
									<input type="hidden" name="accountId" value={a.id} />
									<select name="businessId" aria-label="Business for {a.path}" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="">Assign to…</option>
										{#each businesses as b (b.id)}
											<option value={b.id}>{b.name}</option>
										{/each}
									</select>
								</form>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<form
				method="POST"
				action="?/addBusiness"
				class="inline-form add-business"
				use:enhance={() =>
					async ({ result, update }) => {
						if (result.type === "success") newBusinessName = "";
						await update();
					}}
			>
				<input name="name" bind:value={newBusinessName} placeholder="Business name" required />
				<Button variant="primary" size="sm" type="submit"><Plus size={16} /> Add business</Button>
			</form>
		</section>
	{/if}

	{#each data.status.modules as module (`${module.moduleId}:${module.businessId ?? ""}`)}
		{@const visible = module.questions.filter((q) => q.visible)}
		{@const scope = module.businessId ?? ""}
		{#if visible.length > 0}
			<section class="section">
				<h2>
					{module.name}
					{#if module.businessName}
						<span class="business-tag"><Briefcase size={14} /> {module.businessName}</span>
					{/if}
				</h2>
				<div class="questions">
					{#each visible as q (q.key)}
						<form method="POST" action="?/answer" use:enhance class="question" class:answered={q.answered}>
							<input type="hidden" name="key" value={q.key} />
							<input type="hidden" name="businessId" value={scope} />
							<div class="question-text">
								<label for="q-{q.key}-{scope}">{q.prompt}</label>
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
									<select id="q-{q.key}-{scope}" name="value" value={formatAnswer(q)}>
										<option value="">—</option>
										<option value="true">Yes</option>
										<option value="false">No</option>
									</select>
								{:else if q.type === "choice"}
									<select id="q-{q.key}-{scope}" name="value" value={formatAnswer(q)}>
										<option value="">—</option>
										{#each q.options ?? [] as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if q.type === "amount" || q.type === "number"}
									<input
										id="q-{q.key}-{scope}"
										type="number"
										name="value"
										step={q.type === "amount" ? "0.01" : "1"}
										value={formatAnswer(q)}
										placeholder={q.type === "amount" ? "0.00" : ""}
									/>
								{:else if q.type === "date"}
									<input id="q-{q.key}-{scope}" type="date" name="value" value={formatAnswer(q)} />
								{:else if q.type === "accounts"}
									<select id="q-{q.key}-{scope}" name="value" multiple size={Math.min(8, Math.max(4, expenseAccounts.length))} class="accounts-select">
										{#each expenseAccounts as a (a.id)}
											<option value={a.id} selected={answeredAccounts(q).includes(a.id)}>{a.path}</option>
										{/each}
									</select>
								{:else}
									<input id="q-{q.key}-{scope}" type="text" name="value" value={formatAnswer(q)} />
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
			Inferred from this year's transactions and your answers. When a form arrives, add it with its PDF and read the
			figures straight off the page. Mark one not applicable if it won't arrive.
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
							<td>{exp.institution || businessName(exp.businessId) || "—"}</td>
							<td class="muted">{exp.reason}</td>
							<td>
								<span class="status status-{exp.status}">
									{exp.status === "received" ? "Received" : exp.status === "not_applicable" ? "N/A" : "Missing"}
								</span>
							</td>
							<td class="actions">
								{#if exp.status === "missing"}
									<Button size="sm" onclick={() => openAddDocument(exp)}><FileUp size={14} /> Add</Button>
									<form method="POST" action="?/addDocument" use:enhance>
										<input type="hidden" name="formType" value={exp.formType} />
										<input type="hidden" name="issuer" value={exp.institution || exp.formType} />
										<input type="hidden" name="accountId" value={exp.accountIds[0] ?? ""} />
										<input type="hidden" name="businessId" value={exp.businessId ?? ""} />
										<input type="hidden" name="status" value="NOT_APPLICABLE" />
										<Button variant="ghost" size="sm" type="submit">Mark N/A</Button>
									</form>
								{:else if exp.documentId}
									<a href="/tax/documents/{exp.documentId}">Open</a>
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
		<p class="muted">
			Open a document to fill in its boxes: attach the form and click each figure, or type them in.
		</p>
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
						{#if doc.business}
							<span class="business-tag"><Briefcase size={12} /> {doc.business.name}</span>
						{/if}
						{#if doc.status === "NOT_APPLICABLE"}
							<span class="tag">not applicable</span>
						{/if}
						{#if doc.notes}
							<p class="hint">{doc.notes}</p>
						{/if}
						{#if doc.file}
							<p class="hint file-hint"><FileText size={12} /> {doc.file.filename}</p>
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
							{#if !doc.file}
								<form method="POST" action="?/attachFile" enctype="multipart/form-data" use:enhance>
									<input type="hidden" name="id" value={doc.id} />
									<label class="attach-label">
										<FileUp size={14} /> Attach file
										<input type="file" name="file" accept="application/pdf,image/*" onchange={submitAttach} />
									</label>
								</form>
							{/if}
							<a class="open-link" href="/tax/documents/{doc.id}">
								<Crosshair size={14} />
								{doc.file ? "Open" : doc.lines.length > 0 ? "Edit boxes" : "Fill in boxes"}
							</a>
						{/if}
						<form method="POST" action="?/deleteDocument" use:enhance>
							<input type="hidden" name="id" value={doc.id} />
							<Button variant="ghost" size="sm" type="submit"><Trash2 size={14} /></Button>
						</form>
					</div>
				</header>

				{#if reconciliationsOf(doc.id).length > 0}
					<ul class="reconciliation">
						{#each reconciliationsOf(doc.id) as r (r.lineId)}
							<li class="reconcile-line status-{r.status}">
								<span class="reconcile-what">Box {r.box} · {r.taxCategoryName} · {r.accountPath}</span>
								<span class="reconcile-figures">
									books <strong class="mono">{formatCurrency(r.bookAmount)}</strong>
									· document <strong class="mono">{formatCurrency(r.documentAmount)}</strong>
									· difference <strong class="mono">{formatCurrency(r.difference)}</strong>
								</span>
								<span class="status status-{r.status}">{reconciliationLabel[r.status]}</span>
							</li>
						{/each}
					</ul>
				{/if}

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
									<td>
										{line.label}
										{#if line.page}
											<span class="pin" title="Read from page {line.page} of {doc.file?.filename ?? 'the file'}"><Crosshair size={11} /></span>
										{/if}
									</td>
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

			</article>
		{/each}
	</section>
</div>

<Modal bind:open={showAddDocument} title="Add document" onclose={() => (showAddDocument = false)}>
	<form
		method="POST"
		action="?/addDocument"
		class="modal-form"
		enctype="multipart/form-data"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === "success") {
					showAddDocument = false;
					const { documentId, attached } = result.data as { documentId: string; attached: boolean };
					if (attached) {
						await goto(`/tax/documents/${documentId}`);
						return;
					}
				}
				await update();
			}}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="drop-area" class:has-file={!!newFile} ondragover={(e) => e.preventDefault()} ondrop={onModalDrop}>
			<label class="drop-label">
				<FileUp size={20} />
				{#if newFile}
					<strong>{newFile.name}</strong>
					<span class="hint">Click to choose a different file</span>
				{:else}
					<strong>Drop the form here</strong>
					<span class="hint">PDF or image, optional. You can read the figures straight off it.</span>
				{/if}
				<input type="file" name="file" accept="application/pdf,image/*" bind:this={newFileInput} onchange={onNewFileChange} />
			</label>
		</div>
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
		{#if businesses.length > 0}
			<div class="form-group">
				<label for="new-business">Business (optional)</label>
				<select id="new-business" name="businessId" bind:value={newBusinessId}>
					<option value="">—</option>
					{#each businesses as b (b.id)}
						<option value={b.id}>{b.name}</option>
					{/each}
				</select>
			</div>
		{/if}
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
			<Button variant="primary" type="submit">{newFile ? "Add and open" : "Add"}</Button>
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

	.section h2 .business-tag {
		vertical-align: middle;
	}

	.business-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: var(--spacing-xs);
		padding: 1px 8px;
		font-size: 12px;
		font-weight: 500;
		border-radius: var(--radius-sm);
		background: var(--color-primary-light, var(--color-bg-alt));
		color: var(--color-primary);
	}

	.business {
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
	}

	.business-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
	}

	.business-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.account-list {
		list-style: none;
		margin: var(--spacing-sm) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	.account-list li {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.account-list a {
		color: var(--color-text);
		text-decoration: none;
	}

	.account-list a:hover {
		color: var(--color-primary);
	}

	.link-button {
		background: none;
		border: none;
		padding: 0;
		font-size: 12px;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.link-button:hover {
		color: var(--color-danger);
	}

	.unassigned {
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--color-warning-light);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-md);
	}

	.unassigned-title {
		margin: 0;
		font-size: 14px;
	}

	.inline-form {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.inline-form input,
	.inline-form select {
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 14px;
	}

	.add-business {
		margin-top: var(--spacing-md);
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

	.question-input .accounts-select {
		width: 320px;
		font-size: 13px;
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

	.status-matched {
		background: var(--color-success-light);
		color: var(--color-success);
	}

	.status-variance {
		background: var(--color-danger-light);
		color: var(--color-danger);
	}

	.status-no_transactions {
		background: var(--color-warning-light);
		color: var(--color-text);
	}

	.reconciliation {
		list-style: none;
		margin: var(--spacing-sm) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}

	.reconcile-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 4px var(--spacing-sm);
		border-radius: var(--radius-sm);
		background: var(--color-bg-alt);
	}

	.reconcile-line.status-variance {
		background: var(--color-danger-light);
		color: var(--color-text);
	}

	.reconcile-line.status-no_transactions {
		background: var(--color-warning-light);
	}

	.reconcile-line.status-matched {
		background: var(--color-bg-alt);
		color: var(--color-text);
	}

	.reconcile-what {
		flex: 1;
		min-width: 200px;
	}

	.reconcile-figures {
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

	.file-hint {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.attach-label,
	.open-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: 4px 10px;
		font-size: 13px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		text-decoration: none;
		cursor: pointer;
	}

	.attach-label:hover,
	.open-link:hover {
		background: var(--color-bg-hover);
	}

	.open-link {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.attach-label input {
		display: none;
	}

	.pin {
		display: inline-flex;
		vertical-align: middle;
		margin-left: 4px;
		color: var(--color-success);
	}

	.drop-area {
		margin-bottom: var(--spacing-sm);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		text-align: center;
	}

	.drop-area.has-file {
		border-style: solid;
		border-color: var(--color-success);
		background: var(--color-success-light);
	}

	.drop-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--spacing-md);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.drop-label strong {
		color: var(--color-text);
		font-size: 14px;
	}

	.drop-label input {
		display: none;
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
