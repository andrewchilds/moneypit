#!/bin/bash

# Usage:
#   ./create-local-db.sh [dbName] [dbPass]

set -e     #  Exit on error
# set -x.  #  Enable debugging

_dbName="$1"
_dbPass="$2"

if [ -z "$_dbName" ] || [ -z "$_dbPass" ]; then
  echo "Usage: $0 [dbName] [dbPass]"
  exit 1
fi

function create_db {
  dbName="$1"
  dbPass="$2"

  delete_db $dbName

  echo "CREATE ROLE $dbName WITH CREATEDB LOGIN PASSWORD '$dbPass';" | psql postgres
  echo "CREATE DATABASE $dbName;" | psql postgres
  echo "GRANT ALL PRIVILEGES ON DATABASE $dbName TO $dbName;" | psql postgres
  echo "ALTER DATABASE $dbName OWNER TO $dbName;" | psql postgres
}

function delete_db {
  dbName="$1"

  echo "DROP DATABASE IF EXISTS $dbName;" | psql postgres
  echo "DROP ROLE IF EXISTS $dbName;" | psql postgres
}

create_db $_dbName $_dbPass
echo "Database $_dbName created successfully with password $_dbPass."

exit 0
