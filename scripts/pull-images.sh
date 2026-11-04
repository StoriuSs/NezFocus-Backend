#!/usr/bin/env bash
# Pulls Docker images, retrying each one. CI runs it before the steps that
# start containers: Docker Hub now and then doesn't answer a runner in time
# ("context deadline exceeded"), and a check then failed for no reason of its
# own, holding back the image. See docs/ci.md.
#
#   scripts/pull-images.sh <image>...
set -euo pipefail

ATTEMPTS=${PULL_ATTEMPTS:-4}

# Fed by a pipe in CI: no images means the list it came from is broken, and
# passing would hide that.
(($# > 0)) || { echo "✗ No images given (usage: scripts/pull-images.sh <image>...)" >&2; exit 1; }

for image in "$@"; do
	for ((attempt = 1; ; attempt++)); do
		if docker pull --quiet "$image" >/dev/null; then
			echo "✓ $image"
			break
		fi
		if ((attempt >= ATTEMPTS)); then
			echo "✗ Could not pull $image after $ATTEMPTS attempts." >&2
			exit 1
		fi
		wait=$((attempt * 15))
		echo "  $image: attempt $attempt failed, retrying in ${wait}s" >&2
		sleep "$wait"
	done
done
