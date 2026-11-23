This directory is a build placeholder for the MyAiRi desktop package.

electron-builder copies everything under engines/stage-tamagotchi-godot/out/${os}
into the app bundle as extraResources (godot-stage). The Godot 3D stage is NOT
the default stage (the app defaults to the Web/three.js/Live2D stage), so an
empty directory lets packaging succeed and the app still works normally.

To enable the native Godot 3D stage later, install Godot 4 .NET + dotnet and put
the exported binary here:
    godot --headless --export-release "Windows Desktop" out/win/godot-stage.exe

See export_presets.cfg and release-tamagotchi.yml in the repo root for details.
