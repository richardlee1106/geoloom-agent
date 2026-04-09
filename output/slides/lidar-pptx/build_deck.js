"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { warnIfSlideHasOverlaps, warnIfSlideElementsOutOfBounds } = require("./pptxgenjs_helpers/layout");

const ROOT_DIR = __dirname;
const SOURCE_RENDER_DIR = path.join(ROOT_DIR, "assets", "source-rendered");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const OUTPUT_PPTX = path.join(DIST_DIR, "激光雷达PPT_pptxgenjs_rebuilt.pptx");
const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;

function numericSort(a, b) {
  const matchA = a.match(/(\d+)/);
  const matchB = b.match(/(\d+)/);
  const numA = matchA ? Number(matchA[1]) : Number.MAX_SAFE_INTEGER;
  const numB = matchB ? Number(matchB[1]) : Number.MAX_SAFE_INTEGER;
  return numA - numB || a.localeCompare(b, "zh-CN");
}

function getSlideImages() {
  if (!fs.existsSync(SOURCE_RENDER_DIR)) {
    throw new Error(`Missing rendered source slide directory: ${SOURCE_RENDER_DIR}`);
  }

  return fs
    .readdirSync(SOURCE_RENDER_DIR)
    .filter((name) => /^slide-\d+\.png$/i.test(name))
    .sort(numericSort)
    .map((name) => path.join(SOURCE_RENDER_DIR, name));
}

async function main() {
  const slideImages = getSlideImages();

  if (slideImages.length === 0) {
    throw new Error("No rendered source slides were found. Expected files like slide-1.png.");
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "OpenAI";
  pptx.subject = "CrossEarth-SAR lidar presentation rebuild";
  pptx.title = "激光雷达PPT";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
    lang: "zh-CN",
  };

  slideImages.forEach((imagePath, index) => {
    const slide = pptx.addSlide();

    // Reuse the original PowerPoint-rendered slide as a full-bleed visual layer.
    // This keeps the rebuilt deck deterministic and layout-stable in PptxGenJS.
    slide.addImage({
      path: imagePath,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH,
      h: SLIDE_HEIGHT,
    });

    warnIfSlideHasOverlaps(slide, pptx);
    warnIfSlideElementsOutOfBounds(slide, pptx);
    console.log(`Prepared slide ${index + 1}: ${path.basename(imagePath)}`);
  });

  await pptx.writeFile({ fileName: OUTPUT_PPTX, compression: true });
  console.log(`Deck written to ${OUTPUT_PPTX}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
