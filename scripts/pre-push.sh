#!/bin/sh
# Repository delivery goes through GitHub PRs, including task closure.
while read -r local_ref local_oid remote_ref remote_oid
do
    if [ "$remote_ref" = refs/heads/main ]; then
        echo 'Push rejected: main changes must go through a GitHub pull request with a merge commit.' >&2
        exit 1
    fi
done
exit 0
