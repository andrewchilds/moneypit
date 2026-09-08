export const CLI_HELP = `
Moneypit CLI

Usage: bin/mp <command> [options]

GLOBAL OPTIONS
  --book <id>           Use specific book (overrides default)

                        Book resolution order:
                        1. --book flag
                        2. ~/.moneypit defaultBookId
                        3. Auto-select if only one non-demo book
                        4. Error with list of available books

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

  --year defaults to the most recently completed calendar year.
  Schedule C questions are answered per business once the book has one;
  pass --business to fact:set and to doc:add for 1099-NEC/1099-K forms.
  Document lines mapped to a tax category override the book total for that
  category in the tax report. Boxes listed by doc:forms get a label and a
  category automatically; --category overrides, --no-category leaves it unmapped.

RULES
  rule:list [--condensed]
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

ACCOUNT TYPES
  asset, liability, equity, income, expense

ASSET TYPES
  liquid, brokerage, roth_retirement, tax_deferred

TRANSACTION STATUS
  pending, categorized
`.trim();
