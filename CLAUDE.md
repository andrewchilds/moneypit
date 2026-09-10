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
  account:create --type <type> --path <path> [--tax-category <id>] [--last4 <digits>] [--asset-type <type>] [--business <id|name>]
  account:update <id> [--path <path>] [--tax-category <id>] [--opening-balance <amount>] [--last4 <digits>] [--asset-type <type>] [--business <id|name>]
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
  module:enable <id>      Enable a module (seeds its categories)
  module:disable <id>     Disable a module (deletes unused categories)

BUSINESSES (one Schedule C each; accounts, answers, and documents belong to one)
  business:list [--condensed]
  business:get <id|name>
  business:create <name>                First business adopts existing Schedule C accounts and answers
  business:update <id|name> --name <name>
  business:delete <id|name>             Unassigns its accounts and documents; deletes its answers
  business:assign <id|name> <account-ids...>

TAX YEAR (questions, documents, and figures that don't map to transactions)
  tax:status [--year <year>] [--json]   Open questions, expected documents, documents on hand
  tax:report [--year <year>]            Tax report data as JSON (book totals with document overlay)
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
  doc:detach <doc-id>                   Remove the attached file
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
  The form itself (PDF or image) can be attached to a document
  (`doc:attach`, or the drop area when adding one on `/tax/<year>`). It is
  stored in the database, so backups and book exports carry it. Opening a
  document at `/tax/documents/<id>` shows the file beside the form's boxes:
  clicking a figure on the page (or dragging a box around one) fills the
  armed box and remembers where on the page it came from, so each line can be
  traced back to the form. Boxes can also be typed in there without a file.
- **Expected documents** are inferred from the year's transactions (interest
  received implies a 1099-INT, brokerage withdrawals a 1099-B, retirement
  distributions a 1099-R, mortgage interest a 1098) and from answers
  (`expectedDocuments` in a module). Satisfy one by adding a document of that
  form type from the same institution, or mark it not applicable with `--na`.

### Businesses

A book can hold more than one sole proprietorship, each filing its own
Schedule C. A **Business** is a named record the following attach to:

- **Accounts** (`--business` on `account:create`/`account:update`, or
  `business:assign`). The tax report shows one Schedule C section per
  business, built from that business's accounts. Accounts with a Schedule C
  category but no business land in a flagged "no business assigned" section.
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
