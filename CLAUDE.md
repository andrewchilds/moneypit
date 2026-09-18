# Moneypit

A double-entry bookkeeping web app for personal finance and self-employment tax tracking.

## Agent Modes

This file is used in two contexts. The prompt will tell you which mode you're in.

### Coding Agent (terminal)

You're helping develop Moneypit itself. Focus on:

- Code changes, bug fixes, new features
- Schema modifications
- Component development
- Use standard development workflow (edit files, run checks, etc.)

### UI-Embedded Agent (sidebar)

You're helping the user manage their finances through the embedded Claude panel. Focus on:

- Categorizing transactions via `bin/mp` commands
- Creating/updating rules
- Auditing accounts for miscategorization
- Answering questions about their financial data

**Important**: In UI-embedded mode, you should ONLY use the `bin/mp` CLI for database operations. Do not modify code files or run development commands.

## Tech Stack

- **Frontend**: SvelteKit, Svelte 5, TypeScript
- **Database**: PostgreSQL + Prisma
- **CLI**: `bin/mp <command>` for Claude Code integration

## Project Structure

```
moneypit/
├── bin/
│   └── mp                 # CLI executable
├── prisma/
│   └── schema.prisma      # Database schema
├── scripts/
│   └── mp.ts              # CLI implementation
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db.ts      # Prisma client singleton
│   │   │   └── actions/   # Server actions
│   │   └── components/
│   │       └── ui/        # Base UI components
│   └── routes/
└── CLAUDE.md
```

## Database Schema

### Account Types (enum)

- `ASSET` - Checking, Savings, Cash
- `LIABILITY` - Credit cards, Loans
- `EQUITY` - Opening balances, Retained earnings
- `INCOME` - Salary, Interest, Sales
- `EXPENSE` - All spending categories

### Models

- **Account**: type (enum) + path (e.g., "Business:Hosting")
- **Transaction**: Double-entry with debitAccountId + creditAccountId
- **TaxCategory**: IRS schedule references for tax reporting
- **Rule**: Pattern matching for auto-categorization

### Key Conventions

- Account paths use colons for hierarchy: "Business:Hosting", "Utilities:NJ:Gas"
- Type is a separate enum, not part of the path
- Pending transactions have one side null until categorized
- Amounts are always positive; direction determined by debit/credit accounts

## Books

A "Book" is an independent set of financial records. Use books to separate:

- Personal vs. Business finances
- Different family members
- Demo/test data

Each book has its own accounts, transactions, rules, and tax categories.
Data in one book is completely isolated from other books.

### Book Resolution

When running CLI commands, the book is resolved in this order:

1. `--book <id>` flag (explicit)
2. `~/.moneypit` config file (`defaultBookId`)
3. Auto-select if exactly one non-demo book exists
4. Error with list of available books

### Config File

Settings are stored in `~/.moneypit`:

```json
{
	"defaultBookId": "clx1234..."
}
```

## CLI Reference

Use `bin/mp` for database operations.

