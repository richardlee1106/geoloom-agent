# Lidar PPTX Rebuild

This workspace contains a PptxGenJS rebuild of the lidar presentation deck.

## What This Project Does

- Uses the original PowerPoint deck as the visual source of truth.
- Exports each original slide to a high-resolution PNG.
- Reassembles those 16 slide renders into a deterministic PptxGenJS deck.
- Keeps the original deck untouched while producing a rebuildable `.js` authoring source.

## Why The Rebuild Uses Slide Images

The source presentation is a dense, design-heavy deck with many positioned shapes, icons, and charts.
Rebuilding every element manually would be slow and brittle. This project therefore preserves the
exact original layout by placing each rendered slide as a full-bleed image in a new PptxGenJS deck.

## Important Paths

- Authoring source: `build_deck.js`
- Original deck snapshot: `assets/source/original.pptx`
- Original slide renders: `assets/source-rendered/`
- Rebuilt deck: `dist/激光雷达PPT_pptxgenjs_rebuilt.pptx`
- Rebuilt slide renders: `dist/rendered/`

## Rebuild

```powershell
npm run build
```

## Validation Performed

- `warnIfSlideHasOverlaps(slide, pptx)`
- `warnIfSlideElementsOutOfBounds(slide, pptx)`
- PowerPoint export of the rebuilt deck to PNG for visual review
- Montage review of the rebuilt slides

## Notes

The rebuild prioritizes visual fidelity and repeatability. If you want a later pass that converts
specific slides back into fully editable native PowerPoint shapes, we can do that slide by slide.
