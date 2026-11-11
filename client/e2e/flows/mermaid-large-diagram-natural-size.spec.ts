/*
 * MERMAID — a WIDE diagram keeps its natural size (no max-width squeeze).
 * iterate-2026-11-10-mermaid-large-diagram-render.
 *
 * A `flowchart LR` with five subgraphs side by side was rendered with mermaid's
 * default `useMaxWidth: true`, i.e. `style="max-width: 100%"` on the <svg>, and
 * shrank to an unreadable speck. MermaidRenderer now initialises mermaid with
 * `useMaxWidth: false` (+ a theme that follows the page). This renders the real
 * diagram with the real library under that same configuration and asserts the
 * SVG is drawn at its natural, readable width.
 */

import { test, expect } from "@playwright/test";
import { mermaidBundle, type MermaidGlobal } from "../helpers/mermaid-bundle";

const NL = String.fromCharCode(10);

const WIDE_DIAGRAM = [
  "flowchart LR",
  '  subgraph SRC["Source systems"]',
  '    GAL["Galileo interface<br/>CH_IF_GA.CH_IN_G_* (20 tables)"]',
  '    GW["Guidewire DataHub ODS PC<br/>CHIFDHPC.CS_* (5 tables)"]',
  "  end",
  '  subgraph EX["EX extraction"]',
  '    EXT[("CH_EXTRC.CH_EX_G_*<br/>CH_EX_MFC_* / CH_EX_MFP_*")]',
  "  end",
  '  subgraph AD["AD admin: keymap and retained keys"]',
  '    KM[("CH_ADMIN.CH_AD_KEYMAP_*")]',
  '    RK[("CH_ADMIN.CH_AD_RK_*")]',
  "  end",
  '  subgraph TR["TR transformation"]',
  '    TMP[("CH_TR_G_TEMP_POLICY_3_1<br/>CH_TR_G_TEMP_COST_3_1")]',
  '    TUOE[("CH_TR_G_GEN_UNIT_OF_EXPOSURE<br/>CH_TR_G_X_INSURANCE_TAX")]',
  "  end",
  '  subgraph SI["SI standard insurance datamodel"]',
  '    SIT[("CH_SIDM.INSURANCE_POLICY<br/>GENERAL_UNIT_OF_EXPOSURE<br/>X_INSURANCE_TAX")]',
  "  end",
  '  subgraph DM["DM data mart"]',
  '    PH[("CH_DM_MF.CH_DM_MF_POLICY_PREMIUM_HIST")]',
  '    CE[("CH_DM_BT.CH_DM_COMPARE_ERRORS")]',
  "  end",
  '  GAL -->|"ch_ex_j_*"| EXT',
  '  EXT -->|"ch_tr_j_*_load_ad_keymap_*"| KM',
  '  KM -->|"ch_tr_j_*_load_ad_rk_*"| RK',
  '  EXT -->|"ch_tr_j_*_load_temp_*"| TMP',
  '  RK -->|"RKMAP views"| TUOE',
  '  TMP -->|"ch_tr_j_*_load_uoe / _x_insurance_tax"| TUOE',
  '  TUOE -->|"ch_si_j_obi_load_uoe / _x_insurance_tax"| SIT',
  '  SIT -->|"ch_dm_j_mf_load_premium_hist"| PH',
  '  SIT -->|"ch_dm_j_mf_compare_policen_praemien"| CE',
  "  GW --> CE",
].join(NL);

// Must mirror the options MermaidRenderer.tsx passes to mermaid.initialize().
const APP_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "dark",
  flowchart: { useMaxWidth: false },
} as const;

test.describe("@smoke wide mermaid diagram keeps natural size", () => {
  test("flowchart LR with five subgraphs is not squeezed to max-width:100%", { tag: ["@FR-01.02"] }, async ({
    page,
  }) => {
    await page.setContent(
      "<!doctype html><html><body style='margin:0'><div id='host' style='width:600px;overflow:auto'></div></body></html>",
    );
    const bundle = await mermaidBundle();
    await page.addScriptTag({ content: bundle.code });

    const out = await page.evaluate(
      async ([text, config]) => {
        const g = globalThis as unknown as MermaidGlobal;
        g.__mermaid.initialize(config as never);
        const { svg } = await g.__mermaid.render("mermaid-wide", text as string);
        const host = document.getElementById("host") as HTMLElement;
        host.innerHTML = svg;
        const el = host.querySelector("svg") as SVGSVGElement;
        return {
          style: el.getAttribute("style") ?? "",
          width: el.getBoundingClientRect().width,
          hostWidth: host.clientWidth,
        };
      },
      [WIDE_DIAGRAM, APP_CONFIG] as const,
    );

    expect(out.style, "svg must not carry max-width:100%").not.toMatch(
      /max-width:\s*100%/,
    );
    // Host is 600px wide; a readable five-subgraph LR layout is far wider.
    expect(out.width, "svg drawn at natural width, not squeezed").toBeGreaterThan(
      out.hostWidth,
    );
  });
});
