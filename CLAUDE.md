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
  account:create --type <type> --path <path> [--tax-category <id>] [--last4 <digits>]
  account:update <id> [--path <path>] [--tax-category <id>] [--opening-balance <amount>] [--last4 <digits>]
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
TRANSACTION STATUS: pending, categorized
```

## Development

```bash
npm run dev      # Start dev server (http://localhost:5180)
npm run check    # TypeScript + Svelte checks
npm run lint     # ESLint
npx prisma studio  # Database GUI
```

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