```
GLOBAL OPTIONS
  --book <id>           Use specific book (overrides default)

BOOKS
  book:list             List all books
  book:get <id>         Show book details
  book:create <name>    Create a new book [--description <desc>] [--demo]
  book:update <id>      Update book [--name <name>] [--description <desc>]
  book:delete <id>      Delete book and all its data
  book:switch <id>      Set default book (saves to ~/.moneypit)
  book:current          Show current default book
  book:export <file>    Export book to JSON file
  book:import <file>    Import book from JSON file [--name <name>]

CONFIG
  config:show           Show current configuration
  config:path           Show config file location
  config:set <k> <v>    Set a config value

DEMO
  demo:create           Create Demo book with sample data
  demo:reset            Delete and recreate Demo book

ACCOUNTS
  account:list [--type <type>] [--prefix <path>] [--condensed]
  account:get <id>
  account:create --type <type> --path <path> [--tax-category <id>] [--last4 <digits>] [--asset-type <type>] [--business <id|name> [--percent <n>]]
  account:update <id> [--path <path>] [--tax-category <id>] [--opening-balance <amount>] [--last4 <digits>] [--asset-type <type>] [--business <id|name|null> [--percent <n>]]
  account:delete <id>
  account:tree [--type <type>]

TRANSACTIONS
  tx:list [--account <id>] [--status <status>] [--from <date>] [--to <date>] [--search <text>] [--limit <n>]
  tx:get <id>
  tx:create --date <date> --description <desc> --amount <amount> [--debit <id>] [--credit <id>] [--memo <text>]
  tx:update <id> [--date <date>] [--description <desc>] [--amount <amount>] [--debit <id>] [--credit <id>]
  tx:delete <id>
  tx:categorize <ids...> --debit <account-id> OR --credit <account-id>
  tx:uncategorized [--account <id>] [--limit <n>] [--condensed]
  tx:delete-imported [<source>]    Delete all imported transactions (or only from specific source)
  tx:merge <id1> <id2>             Merge duplicate transfer transactions into one
  tx:unmerge <merged-id>           Restore a previously merged transaction
  tx:flip <ids...>                 Swap debit and credit accounts on transactions

TAX CATEGORIES
  tax:list [--year <year>]
  tax:get <id>
  tax:create <name> [--schedule <ref>] [--year <year>] [--description <desc>]
  tax:update <id> [--name <name>] [--schedule <ref>] [--year <year>]
  tax:delete <id>

TAX MODULES
  module:list             List all available tax modules
  module:enabled          List enabled modules for current book
  module:enable <id>      Enable a module (seeds its categories; on an enabled module, seeds the ones the book is missing)
  module:disable <id>     Disable a module (deletes unused categories)

BUSINESSES (one Schedule C each; answers and documents belong to one, accounts are attached at a percentage)
  business:list [--condensed]
  business:get <id|name>                With its accounts and the percentage of each
  business:create <name>                First business adopts existing Schedule C accounts and answers
  business:update <id|name> --name <name>
  business:delete <id|name>             Detaches its accounts, unassigns its documents; deletes its answers
  business:assign <id|name> <account-ids...> [--percent <n>]   Attach at a percentage (default 100), or change it
  business:unassign <id|name> <account-ids...>

TAX YEAR (questions, documents, and figures that don't map to transactions)
  tax:status [--year <year>] [--json]   Open questions, expected documents, documents on hand
  tax:report [--year <year>]            Tax report data as JSON (book totals with document overlay)
  worksheet:list [--year <year>] [--business <id|name>]   Module worksheets (home office) with their math
  return:show [--year <year>] [--json]  Draft federal return: every form and line with the math behind it
  return:pdf <file> [--year <year>]     Write the draft return as filled IRS forms (one PDF)
  fact:list [--year <year>]             Questions from enabled modules with their answers
  fact:set <key> <value> [--year <year>] [--carry-forward] [--business <id|name>]
  fact:get <key> [--year <year>] [--business <id|name>]
  fact:delete <key> [--year <year>] [--carry-forward] [--business <id|name>]

TAX DOCUMENTS (W-2, 1099s, 1098, 1095-A, ...)
  doc:list [--year <year>] [--condensed]
  doc:get <id>
  doc:add --form <type> --issuer <name> [--year <year>] [--account <id>] [--business <id|name>] [--notes <text>] [--na]
  doc:update <id> [--issuer <name>] [--form <type>] [--account <id>] [--business <id|name>] [--notes <text>] [--status received|na]
  doc:delete <id>
  doc:line <doc-id> --box <box> --amount <amount> [--label <text>] [--category <id|name>] [--no-category]
  doc:line-delete <line-id>
  doc:attach <doc-id> <file>            Attach the form itself (PDF, PNG, JPEG, WebP)
  doc:attach <doc-id> --from <doc-id>   Share the file attached to another document (a consolidated 1099)
  doc:detach <doc-id>                   Take the file off the document (kept while another document uses it)
  doc:forms                             Known form types and their boxes

RULES
  rule:list
  rule:get <id>
  rule:create <pattern> --account <id> [--regex] [--field <field>] [--priority <n>] [--amount-min <n>] [--amount-max <n>] [--amount-exact <n>]
  rule:update <id> [--pattern <pattern>] [--account <id>] [--regex] [--field <field>]
  rule:delete <id>
  rule:test <pattern> [--field <field>] [--regex] [--include-categorized]
  rule:apply [--account <id>]          Apply all saved rules to pending transactions

IMPORT
  import:ofx <file> --account <id>
  import:csv <file> --account <id> --mapping '<json>'
  import:preview <file> [--limit <n>]

BALANCE RECORDS (for ASSET/LIABILITY accounts)
  balance:list <account-id>
  balance:add --account <id> --date <date> --balance <amount> [--note <text>]
  balance:delete <id>
  balance:check <account-id> [--date <date>]    Show calculated balance as of date

OPERATION LOG
  log:list [--limit <n>]    Show recent operations (default: 20)
  log:get <id>              Show operation details
  log:undo <id>             Undo an operation

ACCOUNT TYPES: asset, liability, equity, income, expense
ASSET TYPES: liquid, brokerage, roth_retirement, tax_deferred
TRANSACTION STATUS: pending, categorized
```

