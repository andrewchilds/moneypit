#!/bin/bash

# Test runner script for Moneypit
# Handles test environment setup, database reset, and test execution
#
# Usage:
#   ./scripts/test.sh              # Run all tests (unit + e2e)
#   ./scripts/test.sh unit         # Run only unit tests
#   ./scripts/test.sh e2e          # Run only e2e tests
#   ./scripts/test.sh e2e --watch  # Run e2e tests in watch mode

set -e  # Exit on any error

# Add bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Configuration
TEST_DB_NAME="moneypit_test"
TEST_DB_URL="postgresql://moneypit_test:moneypit_test@localhost:5432/moneypit_test"
ENV_FILE=".env.test"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[TEST]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Parse arguments
TEST_TYPE="${1:-all}"
shift 2>/dev/null || true
EXTRA_ARGS="$@"

# Verify test database exists and we can connect
verify_test_db() {
    log "Verifying test database connection..."

    local db_name=$(PGPASSWORD=moneypit_test psql -h localhost -U moneypit_test -d $TEST_DB_NAME -tAc "SELECT current_database();" 2>/dev/null)

    if [ "$db_name" != "$TEST_DB_NAME" ]; then
        error "Could not connect to test database '$TEST_DB_NAME'"
        error "Create it with: ./scripts/create-local-db.sh moneypit_test moneypit_test"
        exit 1
    fi

    success "Connected to test database: $db_name"
}

# Reset test database schema
reset_test_db() {
    log "Resetting test database schema..."

    # Safety check: ensure we're targeting the test database
    if [[ "$DATABASE_URL" != *"$TEST_DB_NAME"* ]]; then
        error "SAFETY CHECK FAILED: DATABASE_URL doesn't contain '$TEST_DB_NAME'"
        error "Current DATABASE_URL: $DATABASE_URL"
        exit 1
    fi

    if ! DATABASE_URL="$TEST_DB_URL" PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npx prisma db push --force-reset --accept-data-loss 2>&1; then
        error "Database reset failed"
        exit 1
    fi

    success "Test database schema reset"
}

# Run unit tests (no database needed)
run_unit_tests() {
    log "Running unit tests..."
    if bun test test/unit $EXTRA_ARGS; then
        success "Unit tests passed!"
        return 0
    else
        error "Unit tests failed!"
        return 1
    fi
}

# Run e2e tests (requires database)
run_e2e_tests() {
    log "Running e2e tests..."
    if DATABASE_URL="$TEST_DB_URL" bun test test/e2e $EXTRA_ARGS; then
        success "E2E tests passed!"
        return 0
    else
        error "E2E tests failed!"
        return 1
    fi
}

# Main
case "$TEST_TYPE" in
    unit)
        run_unit_tests
        ;;
    e2e)
        verify_test_db
        export DATABASE_URL="$TEST_DB_URL"
        reset_test_db
        run_e2e_tests
        ;;
    all)
        # Run unit tests first (fast, no setup)
        run_unit_tests

        # Then e2e tests
        verify_test_db
        export DATABASE_URL="$TEST_DB_URL"
        reset_test_db
        run_e2e_tests
        ;;
    *)
        error "Unknown test type: $TEST_TYPE"
        echo "Usage: $0 [unit|e2e|all] [extra vitest args]"
        exit 1
        ;;
esac
