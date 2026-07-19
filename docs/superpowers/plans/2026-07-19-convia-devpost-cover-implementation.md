# Convia Devpost Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate one polished 3:2 PNG cover for Convia's Devpost submission.

**Architecture:** Use the built-in image generation path to create a single raster asset from the approved design specification. Save the selected image inside the repository, then use an image inspector to verify dimensions, file type, file size, title spelling, composition, and absence of prohibited marks.

**Tech Stack:** Built-in image generation, PNG, local image inspection tools

---

### Task 1: Generate and validate the cover

**Files:**
- Reference: `docs/superpowers/specs/2026-07-19-convia-devpost-cover-design.md`
- Create: `docs/hackathon-assets/convia-devpost-cover.png`

- [ ] **Step 1: Generate the cover**

Use the built-in image generation tool with the approved 3:2 composition: a dark ChatGPT-like messaging environment, Judy and Haland as distinct human participants, Convia as an independent luminous AI participant, and the single visible title `Convia`.

Expected: one landscape raster image with no third-party logos, watermark, small text, fake metrics, extra people, or unrelated devices.

- [ ] **Step 2: Save the project asset**

Copy the generated image from the built-in generated-image location to:

```text
docs/hackathon-assets/convia-devpost-cover.png
```

Expected: a PNG inside the repository without overwriting another asset.

- [ ] **Step 3: Verify mechanical constraints**

Run:

```bash
sips -g pixelWidth -g pixelHeight -g format docs/hackathon-assets/convia-devpost-cover.png
stat -f '%z' docs/hackathon-assets/convia-devpost-cover.png
```

Expected: width divided by height equals `1.5`, format is PNG, and file size is below `5242880` bytes.

- [ ] **Step 4: Visually inspect the final asset**

Open `docs/hackathon-assets/convia-devpost-cover.png` at full size and thumbnail scale.

Expected: `Convia` is spelled correctly; Judy, Haland, and Convia are distinguishable; AI reads as an independent participant; important content stays within a generous safe area; no prohibited logo, watermark, or unintended text is visible.

- [ ] **Step 5: Commit the asset**

```bash
git add docs/hackathon-assets/convia-devpost-cover.png
git commit -m "assets: add Convia Devpost cover"
```

Expected: the commit contains only the generated cover asset.