## Tax Prep

Transactions only cover money that moved through a tracked account. Two other
kinds of records complete a tax year, both per book and per year, and both
visible at `/tax/<year>` and via `bin/mp tax:status`:

- **Tax facts** answer the questions each enabled tax module declares
  (`questions` in `src/lib/server/taxModules/modules/*.ts`): filing status,
  whether an extension was filed, Roth basis, property use. Set them with
  `fact:set <key> <value>`. Questions marked `carryForward` are stored without
  a year and apply until changed. A question can `dependsOn` another answer.
- **Tax documents** are the forms received (W-2, 1099-INT, 1099-B, 1098,
  1095-A, ...). Each has lines keyed by box number. A line mapped to a tax
  category is the authoritative figure for that category: the tax report
  shows it beside the book total with the variance, and uses it in totals.
  Categories with document figures but no accounts (1099-B capital gains) still
  appear. Lines on `NOT_APPLICABLE` documents are ignored.
  How much of the book total a document replaces depends on its account
  (`--account` on `doc:add`): a document tied to an account replaces only the
  book total of transactions whose other side is that account (dividends that
  landed in that brokerage account), or the account itself when the document
  points at the income/expense account (a 1098 on `Mortgage:Interest`); book
  totals from other accounts stay, so a 1099-DIV from one broker leaves the
  dividends recorded from another in place. A document with no account
  replaces the whole category. On expense categories, a document whose
  account has no transactions in the category also replaces the category (a
  1098's real estate taxes box). A received document with no account is
  flagged as untied (`untied` in `tax:status`, a yellow "no account" chip
  on the Documents tab whose tooltip (`Tooltip` in
  `src/lib/components/ui`, a styled popup on hover or focus taking `text`
  or a `content` snippet) carries the warning, a banner on the viewer whose
  link focuses the account picker in its form pane):
  the warning names
  each category its boxes land on and the book activity there by
  counterparty account, since the whole of it is replaced. Forms whose
  category has no book transactions (a 1099-R, a K-1) lose nothing
  untied; a 1099-INT, 1099-DIV or 1099-B should be tied to its account.
  A document can be tied to one account, so an institution's single
  1099-INT covering several accounts is either untied (right only while
  every other source of the category has a document of its own) or tied
  to the largest with a variance. The report's "Reported" column is the book
  total less what documents replaced plus the document figures; expanding the
  category shows the replaced amount as its own row when it is partial.
  On `/tax/<year>` and in `tax:status`, each received document tied to an
  account gets a reconciliation line per tax category its mapped boxes land
  on (boxes sharing a category are summed, as the report sums them: a
  1099-INT's box 1 and box 3 make one Interest Income line): the book figure
  for that account and category, the document figure, the difference, and a
  status of matched (within $0.01), variance, or no transactions.
  The form itself (PDF or image) can be attached to a document
  (`doc:attach`, or the drop area when adding one on `/tax/<year>`). It is
  stored in the database (`TaxDocumentFile`, a book-level record), so
  backups and book exports carry it. One file can hold several forms: a
  broker's consolidated 1099 is uploaded once and a 1099-DIV, a 1099-INT
  and a 1099-B each point at it (`doc:attach <id> --from <other-id>`, the
  "file already on hand" picker when adding a document, or "Add another
  form from this file" on the viewer, which creates a document with the
  same issuer, account and business). Each document's lines keep their
  own page regions into the shared file. Detaching or deleting a document
  leaves the file with the others; it is deleted with the last one. The
  Documents section of `/tax/<year>` lists each file as the outer entry
  with its forms inside ("Add form" opens the add-document modal with that
  file, issuer, account and business filled in); a form with no file is an
  entry of its own.
  Opening a document at `/tax/documents/<id>` shows the file beside the form's boxes
  (the form pane carries the account picker, since the account belongs to the
  form and not the file; the header lists the other forms read from the same
  file with the account each is tied to):
  clicking a figure on the page (or dragging a box around one) fills the
  selected box and remembers where on the page it came from, so each line can be
  traced back to the form. When the selected box is empty or zero the figure is
  saved straight in and the selection moves to the next empty box; otherwise (a
  box with a value, or none selected) a popover asks which box and amount to
  save. Boxes can also be typed in there without a file.
- **Expected documents** are inferred from the year's transactions (interest
  received implies a 1099-INT, brokerage withdrawals a 1099-B, retirement
  distributions a 1099-R, mortgage interest a 1098) and from answers
  (`expectedDocuments` in a module). Satisfy one by adding a document of that
  form type from the same institution, or mark it not applicable with `--na`.

### Businesses

A book can hold more than one sole proprietorship, each filing its own
Schedule C. A **Business** is a named record the following attach to:

- **Accounts**, each at a percentage the business claims (`BusinessAccount`
  rows: `business:assign <b> <ids> --percent <n>`, `business:unassign`,
  `--business`/`--percent` on `account:create`/`account:update` where
  `--business null` detaches from all, a percentage box per business on the
  account form, and the business card on `/tax/<year>`). 100% is the
  business's own account; less is a personal account used partly for it
  (a phone at 40%); an account can be attached to several businesses. The
  tax report shows one Schedule C section per business: an account whose
  category is on Schedule C lands on that category in each attached
  business's section at its percentage of the year total (the account row
  carries `share` and shows "40% of $X"), and the rest of the account is
  personal. An account whose category is not on Schedule C goes through the
  shared expenses worksheet instead (below). Accounts with a Schedule C
  category attached to no business land in a flagged "no business assigned"
  section.
