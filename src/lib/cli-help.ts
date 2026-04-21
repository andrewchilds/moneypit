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

TRANSACTION STATUS
  pending, categorized
`.trim();
