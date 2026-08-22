import * as docx from 'docx';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  HeightRule,
  Header,
  Footer,
  PageNumber,
  ImageRun,
  convertMillimetersToTwip,
  TabStopType,
  ShadingType,
} = docx;

// ── Smart Text Hierarchy Parser ──
export function parseRawText(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split(/\r?\n/);
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // 1. Level 1: Major Headings (e.g. "1. NAME", "4. MEMBERSHIP", "12. AMENDMENT OF THE CONSTITUTION")
    const l1Match = rawLine.match(/^(\d+)\.\s+([A-Z0-9\s\&\,\-\(\)]+)$/);
    if (l1Match) {
      blocks.push({
        type: 'level1',
        level: 1,
        number: l1Match[1] + '.',
        text: l1Match[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // Level 1: Standalone All-Caps Title / Heading (e.g. "ADOPTION AND SIGN-OFF RESOLUTION")
    if (/^[A-Z0-9\s\&\,\-\(\)\:]{4,}$/.test(rawLine) && !rawLine.startsWith('http') && !rawLine.includes('EMIS:')) {
      blocks.push({
        type: 'level1',
        level: 1,
        number: '',
        text: rawLine.trim(),
        fullText: rawLine
      });
      continue;
    }

    // 2. Level 5: 5-level numbering (e.g. "1.1.1.1.1 [Text]" or "(aa) [Text]")
    const l5Match = rawLine.match(/^(\d+\.\d+\.\d+\.\d+\.\d+|\([a-z]{2}\))\s+(.*)$/i);
    if (l5Match) {
      blocks.push({
        type: 'level5',
        level: 5,
        number: l5Match[1],
        text: l5Match[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 3. Level 4: 4-level numbering (e.g. "1.1.1.1 [Text]" or "(a) [Text]" or "(i) [Text]")
    const l4Match = rawLine.match(/^(\d+\.\d+\.\d+\.\d+|\([a-z]\)|\([ivxlcdm]+\))\s+(.*)$/i);
    if (l4Match) {
      blocks.push({
        type: 'level4',
        level: 4,
        number: l4Match[1],
        text: l4Match[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 4. Level 3: 3-level numbering (e.g. "3.1.5 [Text]", "10.4.1 [Text]", "6.1.1 [Text]")
    const l3Match = rawLine.match(/^(\d+\.\d+\.\d+)\s+(.*)$/);
    if (l3Match) {
      blocks.push({
        type: 'level3',
        level: 3,
        number: l3Match[1],
        text: l3Match[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 5. Level 2: 2-level numbering (e.g. "1.1 [Text]", "4.1 [Text]", "12.2 [Text]")
    const l2Match = rawLine.match(/^(\d+\.\d+)\s+(.*)$/);
    if (l2Match) {
      blocks.push({
        type: 'level2',
        level: 2,
        number: l2Match[1],
        text: l2Match[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 6. Regular Body Paragraph
    blocks.push({
      type: 'body',
      level: 0,
      number: '',
      text: rawLine,
      fullText: rawLine
    });
  }

  return blocks;
}

// ── Document Builder Engine ──
export async function buildFormattedDocx(config, parsedBlocks) {
  const typo = config.typography || {};
  const page = config.pageSetup || {};
  const hier = config.hierarchy || { levels: [] };
  const hdr = config.header || {};
  const ftr = config.footer || {};
  const comps = config.components || {};

  const fontFamily = typo.fontFamily || 'Arial';
  const baseSizeHps = (typo.bodySizePt || 10) * 2;
  const titleSizeHps = (typo.titleSizePt || 14) * 2;
  const subtitleSizeHps = (typo.subtitleSizePt || 12) * 2;
  const h1SizeHps = (typo.heading1SizePt || 11) * 2;
  const primaryColor = (typo.primaryColor || '#0C2340').replace('#', '');
  const secondaryColor = (typo.secondaryColor || '#A6192E').replace('#', '');
  const textColor = (typo.textColor || '#1A1A1A').replace('#', '');
  const lineSpacing = Math.round((typo.lineSpacing || 1.15) * 240);
  const spaceBefore = Math.round((typo.spaceBeforePt || 3.5) * 20);
  const spaceAfter = Math.round((typo.spaceAfterPt || 4.5) * 20);

  // Page Setup in Twips
  const paperWidthMm = page.paperSize === 'Letter' ? 215.9 : 210;
  const paperHeightMm = page.paperSize === 'Letter' ? 279.4 : 297;
  const leftMarginMm = page.leftMarginMm !== undefined ? Number(page.leftMarginMm) : 10;
  const rightMarginMm = page.rightMarginMm !== undefined ? Number(page.rightMarginMm) : 10;
  const topMarginMm = page.topMarginMm !== undefined ? Number(page.topMarginMm) : 10;
  const bottomMarginMm = page.bottomMarginMm !== undefined ? Number(page.bottomMarginMm) : 10;
  const bodyWidthMm = paperWidthMm - leftMarginMm - rightMarginMm;

  // Level config lookup map (1..5)
  const levelsMap = {};
  (hier.levels || []).forEach(lvl => {
    levelsMap[lvl.level] = lvl;
  });

  // Default level fallback helper
  function getLevelConfig(lvlNum) {
    if (levelsMap[lvlNum]) return levelsMap[lvlNum];
    const step = Number(hier.stepIncrementMm) || 10;
    if (lvlNum === 1) {
      return { leftOffsetMm: 0, hangingIndentMm: 0, numberPosMm: 0, textWrapMm: 0, bold: true, uppercase: true, color: primaryColor };
    }
    const offset = (lvlNum - 1) * step;
    return { leftOffsetMm: offset, hangingIndentMm: step, numberPosMm: (lvlNum - 2) * step, textWrapMm: offset, bold: false, numberBold: true, uppercase: false, color: textColor };
  }

  // Helper to create Header
  function createDocumentHeader() {
    const headerMode = hdr.sourceMode || (hdr.layout === 'none' ? 'none' : 'structured');
    if (headerMode === 'none') return undefined;

    const headerElements = [];

    // Mode 1: Custom Image Banner
    if (headerMode === 'image_banner' && hdr.imageBanner) {
      try {
        let imgBuffer = null;
        if (hdr.imageBanner.startsWith('data:image')) {
          imgBuffer = Buffer.from(hdr.imageBanner.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } else if (fsSync.existsSync(hdr.imageBanner)) {
          imgBuffer = fsSync.readFileSync(hdr.imageBanner);
        }

        if (imgBuffer) {
          const bannerHeightMm = Number(hdr.imageHeightMm) || 32;
          const bannerWidthPx = Math.round(bodyWidthMm * 3.7795);
          const bannerHeightPx = Math.round(bannerHeightMm * 3.7795);

          headerElements.push(
            new Paragraph({
              spacing: { before: 0, after: 80 },
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: imgBuffer,
                  transformation: { width: bannerWidthPx, height: bannerHeightPx },
                }),
              ],
            })
          );
          return new Header({ children: headerElements });
        }
      } catch (err) {
        console.warn('Failed to embed custom header image banner in DOCX:', err);
      }
    }

    // Mode 2: Structured Letterhead (Dual stripe + Logo + Text + Badge)
    // Optional top color stripe
    if (hdr.showColorBar !== false) {
      const c1 = (hdr.colorBarPrimary || secondaryColor || 'A6192E').replace('#', '');
      const c2 = (hdr.colorBarSecondary || primaryColor || '0C2340').replace('#', '');
      const stripeTable = new Table({
        width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            height: { value: convertMillimetersToTwip(2.2), rule: HeightRule.EXACT },
            children: [
              new TableCell({
                width: { size: convertMillimetersToTwip(bodyWidthMm * 0.65), type: WidthType.DXA },
                shading: { fill: c1 },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: ' ', size: 2 })] })],
              }),
              new TableCell({
                width: { size: convertMillimetersToTwip(bodyWidthMm * 0.35), type: WidthType.DXA },
                shading: { fill: c2 },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: ' ', size: 2 })] })],
              }),
            ],
          }),
        ],
      });
      headerElements.push(stripeTable);
    }

    // Logo resolution
    let emblemData = null;
    try {
      const emblemPath = path.join(__dirname, 'public', 'emblem.png');
      if (fsSync.existsSync(emblemPath)) {
        emblemData = fsSync.readFileSync(emblemPath);
      }
    } catch (e) {}

    const tableCells = [];

    // Logo Cell (round school emblem)
    if (hdr.showLogo !== false && emblemData) {
      tableCells.push(
        new TableCell({
          width: { size: convertMillimetersToTwip(18), type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 20, bottom: 20, left: 0, right: 30 },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  data: emblemData,
                  transformation: { width: 46, height: 46 },
                  type: 'png',
                }),
              ],
            }),
          ],
        })
      );
    }

    // Center Details Cell
    const textCellWidthMm = hdr.showBadge !== false ? bodyWidthMm - (tableCells.length ? 18 : 0) - 40 : bodyWidthMm - (tableCells.length ? 18 : 0);
    const detailParagraphs = [];

    if (hdr.title) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 15, line: 240 },
          children: [new TextRun({ text: hdr.title, bold: true, size: 22, color: primaryColor, font: fontFamily })],
        })
      );
    }
    if (hdr.subtitle) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 15, line: 240 },
          children: [new TextRun({ text: hdr.subtitle, bold: true, size: 17, color: secondaryColor, font: fontFamily })],
        })
      );
    }
    if (hdr.contact) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 10, line: 220 },
          children: [new TextRun({ text: hdr.contact, size: 15, color: '475569', font: fontFamily })],
        })
      );
    }
    if (hdr.emis) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 0, line: 200 },
          children: [new TextRun({ text: hdr.emis, size: 14, color: '475569', font: fontFamily })],
        })
      );
    }

    tableCells.push(
      new TableCell({
        width: { size: convertMillimetersToTwip(textCellWidthMm), type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { left: 40, right: 40, top: 15, bottom: 15 },
        children: detailParagraphs.length ? detailParagraphs : [new Paragraph({ children: [] })],
      })
    );

    // Right Badge Cell
    if (hdr.showBadge !== false && (hdr.badgeText || hdr.badgeSubtext)) {
      tableCells.push(
        new TableCell({
          width: { size: convertMillimetersToTwip(40), type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          borders: {
            left: { style: BorderStyle.SINGLE, size: 18, color: primaryColor },
            top: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
          },
          margins: { left: 80, right: 0, top: 15, bottom: 15 },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 4 },
              children: [new TextRun({ text: hdr.badgeText || 'OFFICIAL', bold: true, size: 18, color: primaryColor, font: fontFamily })],
            }),
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [new TextRun({ text: hdr.badgeSubtext || 'CORRESPONDENCE', size: 14, color: '64748B', font: fontFamily })],
            }),
          ],
        })
      );
    }

    const headerTable = new Table({
      width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: 'CBD5E1' },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [new TableRow({ children: tableCells })],
    });

    headerElements.push(headerTable);
    return new Header({ children: headerElements });
  }

  // Helper to create Footer
  function createDocumentFooter() {
    const footerRuns = [];
    const fmt = ftr.pageNumberFormat || 'page_x_of_y';

    if (ftr.customText) {
      footerRuns.push(new TextRun({ text: ftr.customText + '   ', size: 17, color: '64748B', font: fontFamily }));
    }

    if (fmt === 'page_x_of_y') {
      footerRuns.push(
        new TextRun({ text: 'Page ', size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ text: ' of ', size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: '64748B', font: fontFamily })
      );
    } else if (fmt === 'page_x') {
      footerRuns.push(
        new TextRun({ text: 'Page ', size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '64748B', font: fontFamily })
      );
    } else if (fmt === 'dash_x_dash') {
      footerRuns.push(
        new TextRun({ text: '- ', size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ text: ' -', size: 17, color: '64748B', font: fontFamily })
      );
    } else if (fmt === 'x_slash_y') {
      footerRuns.push(
        new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ text: ' / ', size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: '64748B', font: fontFamily })
      );
    }

    let align = AlignmentType.CENTER;
    if (ftr.alignment === 'right') align = AlignmentType.RIGHT;
    if (ftr.alignment === 'left') align = AlignmentType.LEFT;

    return new Footer({
      children: [
        new Paragraph({
          alignment: align,
          spacing: { before: 60, after: 0 },
          border: ftr.showTopDivider !== false ? {
            top: { color: 'E2E8F0', size: 4, style: BorderStyle.SINGLE }
          } : undefined,
          children: footerRuns,
        }),
      ],
    });
  }

  // Document Content Array
  const docChildren = [];

  // 1. Document Title & Subtitle
  if (config.documentTitle) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 40 },
        children: [
          new TextRun({
            text: config.documentTitle,
            bold: true,
            size: titleSizeHps,
            color: primaryColor,
            font: fontFamily,
          }),
        ],
      })
    );
  }
  if (config.documentSubtitle) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 180 },
        children: [
          new TextRun({
            text: config.documentSubtitle,
            bold: true,
            size: subtitleSizeHps,
            color: secondaryColor,
            font: fontFamily,
          }),
        ],
      })
    );
  }

  // 2. Metadata Table
  if (comps.metadataTable && comps.metadataTable.enabled && Array.isArray(comps.metadataTable.rows) && comps.metadataTable.rows.length) {
    const col1Mm = Math.round(bodyWidthMm * 0.38);
    const col2Mm = bodyWidthMm - col1Mm;

    const tableRows = [
      new TableRow({
        children: [
          new TableCell({
            width: { size: convertMillimetersToTwip(col1Mm), type: WidthType.DXA },
            shading: { fill: primaryColor },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: comps.metadataTable.col1Title || 'Attribute', bold: true, size: 19, color: 'FFFFFF', font: fontFamily })] })],
          }),
          new TableCell({
            width: { size: convertMillimetersToTwip(col2Mm), type: WidthType.DXA },
            shading: { fill: primaryColor },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: comps.metadataTable.col2Title || 'Specifications', bold: true, size: 19, color: 'FFFFFF', font: fontFamily })] })],
          }),
        ],
      }),
    ];

    comps.metadataTable.rows.forEach((r, idx) => {
      const isAlt = idx % 2 === 1;
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: convertMillimetersToTwip(col1Mm), type: WidthType.DXA },
              shading: isAlt ? { fill: 'F8FAFC' } : undefined,
              margins: { top: 80, bottom: 80, left: 140, right: 140 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              },
              children: [new Paragraph({ children: [new TextRun({ text: r.label || '', bold: true, size: baseSizeHps, color: primaryColor, font: fontFamily })] })],
            }),
            new TableCell({
              width: { size: convertMillimetersToTwip(col2Mm), type: WidthType.DXA },
              shading: isAlt ? { fill: 'F8FAFC' } : undefined,
              margins: { top: 80, bottom: 80, left: 140, right: 140 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
                right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              },
              children: [new Paragraph({ children: [new TextRun({ text: r.value || '', size: baseSizeHps, color: textColor, font: fontFamily })] })],
            }),
          ],
        })
      );
    });

    docChildren.push(
      new Table({
        width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
        rows: tableRows,
      }),
      new Paragraph({ spacing: { before: 120, after: 0 }, children: [] })
    );
  }

  // 3. Legal Notice Callout Box
  if (comps.legalNotice && comps.legalNotice.enabled && comps.legalNotice.text) {
    docChildren.push(
      new Table({
        width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
          right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
          left: { style: BorderStyle.SINGLE, size: 24, color: primaryColor },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
                shading: { fill: 'F8FAFC' },
                margins: { top: 120, bottom: 120, left: 160, right: 160 },
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: 0, line: 260 },
                    alignment: AlignmentType.BOTH,
                    children: [
                      new TextRun({
                        text: comps.legalNotice.prefix || 'LEGAL NOTICE: ',
                        bold: true,
                        size: baseSizeHps - 2,
                        color: primaryColor,
                        font: fontFamily,
                      }),
                      new TextRun({
                        text: comps.legalNotice.text,
                        size: baseSizeHps - 2,
                        color: textColor,
                        font: fontFamily,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { before: 140, after: 0 }, children: [] })
    );
  }

  // 4. Formatted Hierarchical Blocks (Levels 1 to 5)
  parsedBlocks.forEach(block => {
    if (block.type === 'level1') {
      const cfg = getLevelConfig(1);
      const l2Cfg = getLevelConfig(2);
      const tabPosMm = Number(l2Cfg.textWrapMm) || Number(l2Cfg.leftOffsetMm) || 10;
      const headingText = cfg.uppercase ? block.text.toUpperCase() : block.text;

      if (block.number) {
        docChildren.push(
          new Paragraph({
            spacing: { before: 240, after: 100 },
            keepWithNext: true,
            indent: { left: convertMillimetersToTwip(cfg.leftOffsetMm || 0) },
            tabStops: [
              {
                type: TabStopType.LEFT,
                position: convertMillimetersToTwip(tabPosMm),
              },
            ],
            children: [
              new TextRun({
                text: block.number,
                bold: cfg.bold !== false,
                size: h1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
              new TextRun({
                text: '\t',
                size: h1SizeHps,
                font: fontFamily,
              }),
              new TextRun({
                text: headingText,
                bold: cfg.bold !== false,
                size: h1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
            ],
          })
        );
      } else {
        docChildren.push(
          new Paragraph({
            spacing: { before: 240, after: 100 },
            keepWithNext: true,
            indent: { left: convertMillimetersToTwip(cfg.leftOffsetMm || 0) },
            children: [
              new TextRun({
                text: headingText,
                bold: cfg.bold !== false,
                size: h1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
            ],
          })
        );
      }
    } else if (block.type === 'level2' || block.type === 'level3' || block.type === 'level4' || block.type === 'level5') {
      const lvlNum = block.level || (block.type === 'level2' ? 2 : block.type === 'level3' ? 3 : block.type === 'level4' ? 4 : 5);
      const cfg = getLevelConfig(lvlNum);

      const leftOffsetMm = Number(cfg.leftOffsetMm) || (lvlNum - 1) * 10;
      const hangingMm = Number(cfg.hangingIndentMm) || 10;
      const textWrapMm = Number(cfg.textWrapMm) || leftOffsetMm;

      docChildren.push(
        new Paragraph({
          spacing: { before: spaceBefore, after: spaceAfter, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          indent: {
            left: convertMillimetersToTwip(leftOffsetMm),
            hanging: convertMillimetersToTwip(hangingMm),
          },
          tabStops: [
            {
              type: TabStopType.LEFT,
              position: convertMillimetersToTwip(textWrapMm),
            },
          ],
          children: [
            new TextRun({
              text: block.number,
              bold: cfg.numberBold !== false,
              size: baseSizeHps,
              color: (cfg.color || primaryColor).replace('#', ''),
              font: fontFamily,
            }),
            new TextRun({
              text: '\t',
              size: baseSizeHps,
              font: fontFamily,
            }),
            new TextRun({
              text: block.text,
              bold: cfg.bold === true,
              italic: cfg.italic === true,
              size: baseSizeHps,
              color: textColor,
              font: fontFamily,
            }),
          ],
        })
      );
    } else {
      // General Body text
      docChildren.push(
        new Paragraph({
          spacing: { before: spaceBefore, after: spaceAfter, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          indent: { left: convertMillimetersToTwip(0) },
          children: [
            new TextRun({
              text: block.text || block.fullText || '',
              size: baseSizeHps,
              color: textColor,
              font: fontFamily,
            }),
          ],
        })
      );
    }
  });

  // 5. Sign-off Resolution Signature Block (Held together as one single unit)
  if (comps.signatures && comps.signatures.enabled && Array.isArray(comps.signatures.signers) && comps.signatures.signers.length) {
    if (comps.signatures.title) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 260, after: 100 },
          keepWithNext: true,
          keepLines: true,
          children: [
            new TextRun({
              text: comps.signatures.title.toUpperCase(),
              bold: true,
              size: h1SizeHps,
              color: primaryColor,
              font: fontFamily,
            }),
          ],
        })
      );
    }
    if (comps.signatures.introText) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 60, after: 140, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          keepWithNext: true,
          keepLines: true,
          children: [
            new TextRun({
              text: comps.signatures.introText,
              size: baseSizeHps,
              color: textColor,
              font: fontFamily,
            }),
          ],
        })
      );
    }

    const signers = comps.signatures.signers;
    const colWidthMm = bodyWidthMm / signers.length;

    const signatureCells = signers.map(s => {
      let nameVal = s.name ? s.name.trim() : '';
      if (nameVal.toLowerCase().startsWith('name:')) {
        nameVal = nameVal.replace(/^name:\s*/i, '');
      } else if (nameVal.toLowerCase().startsWith('surname, name:')) {
        nameVal = nameVal.replace(/^surname,\s*name:\s*/i, '');
      }

      let dateVal = s.dateLabel ? s.dateLabel.trim() : '';
      if (dateVal.toLowerCase().startsWith('date:')) {
        dateVal = dateVal.replace(/^date:\s*/i, '');
      }

      return new TableCell({
        width: { size: convertMillimetersToTwip(colWidthMm), type: WidthType.DXA },
        margins: { left: 40, right: 40, top: 160, bottom: 40 },
        children: [
          // 1. Signature line & label
          new Paragraph({
            spacing: { before: 0, after: 20 },
            keepWithNext: true,
            keepLines: true,
            children: [new TextRun({ text: '__________________________________', color: '64748B', font: fontFamily, size: baseSizeHps })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 60 },
            keepWithNext: true,
            keepLines: true,
            children: [new TextRun({ text: 'Signature', italics: true, color: '64748B', font: fontFamily, size: Math.max(7, (baseSizeHps / 2) - 2) * 2 })],
          }),
          // 2. Surname, Name
          new Paragraph({
            spacing: { before: 0, after: 30 },
            keepWithNext: true,
            keepLines: true,
            children: [
              new TextRun({ text: 'Surname, Name: ', font: fontFamily, size: baseSizeHps - 1 }),
              new TextRun({ text: nameVal || '____________________', color: textColor, font: fontFamily, size: baseSizeHps - 1 }),
            ],
          }),
          // 3. Role
          new Paragraph({
            spacing: { before: 0, after: 0 },
            keepWithNext: true,
            keepLines: true,
            children: [new TextRun({ text: s.role || 'Signatory', bold: true, color: primaryColor, font: fontFamily, size: baseSizeHps - 1 })],
          }),
          // 4. Date (with line spacing before date fields)
          new Paragraph({
            spacing: { before: 140, after: 0 },
            keepLines: true,
            children: [
              new TextRun({ text: 'Date: ', font: fontFamily, size: baseSizeHps - 2 }),
              new TextRun({ text: dateVal || '____________________________', color: textColor, font: fontFamily, size: baseSizeHps - 2 }),
            ],
          }),
        ],
      });
    });

    docChildren.push(
      new Table({
        width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [new TableRow({ cantSplit: true, children: signatureCells })],
      })
    );
  }

  // Construct Document Object
  const docHeader = createDocumentHeader();
  const docFooter = createDocumentFooter();
  const isFirstPageOnly = (hdr.frequency || 'first_page_only') === 'first_page_only';

  const sectionConfig = {
    properties: {
      page: {
        size: {
          width: convertMillimetersToTwip(paperWidthMm),
          height: convertMillimetersToTwip(paperHeightMm),
        },
        margin: {
          top: convertMillimetersToTwip(topMarginMm),
          bottom: convertMillimetersToTwip(bottomMarginMm),
          left: convertMillimetersToTwip(leftMarginMm),
          right: convertMillimetersToTwip(rightMarginMm),
          header: convertMillimetersToTwip(8),
          footer: convertMillimetersToTwip(8),
        },
      },
      titlePage: isFirstPageOnly,
    },
    headers: isFirstPageOnly
      ? {
          first: docHeader,
          default: new Header({ children: [] }),
        }
      : {
          default: docHeader,
        },
    footers: {
      first: docFooter,
      default: docFooter,
    },
    children: docChildren,
  };

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: fontFamily,
            size: baseSizeHps,
            color: textColor,
          },
        },
      },
    },
    sections: [sectionConfig],
  });

  return await Packer.toBuffer(doc);
}