- **Tax facts** for modules marked `perBusiness` (`us-schedule-c`). Those
  questions are asked once per business on `/tax/<year>`, and `fact:set`
  needs `--business` for them once the book has any business.
- **Tax documents** such as a 1099-NEC or 1099-K (`--business` on `doc:add`).
  Their lines overlay only that business's section, and an expected document
  raised by a per-business answer is satisfied only by a document filed under
  the same business.

A book with no businesses behaves as if it had exactly one. Creating the
first business adopts the existing Schedule C accounts and answers, so
nothing changes until a second business is added and accounts are moved.

### Worksheets

A module can declare `worksheets` (`TaxWorksheet` in
`src/lib/server/taxModules/types.ts`): a computation over facts and book
figures that produces figures keyed by tax category name, with a breakdown
of the math for display. Worksheets on a `perBusiness` module run once per
business. The tax report adds each output to its category in the right
section (creating the category row if the books have nothing there), tags it
"Computed", and expanding the row shows the breakdown; `reportedTotal` for
the section includes it, and `tax:report` JSON carries the outputs under
`worksheets`. `bin/mp worksheet:list [--year] [--business]` prints them.

`us-schedule-c` has the home office worksheet (Schedule C Line 30). Inputs
are the per-business answers `home_office`, `home_office_sqft`,
`home_total_sqft`, and `home_office_accounts`, a question of type `accounts`
listing the whole-home expense accounts (rent, utilities, insurance) to
allocate; the prep page renders it as a multi-select of EXPENSE accounts and
`fact:set home_office_accounts <id,id,...> --business <b>` takes ids. The
accounts' year totals (the same figures as on the report) are summed and
multiplied by office ÷ total square footage as a percentage rounded to two
decimals, the figure Form 8829 line 7 prints (each allocation row also shows
its own share, and carries the account's whole total as `base`). The sum is
limited to the business's reported income less its other Schedule C
expenses (Form 8829's gross income limit); the remainder is shown as a
carryover. Depreciation is not computed. The draft return refigures the
same math as a Form 8829 per business (below).

The same module has the shared expenses worksheet (Schedule C Line 25):
personal expense accounts attached to the business (phone, internet) whose
own tax category is not on Schedule C, so nothing else puts them on the
section. It has no facts; the report passes it `shares` in `WorksheetInput`
(those attachments as fractions), and each account's year total times its
fraction lands on the Utilities category, with no income limit. It runs
before the home office worksheet so its figure counts among the "other
expenses" in that worksheet's gross income limit. Every attachment is a
claim on its account, and the home office worksheet's allocation rows carry
the account and the fraction claimed (the shared expenses rows do not, since
the attachment already is the claim); `checkAccountClaims` in
`src/lib/server/actions/reports.ts` produces the report's
`worksheetWarnings` (shown on `/reports/tax`, `worksheet:list`, and the
return's warnings): an account claimed by two different kinds of claim (a
business and a worksheet, or two worksheets) is counted twice, and shares
of one account that add up to more than 100% across businesses are flagged.

### Draft return

`src/lib/server/taxReturn/compute.ts` turns the report's figures into a
draft Form 1040 with its schedules: Schedule C per business (with Part V
listing the categories behind line 27b and cost of goods sold on line 4),
Form 8829 per business with a home office (below), Schedule SE per owner, Form 8995 (simplified QBI, with the loss carryforward
on line 16), Schedules 1, 2, 3, A and B, Form 8949 with Schedule D and
Form 6781 (below), Form 8606 Part III (below), Schedule 8812 (child tax credit
and the refundable additional child tax credit) and Schedule EIC with the
earned income credit (figured the way the EIC table is, at the midpoint of
each $50 range), through withholding, estimated payments and the refund or
amount owed. The self-employed health insurance deduction is limited to the
net profit of the business the plan is assumed to be established under (the
one with the largest net earnings) less its share of the SE tax deduction
and SEP; the excess goes to Schedule A medical. Dependents come from the
`dependents` count plus the per-dependent questions (`dependent_<n>_first_name`,
`_last_name`, `_ssn`, `_relationship`, `_birth_year`, `_months_lived`,
`_status`; asked while `dependents` is at least n) which fill the Form 1040
dependents table and decide who is a qualifying child for the EIC; without
them the EIC assumes the `qualifying_children` count and Schedule EIC is not
produced. A 1099-R box 2a mapped to the "Form 1040 Line 4b" category reaches
line 4b through the report. A 1099-R tied to a `ROTH_RETIREMENT` account is
a Roth IRA distribution: its box 1 goes on Form 8606 Part III line 19
against the carry-forward `roth_basis` answer on line 22 (box 2a is not
used and should be left off), line 25c is what reaches line 4b, the
distribution is assumed nonqualified (code J or T) with a warning, and a
line 23 above zero warns that Form 5329 is not produced. Distributions
outside Roth IRAs use box 2a as before, with a warning that Part I is not
produced when box 2a is under box 1.

The computation is a pure function of a `ReturnInput` assembled by `getTaxReturn` in
`src/lib/server/actions/taxReturn.ts`: category totals come from the tax
report by schedule line (a category's `reportedTotal` is what lands on its
line), wages and withholding from W-2 and 1099 document boxes, 1099-R and
1099-G boxes that have no category go straight to their lines, and answers
(filing status, dependents, `qualifying_children`, `age_65_or_blind`,
estimated and extension payments, the name and address questions, per
business `business_owner`, `accounting_method` and `sep_contribution`) fill
the rest. Meals on Schedule C line 24b are halved; a category on
"Schedule C Line 27" lands on 27b. Every line carries a `detail` with its
math, and `warnings` list what the computation could not do (AMT, credits
other than the child tax credit and EIC, Schedule 1-A deductions, the
charitable carryover, Form 8995-A above the QBI threshold, a state refund on
a 1099-G).

Form 8829 is produced for each business whose home office worksheet ran
(`homeOffice` on `BusinessInput`: the square footages, each allocated
account's whole year total from the worksheet's allocation rows, last
year's carryover answer, and the worksheet's own deduction). Line 8 is
Schedule C line 29; every allocated account is an indirect expense in
column (b), sorted onto lines 18 to 22 by the account name (insurance,
rent or lease, repairs, utilities and the like, else other expenses; a
mortgage interest or real estate tax account lands on line 22 with a
warning, since lines 10 and 11 and the Schedule A split are not done);
line 24 is line 23 times the percentage on line 7; line 25 is last year's
carryover; line 27 is the smaller of line 15 and line 26; line 36 is what
Schedule C line 30 uses, and line 43 is next year's carryover (the
`home_office_carryover` entry in `carryovers`). Casualty losses and
depreciation (Part III) are not figured, with a warning. When line 36
differs from the worksheet's figure (the worksheet's income limit is taken
before meals are halved), Schedule C line 30 uses the form's figure with
a warning. The 2025 f8829 field map marks lines 3 and 7 as `percent`
(text lines whose % sign is pre-printed). The forms go last in the PDF,
per the attachment sequence.

