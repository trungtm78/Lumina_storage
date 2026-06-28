#!/bin/bash
# Postgres init for Lumina Storage bundle.
# Runs once on first container startup (docker-entrypoint-initdb.d).
# - Ensures the application database exists (POSTGRES_DB already creates it,
#   but this is defensive).
# - Installs the `unaccent` extension required by text-search indexes.

set -e
set -u

# Use POSTGRES_DB as the target database. Default: lumina_driver_dev.
TARGET_DB="${POSTGRES_DB:-lumina_driver_dev}"

echo "Lumina Storage init: ensuring database ${TARGET_DB} and extension unaccent"

# Create the database if it doesn't exist (POSTGRES_DB already does this on
# first boot, but if the user mounted an existing data volume, this skips).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE ${TARGET_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${TARGET_DB}')\gexec
EOSQL

# Install unaccent in the application database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${TARGET_DB}" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS unaccent;
    GRANT ALL PRIVILEGES ON DATABASE ${TARGET_DB} TO ${POSTGRES_USER};
EOSQL

echo "Lumina Storage init: done"