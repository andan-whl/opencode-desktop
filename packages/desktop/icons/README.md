# OpenCodeDesktop Icons

The master source is `app-icon.svg` in this directory. Each channel folder
(`dev`, `beta`, `prod`) holds a complete icon set; `scripts/copy-icons.ts`
copies the active channel into `resources/icons` during `prebuild`.

## Regenerating

The set is produced from `app-icon.svg` without external image tooling:

1. Render the SVG to PNG at every required size with headless Chrome.
   A fixed 512x512 window with `--force-device-scale-factor=<size/512>`
   avoids the blank captures Chrome produces for small viewports:

   ```
   chrome --headless=new --disable-gpu --hide-scrollbars ^
     --default-background-color=00000000 ^
     --window-size=512,512 --force-device-scale-factor=<size/512> ^
     --screenshot=<size>.png wrapper.html
   ```

   `wrapper.html` inlines the SVG with its `width`/`height` attributes
   removed and `svg { width: 100vw; height: 100vh }` styling.

2. Pack `icon.ico` (16, 24, 32, 48, 64, 128, 256 as PNG-compressed
   entries) and `icon.icns` (ic07/ic08/ic09/ic10) from the renders.

3. Copy the renders into each channel folder using the existing file
   names (Square*Logo/StoreLogo for Windows Store layouts, android
   mipmaps, iOS AppIcon sizes, `dock.png` at 256, `icon.png` at 512).

The android and iOS sets are placeholders for future mobile packaging;
desktop builds only consume `icon.ico`, `icon.icns`, and the sized PNGs.