// ── Word COM PDF Conversion Helper (with process isolation & cleanup) ──
export async function convertDocxToPdf(docxPath, pdfPath) {
  const psScript = `
$docPath = "${docxPath.replace(/\\/g, '\\\\')}"
$pdfPath = "${pdfPath.replace(/\\/g, '\\\\')}"
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($docPath, $false, $true)
    $doc.SaveAs([ref]$pdfPath, [ref]17) # wdFormatPDF = 17
    $doc.Close([ref]0) # wdDoNotSaveChanges = 0
    $doc = $null
    Write-Output "CONVERT_OK"
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    if ($doc -ne $null) {
        try { $doc.Close([ref]0) } catch {}
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null } catch {}
    }
    if ($word -ne $null) {
        try { $word.Quit([ref]0) } catch {}
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
`;

  const tempPs1 = path.join(__dirname, 'uploads', `convert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.ps1`);
  await fs.writeFile(tempPs1, psScript, 'utf8');

  try {
    const { stdout, stderr } = await execPromise(`powershell -ExecutionPolicy Bypass -File "${tempPs1}"`, {
      timeout: 30000 // 30s timeout
    });
    if (fsSync.existsSync(pdfPath)) {
      return { success: true, pdfPath };
    }
    throw new Error(stderr || 'PDF file was not produced by Word engine');
  } catch (err) {
    console.error('Word COM PDF Conversion error:', err);
    try {
      await execPromise('powershell -Command "Stop-Process -Name WINWORD -Force -ErrorAction SilentlyContinue"');
    } catch (e) {}
    throw err;
  } finally {
    try { await fs.unlink(tempPs1); } catch (e) {}
  }
}
