#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/tv-trial-tests.XXXXXX")
trap 'rm -f "$task_test_dir"/*-test; rmdir "$task_test_dir"' EXIT HUP INT TERM
for task_source in "$task_root"/tests/tv_trial_*_test.cpp; do
  task_suite=$(basename "$task_source" _test.cpp)
  "${CXX:-c++}" -std=c++17 -pthread -I"$task_root/tests/http_stubs" -Wall -Wextra -Werror -pedantic -O1 \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    "$task_source" -o "$task_test_dir/${task_suite}-test"
  "$task_test_dir/${task_suite}-test"
done