A 1099-B is entered per Form 8949 box (A and B short-term, D and E
long-term; A and D are sales whose basis the broker reported to the IRS).
The box letter alone (`doc:line <id> --box A --amount <n>`) is the net gain
or loss, the line mapped to the Schedule D category and what the tax report
counts; `<box>.proceeds`, `<box>.basis` and `<box>.adj.<code>` are the
columns Form 8949 prints, an adjustment carrying its column (f) code in
the box name (`A.adj.W` is the wash sale loss disallowed, 1099-B box 1g;
any other code works the same way). A box with proceeds or basis entered
becomes one summary row on Form 8949 (`<issuer> - various`, dates
"Various"), one page per box with 11 rows, short-term and long-term pages
paired into as few forms as possible, and the page totals land on Schedule
D lines 1b, 2, 3, 8b, 9 or 10 with their proceeds, basis and adjustment
columns. Column (h) is figured from the columns; a net figure entered on
the 1099-B that disagrees is a warning. Net figures with nothing behind
them (book transactions, or a 1099-B entered as a net figure only) stay on
lines 1a and 8a with a warning. `src/lib/server/taxReturn/form8949.ts`
holds the parsing. On a Box B or E sale whose basis on the 1099-B is wrong,
enter the correct basis (the IRS has none to correct); a wrong basis on
Box A or D is a `.adj.B` adjustment against the basis as reported.

