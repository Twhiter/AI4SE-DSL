// component-demo.html: a page that is not React, using the DCR page as a component; the XML on the left is shown on
// the right (sample.xml at the start).

import { mountDcrPage } from "./index";
import sample from "./sample.xml?raw";

const page = mountDcrPage(document.getElementById("page")!, {
  hiddenOptions: ["newDiagram", "open", "examples", "simulation"],
});
const xml = document.querySelector<HTMLTextAreaElement>("#xml")!;
const result = document.querySelector<HTMLElement>("#result")!;

async function show() {
  try {
    const warnings = await page.show(xml.value, "Sample");
    result.textContent = warnings.length > 0 ? `Shown, with warnings:\n${warnings.join("\n")}` : "Shown.";
  } catch (error) {
    result.textContent = `Not shown: ${error instanceof Error ? error.message : String(error)}`;
  }
}

xml.value = sample;
document.querySelector<HTMLButtonElement>("#show")!.onclick = show;
window.addEventListener("resize", () => page.resized());
void show();
