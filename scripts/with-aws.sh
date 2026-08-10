#!/bin/sh
# Runs a command with AWS credentials that live INSIDE this project.
#
# The AWS SDK honours these variables, so nothing here reads or writes ~/.aws
# and there is no global AWS CLI to install.
#
#   sh scripts/with-aws.sh <command> [args...]
#
# The npm scripts in package.json already wrap every AWS command with this.
set -e

AWS_SHARED_CREDENTIALS_FILE="$PWD/.aws/credentials"
AWS_CONFIG_FILE="$PWD/.aws/config"
# AWS_REGION only. Setting AWS_DEFAULT_REGION as well makes ampx warn about the
# legacy variable on every run.
AWS_REGION="us-west-2"
export AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_REGION

# Node 23 and later expose a `localStorage` global that is not a real Storage
# object until you pass --localstorage-file. Amplify pulls in @typescript/vfs,
# which does `localStorage.getItem("DEBUG")` at import time, so `ampx` dies with
# "TypeError: localStorage.getItem is not a function" before it does anything.
#
# Turning the global off is enough: nothing in this project uses Web Storage.
# Node 22 LTS, the version Amplify targets, does not need this.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 23 ]; then
  NODE_OPTIONS="--no-experimental-webstorage${NODE_OPTIONS:+ $NODE_OPTIONS}"
  export NODE_OPTIONS
fi

if [ ! -f "$AWS_SHARED_CREDENTIALS_FILE" ]; then
  echo "ERROR: $AWS_SHARED_CREDENTIALS_FILE does not exist." >&2
  echo "See README.md, section 'AWS credentials'." >&2
  exit 1
fi

exec "$@"
