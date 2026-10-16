# OpenCodeDesktop Icons

The master source is `app-icon.svg` in this directory. Each channel folder
(`dev`, `beta`, `prod`) holds a complete icon set; `scripts/copy-icons.ts`
copies the active channel into `resources/icons` during `prebuild`.

## Regenerating

The set is produced from `app-icon.svg` without external image tooling:

1. Render the SVG to PNG at every required size with the Electron
   renderer (Chromium canvas, one re-rasterization per size):

   ```
   node_modules/electron/dist/electron.exe scripts/render-icons.cjs <out-dir>
   ```

   Each render resets the SVG's `width`/`height` to the target size so
   Chromium rasterizes the vector at exactly that resolution, keeping
   the rounded corners transparent and the artwork centered. Do not use
   headless Chrome screenshots with `--force-device-scale-factor`:
   Chrome clamps fractional scale factors, which produced offset,
   cropped entries and the truncated Windows taskbar icon.

2. Pack `icon.ico` (16, 24, 32, 48, 64, 128, 256 as PNG-compressed
   entries) and `icon.icns` (ic07/ic08/ic09/ic10) from the renders.

3. Copy the renders into each channel folder using the existing file
   names (Square*Logo/StoreLogo for Windows Store layouts, android
   mipmaps, iOS AppIcon sizes, `dock.png` at 256, `icon.png` at 512).
   Android adaptive foregrounds (`*-fg`) center the icon at 2/3 of the
   canvas.

The android and iOS sets are placeholders for future mobile packaging;
desktop builds only consume `icon.ico`, `icon.icns`, and the sized PNGs.
