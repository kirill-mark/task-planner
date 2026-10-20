#!/bin/sh
set -eu
widget_test_dir=$(mktemp -d /private/tmp/mark-widget-model.XXXXXX)
trap 'rm -rf "$widget_test_dir"' EXIT
swiftc -module-cache-path "$widget_test_dir/cache" ios/App/MARKWidget/WidgetData.swift tests/widget/main.swift -o "$widget_test_dir/tests"
"$widget_test_dir/tests"
