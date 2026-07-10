import fs from "node:fs";

import { chromium } from "playwright-core";

const MAX_BOTTOM_GAP = 24;
const browserPath =
  process.env.CHROME_PATH ??
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => fs.existsSync(candidate));

if (!browserPath) {
  throw new Error("Set CHROME_PATH to a Chrome or Edge executable");
}

const browser = await chromium.launch({ headless: true, executablePath: browserPath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:3201/", {
    waitUntil: "networkidle",
  });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "layout.jsonl",
    mimeType: "application/jsonl",
    buffer: Buffer.from('{"a":1}\n'),
  });

  const row = page.getByText('{"a":1}', { exact: true });
  await row.waitFor();
  await row.click({ button: "right" });
  await page.locator('[class*="contextMenuItem"]').first().click();

  const editor = page.locator("textarea");
  const measurement = await editor.evaluate((editor) => {
    const editorRect = editor.getBoundingClientRect();
    const containerRect = editor.parentElement.getBoundingClientRect();

    return {
      bottomGap: containerRect.bottom - editorRect.bottom,
      containerHeight: containerRect.height,
      editorHeight: editorRect.height,
      resize: getComputedStyle(editor).resize,
    };
  });

  console.log(JSON.stringify(measurement));

  if (measurement.bottomGap > MAX_BOTTOM_GAP) {
    throw new Error(
      `Editor leaves ${measurement.bottomGap}px unused below it; expected at most ${MAX_BOTTOM_GAP}px`,
    );
  }
  if (measurement.resize !== "none") {
    throw new Error(`Editor resize is ${measurement.resize}; expected none`);
  }

  await editor.fill("{bad");
  const error = page.locator('[class*="editorError"]');
  await error.waitFor({ state: "visible" });
  const invalidMeasurement = await editor.evaluate((editor) => {
    const containerRect = editor.parentElement.getBoundingClientRect();
    const errorRect = editor.nextElementSibling.getBoundingClientRect();

    return {
      editorHeight: editor.getBoundingClientRect().height,
      errorBottomGap: containerRect.bottom - errorRect.bottom,
    };
  });

  console.log(JSON.stringify(invalidMeasurement));

  if (invalidMeasurement.editorHeight <= 0 || invalidMeasurement.errorBottomGap < 0) {
    throw new Error("Invalid JSON error is outside the editor content area");
  }
} finally {
  await browser.close();
}
