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

    // 0. Markdown Headings (# = Level 1, ## = Level 2, etc.)
    const mdMatch = rawLine.match(/^(#{1,5})\s+(.*)$/);
    if (mdMatch) {
      const lvl = mdMatch[1].length;
      blocks.push({
        type: lvl === 1 ? 'level1' : `level${lvl}`,
        level: lvl,
        number: '',
        text: mdMatch[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 1. Level 5: 5-level numbering (e.g. 1.1.1.1.1 [Text])
    const l5Match = rawLine.match(/^(\d+\.\d+\.\d+\.\d+\.\d+)\.?\s+(.*)$/);
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

    // 2. Level 4: 4-level numbering (e.g. 1.1.1.1 [Text]) or Bullets
    const l4Match = rawLine.match(/^(\d+\.\d+\.\d+\.\d+)\.?\s+(.*)$/);
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
    const bulletMatch = rawLine.match(/^([•\-\*\u2022\u2023\u25E6\u2043\u2219])\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({
        type: 'level4',
        level: 4,
        number: '•',
        text: bulletMatch[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 3. Level 3: 3-level numbering (e.g. 1.1.1 [Text])
    const l3Match = rawLine.match(/^(\d+\.\d+\.\d+)\.?\s+(.*)$/);
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

    // 4. Level 2: 2-level numbering (e.g. 1.1 [Text])
    const l2Match = rawLine.match(/^(\d+\.\d+)\.?\s+(.*)$/);
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

    // 5. Level 1: 1-level numbering (e.g. 1. [Text] or 1. NAME or 1. Our Vision)
    const l1Match = rawLine.match(/^(\d+)\.\s+(.*)$/);
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

    // 6. Level 1: Section / Article / Roman numeral prefixes (e.g. SECTION 1, ARTICLE I, I., II.)
    const secMatch = rawLine.match(/^(SECTION|ARTICLE|CHAPTER|CLAUSE|PART|SCHEDULE|ANNEXURE)\s+([A-Z0-9\.\:\-]+)\s*(\:|\-|\–)?\s*(.*)$/i);
    if (secMatch) {
      const title = secMatch[4] ? secMatch[4].trim() : secMatch[0];
      blocks.push({
        type: 'level1',
        level: 1,
        number: `${secMatch[1]} ${secMatch[2]}`,
        text: title,
        fullText: rawLine
      });
      continue;
    }

    const romanL1 = rawLine.match(/^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)\.\s+(.*)$/i);
    if (romanL1) {
      blocks.push({
        type: 'level1',
        level: 1,
        number: romanL1[1] + '.',
        text: romanL1[2].trim(),
        fullText: rawLine
      });
      continue;
    }

    // 7. Level 1: Standalone All-Caps Lines (e.g. 'OUR VISION', 'CODE OF CONDUCT')
    if (/^[A-Z0-9\s\&\,\-\(\)\:\/\|]{3,65}$/.test(rawLine) && !rawLine.startsWith('http') && !rawLine.includes('EMIS:') && !rawLine.endsWith('.')) {
      blocks.push({
        type: 'level1',
        level: 1,
        number: '',
        text: rawLine.trim(),
        fullText: rawLine
      });
      continue;
    }

    // 8. Level 1: Common unnumbered headings (e.g. 'Our Vision', 'Our Mission', 'Our Core Values', 'Our Goals', 'Our Values')
    const lower = rawLine.toLowerCase().replace(/[\:\-\–\—]+$/, '').trim();
    const isNamedHeading = /^(our vision|vision|our mission|mission|our core values|core values|our values|values|our goals|strategic goals|aims and objectives|objectives|preamble|introduction|background|purpose|scope|guiding principles|policy statement|definitions|roles and responsibilities|code of conduct|adoption and sign-off|sign-off resolution|resolution)/.test(lower);
    
    // Or any short standalone title-cased heading without terminal sentence punctuation
    const isShortHeading = rawLine.length <= 45 &&
      !rawLine.endsWith('.') &&
      !rawLine.endsWith(',') &&
      !rawLine.endsWith(';') &&
      /^[A-Z]/.test(rawLine) &&
      rawLine.split(/\s+/).length <= 6 &&
      (isNamedHeading || rawLine.startsWith('Our ') || rawLine.endsWith(' Statement') || rawLine.endsWith(' Values') || rawLine.endsWith(' Policy'));

    if (isNamedHeading || isShortHeading) {
      blocks.push({
        type: 'level1',
        level: 1,
        number: '',
        text: rawLine.replace(/[\:\-\–\—]+$/, '').trim(),
        fullText: rawLine
      });
      continue;
    }

    // 9. Everything else without numbering is a regular Body Paragraph
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

  // Helper to create running header for Page 2+ (when frequency is all_pages)
  function createRunningHeader() {
    if (hdr.frequency !== 'all_pages') return undefined;

    return new Header({
      children: [
        new Paragraph({
          spacing: { before: 0, after: 80 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' }
          },
          children: [
            new TextRun({
              text: hdr.title || 'LADY GREY ARTS ACADEMY',
              bold: true,
              size: 16,
              color: primaryColor,
              font: fontFamily,
            }),
            new TextRun({
              text: '\t',
              font: fontFamily,
            }),
            new TextRun({
              text: hdr.badgeText || 'GOVERNANCE',
              size: 14,
              color: '64748B',
              font: fontFamily,
            }),
          ],
        }),
      ],
    });
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

  // 0. First Page Institutional Header (Rendered directly in page flow for perfect layout)
  if (hdr.sourceMode === 'image_banner' && hdr.imageBase64) {
    try {
      const base64Data = hdr.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      const bannerHeightMm = Number(hdr.imageHeightMm) || 32;
      const bannerWidthPx = Math.round(bodyWidthMm * 3.7795);
      const bannerHeightPx = Math.round(bannerHeightMm * 3.7795);

      docChildren.push(
        new Paragraph({
          spacing: { before: 0, after: 120 },
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: imgBuffer,
              transformation: { width: bannerWidthPx, height: bannerHeightPx },
            }),
          ],
        })
      );
    } catch (err) {
      console.warn('Failed to embed custom header image banner in DOCX:', err);
    }
  } else if (hdr.sourceMode !== 'none') {
    // 0a. Top color stripes (68% Secondary Color / 32% Primary Color)
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
            height: { value: convertMillimetersToTwip(3.5), rule: HeightRule.EXACT },
            children: [
              new TableCell({
                width: { size: convertMillimetersToTwip(bodyWidthMm * 0.68), type: WidthType.DXA },
                shading: { fill: c1 },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: ' ', size: 2 })] })],
              }),
              new TableCell({
                width: { size: convertMillimetersToTwip(bodyWidthMm * 0.32), type: WidthType.DXA },
                shading: { fill: c2 },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: ' ', size: 2 })] })],
              }),
            ],
          }),
        ],
      });
      docChildren.push(stripeTable);
      docChildren.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [] }));
    }

    // 0b. Header Table with Logo, Text & Badge
    let emblemData = null;
    try {
      const emblemPath = path.join(__dirname, 'public', 'emblem.png');
      if (fsSync.existsSync(emblemPath)) {
        emblemData = fsSync.readFileSync(emblemPath);
      }
    } catch (e) {}

    const tableCells = [];

    // Logo Cell
    if (hdr.showLogo !== false && emblemData) {
      tableCells.push(
        new TableCell({
          width: { size: convertMillimetersToTwip(16), type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 10, bottom: 10, left: 0, right: 40 },
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

    // Text Cell
    const textWidthMm = hdr.showBadge !== false ? bodyWidthMm - 16 - 36 : bodyWidthMm - 16;
    const detailParagraphs = [];
    if (hdr.title) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 8, line: 220 },
          children: [new TextRun({ text: hdr.title, bold: true, size: 20, color: primaryColor, font: fontFamily })],
        })
      );
    }
    if (hdr.subtitle) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 8, line: 220 },
          children: [new TextRun({ text: hdr.subtitle, bold: true, italics: true, size: 15, color: secondaryColor, font: fontFamily })],
        })
      );
    }
    if (hdr.contact) {
      detailParagraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 6, line: 200 },
          children: [new TextRun({ text: hdr.contact, size: 14, color: '475569', font: fontFamily })],
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
        width: { size: convertMillimetersToTwip(textWidthMm), type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 10, bottom: 10, left: 30, right: 30 },
        children: detailParagraphs.length ? detailParagraphs : [new Paragraph({ children: [] })],
      })
    );

    // Badge Cell
    if (hdr.showBadge !== false && (hdr.badgeText || hdr.badgeSubtext)) {
      tableCells.push(
        new TableCell({
          width: { size: convertMillimetersToTwip(36), type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          borders: {
            left: { style: BorderStyle.SINGLE, size: 20, color: primaryColor },
            top: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
          },
          margins: { top: 10, bottom: 10, left: 60, right: 0 },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 2, line: 200 },
              children: [new TextRun({ text: hdr.badgeText || 'OFFICIAL', bold: true, size: 19, color: primaryColor, font: fontFamily })],
            }),
            new Paragraph({
              spacing: { before: 0, after: 0, line: 180 },
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
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [new TableRow({ children: tableCells })],
    });

    docChildren.push(headerTable);

    // 0c. Clean subtle bottom divider line
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' }
        },
        children: []
      })
    );
  }

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
      let introStr = comps.signatures.introText;
      const rawTitle = config.documentTitle || '';
      if (rawTitle) {
        let formattedTitle = rawTitle.trim();
        if (formattedTitle === formattedTitle.toUpperCase() && formattedTitle.length > 3) {
          formattedTitle = formattedTitle.toLowerCase().replace(/(?:^|\s|-)\S/g, c => c.toUpperCase());
        }
        if (introStr.includes('{documentTitle}') || introStr.includes('{title}')) {
          introStr = introStr.replace(/\{documentTitle\}|\{title\}/g, formattedTitle);
        } else if (introStr.includes('Constitution of the School Governing Body') && !rawTitle.toLowerCase().includes('constitution')) {
          introStr = introStr.replace(/Constitution of the School Governing Body/gi, formattedTitle);
        }
      }

      docChildren.push(
        new Paragraph({
          spacing: { before: 60, after: 140, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          keepWithNext: true,
          keepLines: true,
          children: [
            new TextRun({
              text: introStr,
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
        margins: { left: 40, right: 40, top: 140, bottom: 40 },
        children: [
          // 1. Signature solid vector line & label
          new Paragraph({
            spacing: { before: 0, after: 20 },
            keepWithNext: true,
            keepLines: true,
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '64748B' }
            },
            children: [new TextRun({ text: '', font: fontFamily, size: 2 })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 50 },
            keepWithNext: true,
            keepLines: true,
            children: [new TextRun({ text: 'Signature', italics: true, color: '64748B', font: fontFamily, size: Math.max(7, (baseSizeHps / 2) - 2) * 2 })],
          }),
          // 2. Name (Direct name without "Surname, Name:" prefix)
          new Paragraph({
            spacing: { before: 0, after: 20 },
            keepWithNext: true,
            keepLines: true,
            children: [
              new TextRun({ text: nameVal || '____________________', bold: true, color: textColor, font: fontFamily, size: baseSizeHps }),
            ],
          }),
          // 3. Role
          new Paragraph({
            spacing: { before: 0, after: 30 },
            keepWithNext: true,
            keepLines: true,
            children: [new TextRun({ text: s.role || 'Signatory', bold: true, color: primaryColor, font: fontFamily, size: baseSizeHps - 1 })],
          }),
          // 4. Date
          new Paragraph({
            spacing: { before: 40, after: 0 },
            keepLines: true,
            children: [
              new TextRun({ text: dateVal ? `Date: ${dateVal}` : 'Date: ____________________', color: '64748B', font: fontFamily, size: baseSizeHps - 2 }),
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
  const docRunningHeader = createRunningHeader();
  const docFooter = createDocumentFooter();

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
    },
    headers: docRunningHeader ? { default: docRunningHeader } : undefined,
    footers: {
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

// ── Generate Printable HTML for Headless Browser PDF Fallback ──
export function generatePrintableHtml(config = {}, parsed = {}) {
  const primaryColor = config.colors?.primary || '#0C2340';
  const secondaryColor = config.colors?.secondary || '#A6192E';
  const textColor = config.colors?.bodyText || '#1A1A1A';
  const fontFamily = config.typography?.fontFamily || 'Arial';
  const lineSpacing = config.typography?.lineSpacing || 1.15;
  const titleSizePt = config.typography?.titleSizePt || 14;
  const subtitleSizePt = config.typography?.subtitleSizePt || 12;
  const h1SizePt = config.typography?.heading1SizePt || 11;
  const bodySizePt = config.typography?.bodySizePt || 10;

  const marginLeft = config.margins?.left || 10;
  const marginRight = config.margins?.right || 10;
  const marginTop = config.margins?.top || 10;
  const marginBottom = config.margins?.bottom || 10;

  const header = config.header || {};
  let headerHtml = '';

  if (header.sourceMode === 'image_banner' && header.imageBase64) {
    headerHtml = `
      <div style="text-align: center; margin-bottom: 5mm;">
        <img src="${header.imageBase64}" style="max-height: ${header.imageHeight || 32}mm; max-width: 100%; object-fit: ${header.imageFit || 'contain'};" />
      </div>
    `;
  } else if (header.sourceMode !== 'none') {
    const showBar = header.showColorBar !== false;
    headerHtml = `
      <div style="margin-bottom: 5mm;">
        ${showBar ? `
          <div style="display: flex; height: 3.5mm; margin-bottom: 2.5mm;">
            <div style="width: 68%; background: ${secondaryColor};"></div>
            <div style="width: 32%; background: ${primaryColor};"></div>
          </div>
        ` : ''}
        <table style="width: 100%; border-collapse: collapse; border: none; margin-bottom: 2mm;">
          <tr>
            <td style="width: 16mm; vertical-align: middle; padding: 0 4mm 0 0;">
              <img src="http://localhost:3000/emblem.png" style="width: 14mm; height: 14mm; object-fit: contain;" />
            </td>
            <td style="vertical-align: middle; padding: 0 3mm;">
              <div style="font-weight: bold; font-size: 10pt; color: ${primaryColor}; line-height: 1.2;">${header.title || 'LADY GREY ARTS ACADEMY'}</div>
              <div style="font-size: 7.5pt; font-weight: bold; font-style: italic; color: ${secondaryColor}; line-height: 1.2;">${header.subtitle || 'Where Learning is an Art'}</div>
              <div style="font-size: 7pt; color: #475569; line-height: 1.2;">${header.contact || '18 Brummer Street, Lady Grey, 9755 | Tel: 051 603 0046 | admin@lgaa.co.za'}</div>
              <div style="font-size: 7pt; color: #475569; line-height: 1.2;">${header.emis || 'EMIS: 200600985 | District: Joe Gqabi | Circuit: Ekhephini | CMC: Maletswai'}</div>
            </td>
            ${header.showBadge !== false ? `
              <td style="width: 36mm; vertical-align: middle; border-left: 2.5px solid ${primaryColor}; padding-left: 3mm;">
                <div style="font-size: 9.5pt; font-weight: bold; color: ${primaryColor}; line-height: 1.1;">${header.badgeText || 'OFFICIAL'}</div>
                <div style="font-size: 7.5pt; color: #64748B; line-height: 1.1;">${header.badgeSubtext || 'CORRESPONDENCE'}</div>
              </td>
            ` : ''}
          </tr>
        </table>
        <div style="border-bottom: 1.5px solid #CBD5E1; margin-bottom: 4mm;"></div>
      </div>
    `;
  }

  // Titles
  let titleHtml = '';
  if (config.documentTitle) {
    titleHtml += `<div style="text-align: center; font-weight: bold; font-size: ${titleSizePt}pt; color: ${primaryColor}; margin-top: 3mm;">${config.documentTitle}</div>`;
  }
  if (config.documentSubtitle) {
    titleHtml += `<div style="text-align: center; font-weight: bold; font-size: ${subtitleSizePt}pt; color: ${secondaryColor}; margin-bottom: 4mm;">${config.documentSubtitle}</div>`;
  }

  // Metadata Table
  let metaHtml = '';
  if (config.components?.metadataTable?.enabled && Array.isArray(config.components.metadataTable.rows)) {
    metaHtml = `
      <table style="width: 100%; border-collapse: collapse; margin: 4mm 0 6mm 0; font-size: ${bodySizePt}pt;">
        <thead>
          <tr>
            <th style="background: ${primaryColor}; color: #FFF; padding: 4px 8px; text-align: left; font-size: 8.5pt; width: 40%;">${config.components.metadataTable.col1Title || 'Attribute'}</th>
            <th style="background: ${primaryColor}; color: #FFF; padding: 4px 8px; text-align: left; font-size: 8.5pt;">${config.components.metadataTable.col2Title || 'Specifications'}</th>
          </tr>
        </thead>
        <tbody>
          ${config.components.metadataTable.rows.map(r => `
            <tr style="border-bottom: 1px solid #E2E8F0;">
              <td style="padding: 4px 8px; font-weight: bold; color: ${primaryColor};">${r.label || ''}</td>
              <td style="padding: 4px 8px; color: ${textColor};">${r.value || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Legal Notice
  let noticeHtml = '';
  if (config.components?.legalNotice?.enabled) {
    noticeHtml = `
      <div style="border-left: 3.5px solid ${primaryColor}; background: #F8FAFC; padding: 6px 10px; margin: 4mm 0 6mm 0; font-size: 8.5pt; color: ${textColor};">
        <strong style="color: ${primaryColor};">${config.components.legalNotice.prefix || 'LEGAL NOTICE: '}</strong>
        <span>${config.components.legalNotice.text || ''}</span>
      </div>
    `;
  }

  // Clauses
  const indentL1 = config.indents?.level1?.leftOffsetMm || 0;
  const l2Wrap = config.indents?.level2?.textStartWrapMm || 10;
  const l2Num = config.indents?.level2?.numberPositionMm || 0;
  const l3Wrap = config.indents?.level3?.textStartWrapMm || 20;
  const l3Num = config.indents?.level3?.numberPositionMm || 10;
  const l4Wrap = config.indents?.level4?.textStartWrapMm || 30;
  const l4Num = config.indents?.level4?.numberPositionMm || 20;
  const l5Wrap = config.indents?.level5?.textStartWrapMm || 40;
  const l5Num = config.indents?.level5?.numberPositionMm || 30;

  let bodyHtml = '';
  const blocks = Array.isArray(parsed) ? parsed : (parsed?.blocks || []);
  blocks.forEach(b => {
    if (b.type === 'level1') {
      const headingText = config.indents?.level1?.uppercase !== false ? b.text.toUpperCase() : b.text;
      bodyHtml += `
        <div style="font-weight: bold; font-size: ${h1SizePt}pt; color: ${primaryColor}; margin: 5mm 0 2mm ${indentL1}mm; page-break-after: avoid;">
          ${b.number ? `<span style="display: inline-block; min-width: 10mm;">${b.number}</span>` : ''}
          <span>${headingText}</span>
        </div>
      `;
    } else if (b.type === 'level2') {
      bodyHtml += `
        <div style="position: relative; padding-left: ${l2Wrap}mm; font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; margin: 1.5mm 0; text-align: justify;">
          <span style="position: absolute; left: ${l2Num}mm; top: 0; font-weight: bold; color: ${primaryColor};">${b.number}</span>
          <span style="color: ${textColor};">${b.text}</span>
        </div>
      `;
    } else if (b.type === 'level3') {
      bodyHtml += `
        <div style="position: relative; padding-left: ${l3Wrap}mm; font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; margin: 1.2mm 0; text-align: justify;">
          <span style="position: absolute; left: ${l3Num}mm; top: 0; font-weight: bold; color: ${primaryColor};">${b.number}</span>
          <span style="color: ${textColor};">${b.text}</span>
        </div>
      `;
    } else if (b.type === 'level4') {
      bodyHtml += `
        <div style="position: relative; padding-left: ${l4Wrap}mm; font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; margin: 1mm 0; text-align: justify;">
          <span style="position: absolute; left: ${l4Num}mm; top: 0; font-weight: bold; color: ${primaryColor};">${b.number}</span>
          <span style="color: ${textColor};">${b.text}</span>
        </div>
      `;
    } else if (b.type === 'level5') {
      bodyHtml += `
        <div style="position: relative; padding-left: ${l5Wrap}mm; font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; margin: 1mm 0; text-align: justify;">
          <span style="position: absolute; left: ${l5Num}mm; top: 0; font-weight: bold; color: ${primaryColor};">${b.number}</span>
          <span style="color: ${textColor};">${b.text}</span>
        </div>
      `;
    } else {
      bodyHtml += `<div style="font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; color: ${textColor}; margin: 1.5mm 0;">${b.text}</div>`;
    }
  });

  // Signatures
  let sigHtml = '';
  if (config.components?.signatures?.enabled && Array.isArray(config.components.signatures.signers)) {
    const signers = config.components.signatures.signers;
    sigHtml = `
      <div style="page-break-inside: avoid; margin-top: 6mm; padding-top: 4mm;">
        <div style="font-weight: bold; font-size: ${h1SizePt}pt; color: ${primaryColor}; margin-bottom: 2mm;">${config.components.signatures.title || 'ADOPTION AND SIGN-OFF RESOLUTION'}</div>
        <div style="font-size: ${bodySizePt}pt; line-height: 1.25; margin-bottom: 4mm; color: ${textColor};">${config.components.signatures.introText || ''}</div>
        <table style="width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm;">
          <tr>
            ${signers.map(s => `
              <td style="vertical-align: top; padding: 0 8px;">
                <div style="border-bottom: 1px solid #64748B; height: 16px; margin-bottom: 2px;"></div>
                <div style="font-size: 8pt; font-style: italic; color: #64748B; margin-bottom: 6px;">Signature</div>
                <div style="font-size: 9.5pt; font-weight: bold; color: ${textColor}; margin-bottom: 2px;">${s.name || ''}</div>
                <div style="font-size: 8.5pt; font-weight: bold; color: ${primaryColor}; margin-bottom: 6px;">${s.role || ''}</div>
                <div style="font-size: 8pt; color: #64748B;">Date: ${s.dateLabel || ''}</div>
              </td>
            `).join('')}
          </tr>
        </table>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4 portrait;
      margin-top: ${marginTop}mm;
      margin-right: ${marginRight}mm;
      margin-bottom: ${marginBottom + 6}mm;
      margin-left: ${marginLeft}mm;
    }
    body {
      font-family: ${fontFamily}, Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 0;
      color: ${textColor};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
  ${headerHtml}
  ${titleHtml}
  ${metaHtml}
  ${noticeHtml}
  ${bodyHtml}
  ${sigHtml}
</body>
</html>
  `;
}

// ── Fail-Safe PDF Conversion (Word COM with Headless Edge Fallback) ──
export async function convertDocxToPdf(docxPath, pdfPath, config = null, parsed = null) {
  // Strategy 1: Word COM Automation
  const psScript = `
$docPath = "${docxPath.replace(/\\/g, '\\\\')}"
$pdfPath = "${pdfPath.replace(/\\/g, '\\\\')}"
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($docPath)
    try {
        $doc.ExportAsFixedFormat($pdfPath, 17) # wdExportFormatPDF = 17
    } catch {
        $doc.SaveAs([ref]$pdfPath, [ref]17)
    }
    $doc.Close([ref]0) # wdDoNotSaveChanges = 0
    $doc = $null
    $word.Quit([ref]0)
    $word = $null
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
      timeout: 25000
    });
    if (fsSync.existsSync(pdfPath)) {
      return { success: true, pdfPath, method: 'word_com' };
    }
  } catch (wordErr) {
    console.warn('Word COM PDF conversion encountered issue, falling back to Browser PDF engine:', wordErr.message);
    try {
      await execPromise('powershell -Command "Stop-Process -Name WINWORD -Force -ErrorAction SilentlyContinue"');
    } catch (e) {}
  } finally {
    try { await fs.unlink(tempPs1); } catch (e) {}
  }

  // Strategy 2: Headless Edge / Chrome Fallback Engine
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  const browserPath = edgePaths.find(p => fsSync.existsSync(p));
  if (!browserPath) {
    throw new Error('PDF conversion failed: neither Word COM nor browser engine were accessible');
  }

  const htmlContent = generatePrintableHtml(config, parsed);
  const tempHtml = path.join(__dirname, 'uploads', `render_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.html`);
  await fs.writeFile(tempHtml, htmlContent, 'utf8');

  try {
    const cmd = `"${browserPath}" --headless --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${pdfPath}" "${tempHtml}"`;
    await execPromise(cmd, { timeout: 25000 });
    if (fsSync.existsSync(pdfPath)) {
      return { success: true, pdfPath, method: 'browser_headless' };
    }
    throw new Error('PDF output file was not produced by browser engine');
  } finally {
    try { await fs.unlink(tempHtml); } catch (e) {}
  }
}
