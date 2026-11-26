#!/bin/zsh
set -euo pipefail

tool_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$tool_dir/../.." && pwd)"
build_dir="$project_dir/Saved/DotSession"
app="$build_dir/Dot Afterhours VirtualDJ Audio.app"
mkdir -p "$app/Contents/MacOS" "$build_dir/SwiftModuleCache"
cp "$tool_dir/Info.plist" "$app/Contents/Info.plist"
xcrun swiftc -O -module-cache-path "$build_dir/SwiftModuleCache" "$tool_dir/VirtualDJAudio.swift" \
    -o "$app/Contents/MacOS/VirtualDJAudio" -Xlinker -sectcreate -Xlinker __TEXT \
    -Xlinker __info_plist -Xlinker "$tool_dir/Info.plist"
/usr/bin/codesign --force --sign - "$app"
