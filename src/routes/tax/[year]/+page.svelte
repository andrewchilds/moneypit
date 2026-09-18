<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { CircleHelp, FileCheck, FileWarning, Plus, Trash2, X, ChevronRight, Briefcase, FileUp, FileText, Crosshair, CircleCheck, CircleAlert, CircleDashed } from "lucide-svelte";
	import { sniffFileText } from "$lib/pdf/client";
	import { detectFormType } from "$lib/documentFigures";
	import StatCard from "$lib/components/StatCard.svelte";
	import StatsGrid from "$lib/components/StatsGrid.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import type { PageData, ActionData, SubmitFunction } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Question = PageData["status"]["modules"][number]["questions"][number];
	type Expected = PageData["status"]["expectedDocuments"][number];

	const year = $derived(data.status.year);
	const formTypes = $derived(Object.keys(data.formPresets));

	// The page is split into tabs; the active one lives in the URL (?tab=) so
	// it survives form submits and the document viewer can link back to it.
	type TabId = "businesses" | "questions" | "documents";
	interface Tab {
		id: TabId;
		label: string;
		count: number;
		countLabel: string;
	}
	const tabs = $derived.by((): Tab[] => {
		const list: Tab[] = [];
		if (data.hasPerBusinessModule) {
			list.push({ id: "businesses", label: "Businesses", count: data.status.businesses.length, countLabel: "businesses" });
		}
		list.push({ id: "questions", label: "Questions", count: data.status.openQuestions, countLabel: "open" });
		list.push({ id: "documents", label: "Documents", count: data.status.missingDocuments, countLabel: "missing" });
		return list;
	});
	const activeTab = $derived.by((): TabId => {
		const requested = page.url.searchParams.get("tab");
		return tabs.find((t) => t.id === requested)?.id ?? tabs[0].id;
	});

	// Add-document modal, optionally prefilled from an expected document
	let showAddDocument = $state(false);
	let newFormType = $state("");
	let newIssuer = $state("");
	let newAccountId = $state("");
	let newBusinessId = $state("");
	let newStatus = $state("RECEIVED");

	let newFile = $state<File | null>(null);
	let newFileInput = $state<HTMLInputElement | undefined>();
	// A file already on another document, instead of a fresh upload
	let newFileId = $state("");

	/** "Ally-1099.pdf · 1099-B, 1099-DIV" for a file picker option */
	const fileOptionLabel = (file: PageData["files"][number]) =>
		`${file.filename} · ${file.documents.map((d) => `${d.formType} ${d.issuer}`).join(", ")}`;
	type Doc = PageData["status"]["documents"][number];
	interface DocumentGroup {
		key: string;
		file: Doc["file"];
		forms: Doc[];
	}

	// Documents on hand, grouped by the file they were read from: the file is
	// the outer entry and the forms in it sit inside (a consolidated 1099
	// holds a 1099-DIV and a 1099-B); a form with no file stands on its own.
	const documentGroups = $derived.by(() => {
		const groups = new Map<string, DocumentGroup>();
		for (const doc of data.status.documents) {
			const key = doc.file ? `file:${doc.file.id}` : `form:${doc.id}`;
			const group = groups.get(key) ?? { key, file: doc.file, forms: [] };
			group.forms.push(doc);
			groups.set(key, group);
		}
		return [...groups.values()];
	});

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	/** Another form read from a file already on hand: same issuer, account and business as its first form */
	function openAddForm(group: DocumentGroup) {
		const first = group.forms[0];
		openAddDocument();
		newIssuer = first.issuer;
		newAccountId = first.account?.id ?? "";
		newBusinessId = first.business?.id ?? "";
		newFileId = group.file?.id ?? "";
	}

	function openAddDocument(expected?: Expected) {
		newFormType = expected?.formType ?? "";
		newIssuer = expected?.institution ?? "";
		newAccountId = expected?.accountIds[0] ?? "";
		newBusinessId = expected?.businessId ?? "";
		newStatus = "RECEIVED";
		newFile = null;
		newFileId = "";
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

	// Accounts attached to each business with the percentage the business
	// claims: 100% for its own accounts, less for a personal account used
	// partly for it. An account can be attached to several businesses.
	const linksOf = (businessId: string) => data.businessAccounts.filter((l) => l.businessId === businessId);
	const linkPercent = (businessId: string, accountId: string) =>
		data.businessAccounts.find((l) => l.businessId === businessId && l.accountId === accountId)?.percent ?? 100;
	// Detach confirmation: which attachment the X was clicked on
	let detaching = $state<{ businessId: string; accountId: string } | null>(null);
	const closeDetach: SubmitFunction = () =>
		async ({ result, update }) => {
			if (result.type === "success") detaching = null;
			await update();
		};
	const attachedIds = $derived(new Set(data.businessAccounts.map((l) => l.accountId)));
	// Schedule C accounts attached to no business: the report puts them in a section of their own
	const unassignedAccounts = $derived(
		businesses.length > 0 ? data.accounts.filter((a) => data.scheduleAccountIds.includes(a.id) && !attachedIds.has(a.id)) : []
	);
	const businessName = (id: string | null) => businesses.find((b) => b.id === id)?.name ?? null;
	const isScheduleAccount = (id: string) => data.scheduleAccountIds.includes(id);
	const attachableTo = (businessId: string) => {
		const attached = new Set(linksOf(businessId).map((l) => l.accountId));
		return data.accounts.filter((a) => (a.type === "INCOME" || a.type === "EXPENSE") && !attached.has(a.id));
	};
	const submitOnChange = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();
	const keepValues: SubmitFunction = () => async ({ update }) => update({ reset: false });


	function handleYearChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		goto(`/tax/${select.value}?tab=${activeTab}`);
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
	const accountType = (id: string) => data.accounts.find((a) => a.id === id)?.type;
	const answeredAccounts = (q: Question): string[] => (Array.isArray(q.answer) ? q.answer : []);

	function displayAnswer(q: Question): string {
		if (q.answer === null) return "";
		if (q.type === "boolean") return q.answer ? "Yes" : "No";
		if (q.type === "choice") return q.options?.find((o) => o.value === q.answer)?.label ?? String(q.answer);
		if (q.type === "amount") return formatCurrency(Number(q.answer));
		if (q.type === "accounts") return answeredAccounts(q).map(accountPath).join(", ");
		return String(q.answer);
	}

	// Each mapped box of a document tied to an account is compared with the books.
	// The amount shows an icon for the outcome; clicking it opens the comparison.
	type Reconciliation = PageData["status"]["reconciliations"][number];
	const reconciliationOf = (lineId: string) => data.status.reconciliations.find((r) => r.lineId === lineId);
	const reconciliationLabel = { matched: "Matched", variance: "Variance", no_transactions: "No transactions" } as const;
	const reconciliationIcon = { matched: CircleCheck, variance: CircleAlert, no_transactions: CircleDashed } as const;
	let shownReconciliation = $state<Reconciliation | null>(null);
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
		<StatCard label="Open Questions" variant={data.status.openQuestions > 0 ? "negative" : "positive"} href="?tab=questions">
			{#snippet icon()}<CircleHelp size={24} />{/snippet}
			{data.status.openQuestions}
		</StatCard>
		<StatCard label="Missing Documents" variant={data.status.missingDocuments > 0 ? "negative" : "positive"} href="?tab=documents">
			{#snippet icon()}<FileWarning size={24} />{/snippet}
			{data.status.missingDocuments}
		</StatCard>
		<StatCard label="Documents On Hand" variant="positive" href="?tab=documents">
			{#snippet icon()}<FileCheck size={24} />{/snippet}
			{data.status.documents.length}
		</StatCard>
	</StatsGrid>

	{#if form?.error}
		<div class="error-banner">{form.error}</div>
	{/if}

	<nav class="tab-bar" aria-label="Tax prep sections">
		{#each tabs as tab (tab.id)}
			<a
				href="?tab={tab.id}"
				class="tab"
				class:active={activeTab === tab.id}
				aria-current={activeTab === tab.id ? "page" : undefined}
				data-sveltekit-noscroll
				data-sveltekit-replacestate
			>
				{tab.label}
				{#if tab.count > 0}
					<span class="tab-count" class:attention={tab.id !== "businesses"} title="{tab.count} {tab.countLabel}">{tab.count}</span>
				{/if}
			</a>
		{/each}
	</nav>

	<!-- Businesses -->
	{#if activeTab === "businesses"}
		<section class="section">
			<div class="section-header">
				<h2>Businesses</h2>
			</div>
			<p class="muted">
				Each business files its own Schedule C. An account is attached to a business at the percentage the business
				claims: its own accounts at 100%, a personal account it uses partly (phone, internet) at less, and an account
				can be attached to more than one business. The Schedule C questions on the Questions tab are asked once per business.
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
					{#if linksOf(b.id).length > 0}
						<ul class="account-list share-list">
							{#each linksOf(b.id) as l (l.accountId)}
								<li>
									<a href="/accounts/{l.accountId}">{accountPath(l.accountId)}</a>
									<!-- Keep the typed percentage: the default enhance resets the form after saving -->
									<form method="POST" action="?/attachAccount" use:enhance={keepValues} class="share-form">
										<input type="hidden" name="businessId" value={b.id} />
										<input type="hidden" name="accountId" value={l.accountId} />
										<input
											type="number"
											name="percent"
											min="1"
											max="100"
											step="1"
											value={l.percent}
											aria-label="Percentage of {accountPath(l.accountId)} claimed by {b.name}"
											onchange={submitOnChange}
										/>
										<span class="share-unit">%</span>
									</form>
									{#if isScheduleAccount(l.accountId)}
										<span class="share-note"></span>
									{:else if accountType(l.accountId) === "EXPENSE"}
										<span class="share-note" title="The account's own tax category is not on Schedule C, so its share goes on line 25 (Utilities)">
											line 25
										</span>
									{:else}
										<span class="share-note" title="Only expense accounts without a Schedule C category go on line 25; give the account a Schedule C category to report it">
											not reported
										</span>
									{/if}
									<button
										type="button"
										class="icon-button"
										aria-label="Detach {accountPath(l.accountId)} from {b.name}"
										title="Detach"
										onclick={() => (detaching = { businessId: b.id, accountId: l.accountId })}
									>
										<X size={14} />
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">No accounts attached yet.</p>
					{/if}
					<form method="POST" action="?/attachAccount" use:enhance class="inline-form add-share">
						<input type="hidden" name="businessId" value={b.id} />
						<select name="accountId" required aria-label="Account to attach to {b.name}">
							<option value="">Attach an account…</option>
							{#each attachableTo(b.id) as a (a.id)}
								<option value={a.id}>{a.path}</option>
							{/each}
						</select>
						<input type="number" name="percent" min="1" max="100" step="1" value="100" required aria-label="Percentage claimed" class="share-percent" />
						<span class="share-unit">%</span>
						<Button variant="secondary" size="sm" type="submit">Attach</Button>
					</form>
				</article>
			{/each}

			{#if unassignedAccounts.length > 0}
				<div class="unassigned">
					<p class="unassigned-title">
						{unassignedAccounts.length} account{unassignedAccounts.length === 1 ? "" : "s"} with Schedule C categories
						{unassignedAccounts.length === 1 ? "is" : "are"} attached to no business. Pick one for each so the report splits correctly.
					</p>
					<ul class="account-list">
						{#each unassignedAccounts as a (a.id)}
							<li>
								<a href="/accounts/{a.id}">{a.path}</a>
								<form method="POST" action="?/attachAccount" use:enhance class="inline-form">
									<input type="hidden" name="accountId" value={a.id} />
									<input type="hidden" name="percent" value="100" />
									<select name="businessId" aria-label="Business for {a.path}" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="">Attach to…</option>
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

	<!-- Questions -->
	{#if activeTab === "questions"}
		{#if data.status.modules.length === 0}
			<section class="section">
				<p class="muted">No tax modules are enabled for this book. Enable one in Settings to get a questionnaire.</p>
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
	{/if}

	{#if activeTab === "documents"}
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
				Each document is a file on hand, and a consolidated statement holds several forms. Open a form to fill in its boxes: click each figure on the file, or type them in.
			</p>
			{#if data.status.documents.length === 0}
				<p class="muted">No documents recorded for {year}.</p>
			{/if}
			{#each documentGroups as group (group.key)}
				{#if group.file}
					<article class="document" class:na={group.forms.every((d) => d.status === "NOT_APPLICABLE")}>
						<header class="document-header file-header">
							<div class="file-title">
								<FileText size={16} />
								<strong>{group.file.filename}</strong>
								<span class="muted">· {formatSize(group.file.size)} · {group.forms.length} {group.forms.length === 1 ? "form" : "forms"}</span>
							</div>
							<div class="document-actions">
								<Button variant="ghost" size="sm" onclick={() => openAddForm(group)}><Plus size={14} /> Add form</Button>
							</div>
						</header>
						<div class="forms">
							{#each group.forms as doc (doc.id)}
								{@render formCard(doc, true)}
							{/each}
						</div>
					</article>
				{:else}
					<article class="document" class:na={group.forms[0].status === "NOT_APPLICABLE"}>
						{@render formCard(group.forms[0], false)}
					</article>
				{/if}
			{/each}
		</section>
	{/if}
</div>

{#snippet formCard(doc: Doc, nested: boolean)}
			<section class="form-card" class:nested={nested} id="doc-{doc.id}" class:na={doc.status === "NOT_APPLICABLE"}>
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
								{@const r = reconciliationOf(line.id)}
								<tr>
									<td class="mono">{line.box}</td>
									<td>
										{line.label}
										{#if line.page}
											<span class="pin" title="Read from page {line.page} of {doc.file?.filename ?? 'the file'}"><Crosshair size={11} /></span>
										{/if}
									</td>
									<td class:muted={!line.taxCategory}>{line.taxCategory?.name ?? "not mapped"}</td>
									<td class="amount">
										{#if r}
											{@const Icon = reconciliationIcon[r.status]}
											<button
												type="button"
												class="reconciled status-{r.status}"
												title="{reconciliationLabel[r.status]}: books {formatCurrency(r.bookAmount)}"
												onclick={() => (shownReconciliation = r)}
											>
												{formatCurrency(line.amount)}
												<Icon size={14} />
											</button>
										{:else}
											<span class="reconciled">{formatCurrency(line.amount)}<span class="icon-slot"></span></span>
										{/if}
									</td>
									<td class="actions">
										<form method="POST" action="?/deleteLine" use:enhance>
											<input type="hidden" name="id" value={line.id} />
											<Button variant="ghost" size="sm" type="submit"><Trash2 size={14} /></Button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
{/snippet}

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
		{#if data.files.length > 0 && !newFile}
			<div class="form-group">
				<label for="new-file-id">Or a file already on hand</label>
				<select id="new-file-id" name="fileId" bind:value={newFileId}>
					<option value="">—</option>
					{#each data.files as file (file.id)}
						<option value={file.id}>{fileOptionLabel(file)}</option>
					{/each}
				</select>
				<span class="hint">A consolidated statement can hold several forms; this one is read from the same file.</span>
			</div>
		{/if}
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

<Modal open={shownReconciliation !== null} title="Books vs. document" onclose={() => (shownReconciliation = null)}>
	{#if shownReconciliation}
		{@const r = shownReconciliation}
		{@const Icon = reconciliationIcon[r.status]}
		<div class="reconcile-detail">
			<p class="reconcile-status status-{r.status}"><Icon size={16} /> {reconciliationLabel[r.status]}</p>
			<dl class="reconcile-figures">
				<dt>Box {r.box}</dt>
				<dd>{r.label}</dd>
				<dt>Tax category</dt>
				<dd>{r.taxCategoryName}</dd>
				<dt>Account</dt>
				<dd>{r.accountPath}</dd>
				<dt>Books</dt>
				<dd class="mono">{formatCurrency(r.bookAmount)}</dd>
				<dt>Document</dt>
				<dd class="mono">{formatCurrency(r.documentAmount)}</dd>
				<dt>Difference</dt>
				<dd class="mono">{formatCurrency(r.difference)}</dd>
			</dl>
			<p class="hint">
				{#if r.status === "no_transactions"}
					No {year} transactions of {r.accountPath} are categorized as {r.taxCategoryName}. The document figure is used on its own.
				{:else if r.status === "variance"}
					The document replaces the book figure on the tax report. Compare the {year} transactions of {r.accountPath} in {r.taxCategoryName} with the form to find what is missing or miscategorized.
				{:else}
					The {year} transactions of {r.accountPath} in {r.taxCategoryName} add up to the document figure.
				{/if}
			</p>
			<a class="report-link" href="/reports/tax?year={year}">Tax Report <ChevronRight size={16} /></a>
		</div>
	{/if}
</Modal>

<!-- Detach confirmation -->
<Modal open={detaching !== null} title="Detach account" onclose={() => (detaching = null)}>
	{#if detaching}
		{@const d = detaching}
		<form method="POST" action="?/detachAccount" use:enhance={closeDetach} class="detach-confirm">
			<input type="hidden" name="businessId" value={d.businessId} />
			<input type="hidden" name="accountId" value={d.accountId} />
			<p>
				Detach <strong>{accountPath(d.accountId)}</strong> from <strong>{businessName(d.businessId)}</strong>?
			</p>
			<p class="hint">
				The account and its transactions stay; {businessName(d.businessId)} just stops claiming its {linkPercent(d.businessId, d.accountId)}% on the tax report.
			</p>
			<div class="detach-actions">
				<Button variant="secondary" size="sm" onclick={() => (detaching = null)}>Cancel</Button>
				<Button variant="danger" size="sm" type="submit">Detach</Button>
			</div>
		</form>
	{/if}
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

	.tab-bar {
		display: flex;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin-bottom: -1px;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
	}

	.tab:hover {
		color: var(--color-text);
	}

	.tab.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.tab-count {
		padding: 0 6px;
		border-radius: 999px;
		background: var(--color-bg-alt);
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 500;
	}

	/* Open questions and missing documents are work to do */
	.tab-count.attention {
		background: var(--color-warning-light);
		color: var(--color-text);
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

	/* Attached accounts: one column each for name, percentage, note and detach */
	.share-list {
		display: grid;
		grid-template-columns: 1fr max-content max-content max-content;
		align-items: center;
		column-gap: var(--spacing-md);
	}

	.share-list li {
		display: contents;
	}

	.share-note,
	.share-unit {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.icon-button:hover {
		background: var(--color-bg-alt);
		color: var(--color-danger);
	}

	.detach-confirm {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.detach-confirm p {
		margin: 0;
	}

	.detach-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
	}

	.share-form {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.share-form input,
	.add-share .share-percent {
		width: 60px;
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.add-share {
		margin-top: var(--spacing-sm);
	}

	.add-share select {
		font-size: 13px;
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

	/* An amount compared with the books: the figure plus an icon for the outcome */
	.reconciled {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		margin: -2px -6px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		font: inherit;
		color: inherit;
	}

	button.reconciled {
		cursor: pointer;
	}

	button.reconciled:hover {
		background: var(--color-bg-alt);
	}

	/* Keeps an amount with no comparison in the same column as the others */
	.icon-slot {
		width: 14px;
	}

	.reconciled.status-matched :global(svg) {
		color: var(--color-success);
	}

	.reconciled.status-variance :global(svg) {
		color: var(--color-danger);
	}

	.reconciled.status-no_transactions :global(svg) {
		color: var(--color-text-muted);
	}

	.reconcile-detail {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.reconcile-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		margin: 0;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.reconcile-figures {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--spacing-xs) var(--spacing-md);
		margin: 0;
	}

	.reconcile-figures dt {
		color: var(--color-text-muted);
	}

	.reconcile-figures dd {
		margin: 0;
	}

	.reconcile-detail .hint {
		margin: 0;
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

	.file-header {
		align-items: center;
	}

	.file-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-muted);
	}

	.file-title strong {
		color: var(--color-text);
	}

	.forms {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}

	.form-card.nested {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-alt);
		border-radius: var(--radius-md);
	}

	.form-card.na {
		opacity: 0.7;
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