A Schedule K-1 (Form 1065) is entered by box (`doc:forms` lists them): 5,
6a and 6b map to the Schedule B categories and reach Schedule B with the
partnership as payer; 8 and 9a map to "Partnership Capital Gains - Short
Term" and "- Long Term" (Schedule D lines 5 and 12); 1 to 3 map to
"Partnership Income" (Schedule E line 28), which the return carries to
Schedule 1 line 5 with a warning that Schedule E page 2 is not produced and
the publicly traded partnership passive loss rules are not applied; 11C
maps to "Section 1256 Contracts" (Form 6781 line 1). Those four categories
are in `us-personal-base`. Form 6781 Part I lists one line 1 row per payer
of that category (`section1256` in `ReturnInput`, built like the Schedule B
payers), combines them and splits line 7 40% short-term to Schedule D line
4 and 60% long-term to line 11; the box D carryback election is not taken.
13AE (portfolio deductions) is not deductible federally and 20A and 20B are
Form 4952 figures, so they have no category and the return notes 13AE. A
K-1 basis adjustment on a sale does not go on the K-1: it goes into the
1099-B's basis (Box B or E) or a `.adj.B` line (Box A or D), as above.

Carryovers from last year's return are year-keyed answers, entered as
positive amounts: `capital_loss_carryover_short` and `_long` (Schedule D
lines 6 and 14), `qbi_loss_carryforward` (Form 8995 line 3) and
`nol_carryforward` (Schedule 1 line 8a, deducted in full with a warning that
the 80% limit is not applied) on `us-personal-base`, and per business
`home_office_carryover` on `us-schedule-c` (last year's Form 8829 line 43,
which the home office worksheet adds to the allowable expenses under the
same gross income limit). The computation runs the Capital Loss Carryover
Worksheet and lists next year's figures in `carryovers` (capital loss
short and long, qualified business loss, home office per business, and the
Roth basis left after a Form 8606; a carryover that came in and was used
up is listed at zero): `return:show`
prints them as a "Carryovers to <year+1>" block with the `fact:set` line
that records each, and `/reports/tax/return` shows the same table with a
"Record for <year+1>" button per row (a `record` form action that sets the
answer; the row reads "Recorded" once next year's answer matches). A
carryover whose question is carry-forward (`roth_basis`) is flagged
`carryForward`: recording it would change this return too, so the CLI
prints the `fact:set` line without a year to run once the return is filed,
the page shows that note instead of the button, and the action refuses it. A year
without a constants table says so and names what to add. The
PDF field maps mark lines whose parentheses are pre-printed on the form
(`parenthesized`) so a loss prints without a second pair.

Year-specific figures live in `src/lib/server/taxReturn/constants.ts`, one
table per year (2024 and 2025 so far), including the EIC and additional
child tax credit parameters; a year without a table gets no return. A
question's `dependsOn` can name a value to equal or a `min` for a number. `/reports/tax/return?year=YYYY` shows the forms line by line and
`bin/mp return:show` prints them. `src/lib/server/taxReturn/pdf.ts` fills
the IRS fillable PDFs in `forms/irs/<year>/` (from
irs.gov/pub/irs-prior) with pdf-lib, flattens each and concatenates them in
attachment order; the page's download link, `/reports/tax/return/pdf?year=`
and `bin/mp return:pdf <file>` produce it. Adding a year means a constants
table, the blank forms, and a field map in `pdf.ts` (dump field names with
pdf-lib and match them to lines on the rendered page). The app does not
e-file: IRS e-filing goes through Modernized e-File and needs an authorized
provider, so the PDF is for paper filing or for entering into software or
handing to a preparer.

On the tax report (`/reports/tax?year=YYYY`) every figure can be traced:
a category expands to its accounts and document lines, an account expands to
the transactions counted for the year (fetched from
`/api/tax-report/transactions?account=<id>&year=YYYY`, signed as they
affected the total, so the rows sum to the figure), and a document line links
to `/tax/documents/<id>?line=<lineId>`, which opens the viewer on that box with
its region highlighted. An account whose transactions include a retirement
counterparty shows the excluded amount on its row.

`--year` defaults to the most recently completed calendar year. Boxes listed by
`doc:forms` get a label and a guessed category automatically; pass
`--category <id|name>` to override or `--no-category` to leave a line unmapped.
Income earned inside ROTH_RETIREMENT and TAX_DEFERRED asset accounts is excluded
from the tax report, and refunds credited to expense accounts reduce the total.

## Development

```bash
npm run dev      # Start dev server (http://localhost:5180)
npm run check    # TypeScript + Svelte checks
npm run lint     # ESLint
npx prisma studio  # Database GUI
```

### Driving the App in a Browser

Unit and e2e tests cover the CLI, not the web UI. To look at actual pages (verify a UI change, read a report), drive the running dev server with `scripts/driver.py` and look at the screenshot or table output. It needs a Python environment with Playwright installed (`pip install playwright && playwright install chromium`):

```bash
python scripts/driver.py            # dashboard screenshot
python scripts/driver.py steps.txt  # run a step file
```

A step file is one command per line, e.g.:

```
goto /reports/tax?year=2025
fullshot tax-2025
table table
goto /reports/expenses?range=custom&year=2025
fullshot expenses-2025
```

Commands: `goto`, `click`, `fill`, `select`, `key`, `wait`, `shot`, `fullshot`, `text`, `table`, `box`, `eval`. See the module docstring for details. Screenshots go to `screenshots/` (gitignored). `table` prints every matching table as tab-separated text, which is the reliable way to read numbers off a report. Pass `--book <id>` to target a specific book; the dev server uses the real database, so use the Demo book for anything that mutates.

### Database Changes

Use `db push` instead of migrations for schema changes:

```bash
npm run db:push       # Apply schema.prisma changes to database
npm run db:generate   # Regenerate Prisma client after schema changes
```

## Style

- Run `npm run check` and `npm run lint` frequently during code changes and fix issues as you go
- Use tabs for indentation, not spaces
- Use `import` instead of `require`
- Use `bin/mp` CLI commands for database operations (creating accounts, transactions, etc.) instead of raw SQL or Prisma commands
- For date-only form inputs (YYYY-MM-DD), use `parseLocalDate()` from `$lib/utils/date` instead of `new Date()`. The latter parses as UTC midnight, which displays as the previous day in US timezones.
- Prefer using `gap` on a parent flex/grid container instead of setting margin/padding on child elements for spacing between siblings.
