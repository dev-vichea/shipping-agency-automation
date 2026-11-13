#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
# Noclobber protects existing credentials, including concurrent initialization.
if ! (set -C; sed "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env.example > .env); then
    printf '%s\n' 'Could not create .env; existing configuration was left intact.' >&2
    exit 1
fi
printf '%s\n' 'Created .env with a random local PostgreSQL password.'
