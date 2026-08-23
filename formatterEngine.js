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
  LeaderType,
  ShadingType,
  UnderlineType,
} = docx;

const convertPointToHalfPoint = (pt) => Math.round(Number(pt || 10) * 2);
const escapeHtml = (str) => !str ? '' : String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Smart Text Hierarchy Parser ──
export function parseRawText(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split(/\r?\n/);
  const blocks = [];
  let autoL1Counter = 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // 0. Markdown Headings (# = Level 1, ## = Level 2, etc.)
    const mdMatch = rawLine.match(/^(#{1,5})\s+(.*)$/);
    if (mdMatch) {
      const lvl = mdMatch[1].length;
      let num = '';
      if (lvl === 1) {
        num = autoL1Counter + '.';
        autoL1Counter++;
      }
      blocks.push({
        type: lvl === 1 ? 'level1' : `level${lvl}`,
        level: lvl,
        number: num,
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

    // 5. Level 1: 1-level explicit numbering (e.g. 1. [Text] or 1. NAME or 1. Our Vision)
    const l1Match = rawLine.match(/^(\d+)\.\s+(.*)$/);
    if (l1Match) {
      const explicitNum = parseInt(l1Match[1], 10);
      if (!isNaN(explicitNum)) {
        autoL1Counter = explicitNum + 1;
      }
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
      const num = autoL1Counter + '.';
      autoL1Counter++;
      blocks.push({
        type: 'level1',
        level: 1,
        number: num,
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
      const num = autoL1Counter + '.';
      autoL1Counter++;
      blocks.push({
        type: 'level1',
        level: 1,
        number: num,
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
  const spaceBeforePt = Number(typo.spaceBeforePt !== undefined ? typo.spaceBeforePt : 0);
  const spaceAfterPt = Number(typo.spaceAfterPt !== undefined ? typo.spaceAfterPt : (typo.paragraphSpacingPt !== undefined ? typo.paragraphSpacingPt : 4));
  const spaceBefore = Math.round(spaceBeforePt * 20);
  const spaceAfter = Math.round(spaceAfterPt * 20);

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

    const docTitle = config.documentTitle || '';
    const headerTitle = docTitle ? `${hdr.title || 'LADY GREY ARTS ACADEMY'} • ${docTitle}` : (hdr.title || 'LADY GREY ARTS ACADEMY');

    return new Header({
      children: [
        new Paragraph({
          spacing: { before: 0, after: 80 },
          tabStops: [
            {
              type: TabStopType.RIGHT,
              position: convertMillimetersToTwip(bodyWidthMm),
            },
          ],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' }
          },
          children: [
            new TextRun({
              text: headerTitle.toUpperCase(),
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

  // Helper to create Footer: leave ONLY the page number in the form of X/Y (or specified format)
  function createDocumentFooter() {
    const footerRuns = [];
    const fmt = ftr.pageNumberFormat || 'x_slash_y';

    if (fmt === 'x_slash_y' || fmt === 'page_x_of_y' || !fmt) {
      footerRuns.push(
        new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '64748B', font: fontFamily }),
        new TextRun({ text: ' / ', size: 17, color: '64748B', font: fontFamily }),
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
  let currentBodyIndentMm = 0;
  let isFirstParagraphAfterHeading = true;

  parsedBlocks.forEach(block => {
    if (block.type === 'level1') {
      isFirstParagraphAfterHeading = true;
      const cfg = getLevelConfig(1);
      const l2Cfg = getLevelConfig(2);
      const tabPosMm = Number(l2Cfg.textWrapMm) || Number(l2Cfg.leftOffsetMm) || 10;
      currentBodyIndentMm = tabPosMm; // Subsequent body paragraphs line up under Level 1 text!

      const l1Size = Number(cfg.fontSizePt || cfg.sizePt || typo.heading1SizePt || 11);
      const l1SizeHps = convertPointToHalfPoint(l1Size);
      const l1Underline = cfg.underline ? { type: UnderlineType.SINGLE } : undefined;
      const headingText = cfg.uppercase !== false ? block.text.toUpperCase() : block.text;
      const l1SpaceBefore = Math.round(spaceBeforePt * 20);
      const l1SpaceAfter = Math.round(spaceAfterPt * 20);

      if (block.number) {
        docChildren.push(
          new Paragraph({
            spacing: { before: l1SpaceBefore, after: l1SpaceAfter },
            keepWithNext: true,
            keepLines: true,
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
                size: l1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
              new TextRun({
                text: '\t',
                size: l1SizeHps,
                font: fontFamily,
              }),
              new TextRun({
                text: headingText,
                bold: cfg.bold !== false,
                underline: l1Underline,
                size: l1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
            ],
          })
        );
      } else {
        docChildren.push(
          new Paragraph({
            spacing: { before: l1SpaceBefore, after: l1SpaceAfter },
            keepWithNext: true,
            keepLines: true,
            indent: { left: convertMillimetersToTwip(cfg.leftOffsetMm || 0) },
            children: [
              new TextRun({
                text: headingText,
                bold: cfg.bold !== false,
                underline: l1Underline,
                size: l1SizeHps,
                color: (cfg.color || primaryColor).replace('#', ''),
                font: fontFamily,
              }),
            ],
          })
        );
      }
    } else if (block.type === 'level2') {
      isFirstParagraphAfterHeading = true;
      const cfg = getLevelConfig(2);
      const leftOffsetMm = Number(cfg.leftOffsetMm) || 0;
      const hangingMm = Number(cfg.hangingIndentMm) || 10;
      const textWrapMm = Number(cfg.textWrapMm) || (leftOffsetMm + hangingMm);
      currentBodyIndentMm = textWrapMm;

      const l2Size = Number(cfg.fontSizePt || cfg.sizePt || typo.bodySizePt || 10);
      const l2SizeHps = convertPointToHalfPoint(l2Size);
      const l2Underline = cfg.underline ? { type: UnderlineType.SINGLE } : undefined;
      const l2Bold = cfg.bold === true;
      const l2Text = cfg.uppercase === true ? block.text.toUpperCase() : block.text;

      docChildren.push(
        new Paragraph({
          spacing: { before: spaceBefore, after: spaceAfter, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          keepWithNext: true,
          keepLines: true,
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
              size: l2SizeHps,
              color: (cfg.color || primaryColor).replace('#', ''),
              font: fontFamily,
            }),
            new TextRun({
              text: '\t',
              size: l2SizeHps,
              font: fontFamily,
            }),
            new TextRun({
              text: l2Text,
              bold: l2Bold,
              underline: l2Underline,
              italic: cfg.italic === true,
              size: l2SizeHps,
              color: textColor,
              font: fontFamily,
            }),
          ],
        })
      );
    } else if (block.type === 'level3' || block.type === 'level4' || block.type === 'level5') {
      isFirstParagraphAfterHeading = true;
      const lvlNum = block.level || (block.type === 'level3' ? 3 : block.type === 'level4' ? 4 : 5);
      const cfg = getLevelConfig(lvlNum);

      const leftOffsetMm = Number(cfg.leftOffsetMm) || (lvlNum - 1) * 10;
      const hangingMm = Number(cfg.hangingIndentMm) || 10;
      const textWrapMm = Number(cfg.textWrapMm) || leftOffsetMm;
      currentBodyIndentMm = textWrapMm;

      const lvlSize = Number(cfg.fontSizePt || cfg.sizePt || typo.bodySizePt || 10);
      const lvlSizeHps = convertPointToHalfPoint(lvlSize);
      const lvlUnderline = cfg.underline ? { type: UnderlineType.SINGLE } : undefined;
      const lvlBold = cfg.bold === true;
      const lvlText = cfg.uppercase === true ? block.text.toUpperCase() : block.text;

      docChildren.push(
        new Paragraph({
          spacing: { before: spaceBefore, after: spaceAfter, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          keepWithNext: true,
          keepLines: true,
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
              size: lvlSizeHps,
              color: (cfg.color || primaryColor).replace('#', ''),
              font: fontFamily,
            }),
            new TextRun({
              text: '\t',
              size: lvlSizeHps,
              font: fontFamily,
            }),
            new TextRun({
              text: lvlText,
              bold: lvlBold,
              underline: lvlUnderline,
              italic: cfg.italic === true,
              size: lvlSizeHps,
              color: textColor,
              font: fontFamily,
            }),
          ],
        })
      );
    } else {
      // General Body text: lines up under the active section/clause header text!
      const topSpace = isFirstParagraphAfterHeading ? 0 : spaceBefore;
      isFirstParagraphAfterHeading = false;
      docChildren.push(
        new Paragraph({
          spacing: { before: topSpace, after: spaceAfter, line: lineSpacing },
          alignment: AlignmentType.BOTH,
          keepLines: true,
          indent: { left: convertMillimetersToTwip(currentBodyIndentMm) },
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

  // 5. Sign-off Resolution Signature Block (Held together as one single unit, always starts on new page)
  if (comps.signatures && comps.signatures.enabled && Array.isArray(comps.signatures.signers) && comps.signatures.signers.length) {
    if (docChildren.length > 0) {
      docChildren.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }));
    }

    const signers = comps.signatures.signers;
    const maxCols = Math.min(3, Math.max(1, signers.length));
    const colWidthMm = bodyWidthMm / maxCols;

    // Chunk signers into rows of at most 3
    const signerChunks = [];
    for (let i = 0; i < signers.length; i += 3) {
      signerChunks.push(signers.slice(i, i + 3));
    }

    let introStr = comps.signatures.introText || '';
    const rawTitle = config.documentTitle || '';
    if (rawTitle && introStr) {
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

    // 1. Resolution Title (clean paragraph, not inside table)
    if (comps.signatures.title) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
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

    // 2. Resolution Intro (clean paragraph, not inside table)
    if (introStr) {
      docChildren.push(
        new Paragraph({
          spacing: { before: 20, after: 120, line: lineSpacing },
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

    // 3. Bordered Signature Cards Table (thicker cell borders, spacer columns for gaps)
    const spacerMm = maxCols > 1 ? (maxCols === 3 ? 5 : 6) : 0;
    const totalSpacerWidthMm = (maxCols - 1) * spacerMm;
    const boxWidthMm = (bodyWidthMm - totalSpacerWidthMm) / maxCols;
    const boxInnerWidthTwip = convertMillimetersToTwip(boxWidthMm) - 320;
    const totalTableCols = maxCols + (maxCols > 1 ? maxCols - 1 : 0);
    const tableRows = [];

    signerChunks.forEach((chunk, chunkIdx) => {
      // Vertical spacer row between signature card rows
      if (chunkIdx > 0) {
        const spacerCells = [];
        for (let c = 0; c < totalTableCols; c++) {
          spacerCells.push(
            new TableCell({
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              margins: { left: 0, right: 0, top: 0, bottom: 0 },
              children: [new Paragraph({ spacing: { before: 160, after: 0 }, children: [] })],
            })
          );
        }
        tableRows.push(new TableRow({ cantSplit: true, children: spacerCells }));
      }

      const signatureCells = [];
      chunk.forEach((s, sIdx) => {
        // Horizontal spacer column between boxes
        if (sIdx > 0 && spacerMm > 0) {
          signatureCells.push(
            new TableCell({
              width: { size: convertMillimetersToTwip(spacerMm), type: WidthType.DXA },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              margins: { left: 0, right: 0, top: 0, bottom: 0 },
              children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })],
            })
          );
        }

        let nameVal = s.name ? s.name.trim() : '';
        if (nameVal.toLowerCase().startsWith('name:')) {
          nameVal = nameVal.replace(/^name:\s*/i, '');
        } else if (nameVal.toLowerCase().startsWith('surname, name:')) {
          nameVal = nameVal.replace(/^surname,\s*name:\s*/i, '');
        }
        nameVal = nameVal.replace(/^_+$/, '').trim();

        let dateVal = s.dateLabel ? s.dateLabel.trim() : '';
        if (dateVal.toLowerCase().startsWith('date:')) {
          dateVal = dateVal.replace(/^date:\s*/i, '');
        }
        dateVal = dateVal.replace(/^_+$/, '').trim();

        signatureCells.push(
          new TableCell({
            width: { size: convertMillimetersToTwip(boxWidthMm), type: WidthType.DXA },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: '94A3B8' },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '94A3B8' },
              left: { style: BorderStyle.SINGLE, size: 6, color: '94A3B8' },
              right: { style: BorderStyle.SINGLE, size: 6, color: '94A3B8' },
            },
            margins: { left: 160, right: 160, top: 100, bottom: 100 },
            children: [
              // 1. Generous room for signature
              new Paragraph({
                spacing: { before: 180, after: 0 },
                children: [],
              }),
              // 2. Clean baseline rule
              new Paragraph({
                spacing: { before: 0, after: 10 },
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 8, color: primaryColor }
                },
                children: [],
              }),
              // 3. Signature label (with blank line spacing after it)
              new Paragraph({
                spacing: { before: 0, after: 90 },
                keepWithNext: true,
                children: [
                  new TextRun({
                    text: 'SIGNATURE',
                    size: 14,
                    bold: true,
                    color: '64748B',
                    font: fontFamily,
                  }),
                ],
              }),
              // 4. Name (extended underline to right edge)
              new Paragraph({
                spacing: { before: 0, after: 15 },
                keepWithNext: true,
                tabStops: nameVal ? [] : [{ type: TabStopType.RIGHT, position: boxInnerWidthTwip, leader: LeaderType.UNDERSCORE }],
                children: nameVal
                  ? [new TextRun({ text: nameVal, bold: true, color: textColor, font: fontFamily, size: baseSizeHps })]
                  : [
                      new TextRun({ text: 'NAME:\t', bold: true, color: '64748B', font: fontFamily, size: baseSizeHps - 2 }),
                    ],
              }),
              // 5. Role
              new Paragraph({
                spacing: { before: 0, after: 20 },
                keepWithNext: true,
                children: [
                  new TextRun({
                    text: (s.role || 'SIGNATORY').toUpperCase(),
                    bold: true,
                    color: primaryColor,
                    font: fontFamily,
                    size: baseSizeHps - 1,
                  }),
                ],
              }),
              // 6. Date (Right-Justified and flush with right margin)
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 40, after: 0 },
                children: dateVal
                  ? [
                      new TextRun({ text: 'DATE: ', bold: true, color: '64748B', font: fontFamily, size: baseSizeHps - 2 }),
                      new TextRun({ text: dateVal, color: textColor, font: fontFamily, size: baseSizeHps - 2 }),
                    ]
                  : [
                      new TextRun({ text: 'DATE: ', bold: true, color: '64748B', font: fontFamily, size: baseSizeHps - 2 }),
                      new TextRun({ text: '________________________', color: '94A3B8', font: fontFamily, size: baseSizeHps - 2 }),
                    ],
              }),
            ],
          })
        );
      });

      // Fill remaining columns with invisible spacer + empty cells if chunk is short
      if (chunk.length < maxCols) {
        for (let k = chunk.length; k < maxCols; k++) {
          if (spacerMm > 0) {
            signatureCells.push(
              new TableCell({
                width: { size: convertMillimetersToTwip(spacerMm), type: WidthType.DXA },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.NONE },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE },
                },
                margins: { left: 0, right: 0, top: 0, bottom: 0 },
                children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })],
              })
            );
          }
          signatureCells.push(
            new TableCell({
              width: { size: convertMillimetersToTwip(boxWidthMm), type: WidthType.DXA },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              margins: { left: 0, right: 0, top: 0, bottom: 0 },
              children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })],
            })
          );
        }
      }

      tableRows.push(
        new TableRow({
          cantSplit: true,
          children: signatureCells,
        })
      );
    });

    docChildren.push(
      new Table({
        width: { size: convertMillimetersToTwip(bodyWidthMm), type: WidthType.DXA },
        alignment: AlignmentType.CENTER,
        cantSplit: true,
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: tableRows,
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
  const l1Cfg = config.hierarchy?.levels?.find(l => l.level === 1) || config.indents?.level1 || {};
  const l2Cfg = config.hierarchy?.levels?.find(l => l.level === 2) || config.indents?.level2 || {};
  const l3Cfg = config.hierarchy?.levels?.find(l => l.level === 3) || config.indents?.level3 || {};
  const l4Cfg = config.hierarchy?.levels?.find(l => l.level === 4) || config.indents?.level4 || {};
  const l5Cfg = config.hierarchy?.levels?.find(l => l.level === 5) || config.indents?.level5 || {};

  const indentL1 = l1Cfg.leftOffsetMm !== undefined ? l1Cfg.leftOffsetMm : 0;
  const l1SizePt = Number(l1Cfg.fontSizePt || l1Cfg.sizePt || config.typography?.heading1SizePt || 11);
  const l1Bold = l1Cfg.bold !== false;
  const l1Underline = l1Cfg.underline === true;
  const l1Upper = l1Cfg.uppercase !== false;

  const l2Wrap = l2Cfg.textWrapMm !== undefined ? l2Cfg.textWrapMm : (l2Cfg.textStartWrapMm || 10);
  const l2Num = l2Cfg.numberPosMm !== undefined ? l2Cfg.numberPosMm : (l2Cfg.numberPositionMm || 0);
  const l2SizePt = Number(l2Cfg.fontSizePt || l2Cfg.sizePt || config.typography?.bodySizePt || 10);
  const l2Bold = l2Cfg.bold === true;
  const l2Underline = l2Cfg.underline === true;
  const l2Upper = l2Cfg.uppercase === true;

  const l3Wrap = l3Cfg.textWrapMm !== undefined ? l3Cfg.textWrapMm : (l3Cfg.textStartWrapMm || 20);
  const l3Num = l3Cfg.numberPosMm !== undefined ? l3Cfg.numberPosMm : (l3Cfg.numberPositionMm || 10);
  const l3SizePt = Number(l3Cfg.fontSizePt || l3Cfg.sizePt || config.typography?.bodySizePt || 10);
  const l3Bold = l3Cfg.bold === true;
  const l3Underline = l3Cfg.underline === true;
  const l3Upper = l3Cfg.uppercase === true;

  const l4Wrap = l4Cfg.textWrapMm !== undefined ? l4Cfg.textWrapMm : (l4Cfg.textStartWrapMm || 30);
  const l4Num = l4Cfg.numberPosMm !== undefined ? l4Cfg.numberPosMm : (l4Cfg.numberPositionMm || 20);
  const l4SizePt = Number(l4Cfg.fontSizePt || l4Cfg.sizePt || config.typography?.bodySizePt || 10);
  const l4Bold = l4Cfg.bold === true;
  const l4Underline = l4Cfg.underline === true;
  const l4Upper = l4Cfg.uppercase === true;

  const l5Wrap = l5Cfg.textWrapMm !== undefined ? l5Cfg.textWrapMm : (l5Cfg.textStartWrapMm || 40);
  const l5Num = l5Cfg.numberPosMm !== undefined ? l5Cfg.numberPosMm : (l5Cfg.numberPositionMm || 30);
  const l5SizePt = Number(l5Cfg.fontSizePt || l5Cfg.sizePt || config.typography?.bodySizePt || 10);
  const l5Bold = l5Cfg.bold === true;
  const l5Underline = l5Cfg.underline === true;
  const l5Upper = l5Cfg.uppercase === true;

  const spaceBeforePt = Number(config.typography?.spaceBeforePt !== undefined ? config.typography.spaceBeforePt : 0);
  const spaceAfterPt = Number(config.typography?.spaceAfterPt !== undefined ? config.typography.spaceAfterPt : (config.typography?.paragraphSpacingPt !== undefined ? config.typography.paragraphSpacingPt : 4));

  let bodyHtml = '';
  let currentBodyIndentMm = 0;
  let isFirstParagraphAfterHeading = true;
  const blocks = Array.isArray(parsed) ? parsed : (parsed?.blocks || []);
  blocks.forEach(b => {
    if (b.type === 'level1') {
      isFirstParagraphAfterHeading = true;
      currentBodyIndentMm = l2Wrap; // Subsequent body paragraphs line up under Level 1 text!
      const headingText = l1Upper ? b.text.toUpperCase() : b.text;
      const textDecor = l1Underline ? 'underline' : 'none';
      const weight = l1Bold ? 'bold' : 'normal';
      const topMarginPt = spaceBeforePt;
      bodyHtml += `
        <div style="font-weight: ${weight}; text-decoration: ${textDecor}; font-size: ${l1SizePt}pt; color: ${primaryColor}; margin: ${topMarginPt}pt 0 ${spaceAfterPt}pt ${indentL1}mm; page-break-after: avoid;">
          ${b.number ? `<span style="display: inline-block; min-width: 10mm; text-decoration: none;">${b.number}</span>` : ''}
          <span>${headingText}</span>
        </div>
      `;
    } else if (b.type === 'level2') {
      isFirstParagraphAfterHeading = true;
      currentBodyIndentMm = l2Wrap;
      const l2Text = l2Upper ? b.text.toUpperCase() : b.text;
      const textDecor = l2Underline ? 'underline' : 'none';
      const weight = l2Bold ? 'bold' : 'normal';
      bodyHtml += `
        <div style="position: relative; padding-left: ${l2Wrap}mm; font-size: ${l2SizePt}pt; font-weight: ${weight}; text-decoration: ${textDecor}; line-height: ${lineSpacing}; margin: ${spaceBeforePt}pt 0 ${spaceAfterPt}pt 0; text-align: justify; page-break-after: avoid; break-after: avoid;">
          <span style="position: absolute; left: ${l2Num}mm; top: 0; font-weight: bold; color: ${primaryColor}; text-decoration: none;">${b.number}</span>
          <span style="color: ${textColor};">${l2Text}</span>
        </div>
      `;
    } else if (b.type === 'level3') {
      isFirstParagraphAfterHeading = true;
      currentBodyIndentMm = l3Wrap;
      const l3Text = l3Upper ? b.text.toUpperCase() : b.text;
      const textDecor = l3Underline ? 'underline' : 'none';
      const weight = l3Bold ? 'bold' : 'normal';
      bodyHtml += `
        <div style="position: relative; padding-left: ${l3Wrap}mm; font-size: ${l3SizePt}pt; font-weight: ${weight}; text-decoration: ${textDecor}; line-height: ${lineSpacing}; margin: ${spaceBeforePt}pt 0 ${spaceAfterPt}pt 0; text-align: justify; page-break-after: avoid; break-after: avoid;">
          <span style="position: absolute; left: ${l3Num}mm; top: 0; font-weight: bold; color: ${primaryColor}; text-decoration: none;">${b.number}</span>
          <span style="color: ${textColor};">${l3Text}</span>
        </div>
      `;
    } else if (b.type === 'level4') {
      isFirstParagraphAfterHeading = true;
      currentBodyIndentMm = l4Wrap;
      const l4Text = l4Upper ? b.text.toUpperCase() : b.text;
      const textDecor = l4Underline ? 'underline' : 'none';
      const weight = l4Bold ? 'bold' : 'normal';
      bodyHtml += `
        <div style="position: relative; padding-left: ${l4Wrap}mm; font-size: ${l4SizePt}pt; font-weight: ${weight}; text-decoration: ${textDecor}; line-height: ${lineSpacing}; margin: ${spaceBeforePt}pt 0 ${spaceAfterPt}pt 0; text-align: justify; page-break-after: avoid; break-after: avoid;">
          <span style="position: absolute; left: ${l4Num}mm; top: 0; font-weight: bold; color: ${primaryColor}; text-decoration: none;">${b.number}</span>
          <span style="color: ${textColor};">${l4Text}</span>
        </div>
      `;
    } else if (b.type === 'level5') {
      isFirstParagraphAfterHeading = true;
      currentBodyIndentMm = l5Wrap;
      const l5Text = l5Upper ? b.text.toUpperCase() : b.text;
      const textDecor = l5Underline ? 'underline' : 'none';
      const weight = l5Bold ? 'bold' : 'normal';
      bodyHtml += `
        <div style="position: relative; padding-left: ${l5Wrap}mm; font-size: ${l5SizePt}pt; font-weight: ${weight}; text-decoration: ${textDecor}; line-height: ${lineSpacing}; margin: ${spaceBeforePt}pt 0 ${spaceAfterPt}pt 0; text-align: justify; page-break-after: avoid; break-after: avoid;">
          <span style="position: absolute; left: ${l5Num}mm; top: 0; font-weight: bold; color: ${primaryColor}; text-decoration: none;">${b.number}</span>
          <span style="color: ${textColor};">${l5Text}</span>
        </div>
      `;
    } else {
      const topMargin = isFirstParagraphAfterHeading ? 0 : spaceBeforePt;
      isFirstParagraphAfterHeading = false;
      bodyHtml += `<div style="padding-left: ${currentBodyIndentMm}mm; font-size: ${bodySizePt}pt; line-height: ${lineSpacing}; color: ${textColor}; margin: ${topMargin}pt 0 ${spaceAfterPt}pt 0; text-align: justify;">${b.text}</div>`;
    }
  });

  // Signatures
  let sigHtml = '';
  if (config.components?.signatures?.enabled && Array.isArray(config.components.signatures.signers)) {
    const signers = config.components.signatures.signers;
    const maxCols = Math.min(3, Math.max(1, signers.length));
    const signerChunks = [];
    for (let i = 0; i < signers.length; i += 3) {
      signerChunks.push(signers.slice(i, i + 3));
    }

    sigHtml = `
      <div style="page-break-before: always; break-before: page; margin-top: 6mm; padding-top: 4mm;">
        <div style="font-weight: 800; font-size: ${h1SizePt}pt; color: ${primaryColor}; margin-bottom: 2mm; letter-spacing: 0.5px;">${config.components.signatures.title || 'ADOPTION AND SIGN-OFF RESOLUTION'}</div>
        <div style="font-size: ${bodySizePt}pt; line-height: 1.35; margin-bottom: 4mm; color: ${textColor}; text-align: justify;">${config.components.signatures.introText || ''}</div>
        <table style="width: 100%; border-collapse: separate; border-spacing: 5mm 4mm; table-layout: fixed; margin-top: 2mm;">
          ${signerChunks.map(chunk => `
            <tr>
              ${chunk.map(s => {
                let nVal = (s.name || '').replace(/^_+$/, '').trim();
                let dVal = (s.dateLabel || '').replace(/^_+$/, '').trim();
                return `
                  <td style="width: ${100 / maxCols}%; vertical-align: top; background: #FFFFFF; border: 1.5px solid #94A3B8; border-radius: 3px; padding: 12px 14px; box-sizing: border-box;">
                    <div style="height: 15mm; min-height: 15mm;"></div>
                    <div style="border-bottom: 1.5px solid ${primaryColor}; margin-bottom: 2px;"></div>
                    <div style="font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8px; color: #64748B; font-weight: bold; margin-bottom: 14px;">Signature</div>
                    <div style="font-size: 9.5pt; font-weight: bold; color: ${textColor}; margin-bottom: 2px; line-height: 1.2;">
                      ${nVal ? escapeHtml(nVal) : `<div style="display: flex; align-items: flex-end; gap: 4px;"><span style="color: #64748B; font-size: 8pt; font-weight: 600; white-space: nowrap;">NAME:</span> <span style="flex: 1; border-bottom: 1px solid #94A3B8; min-height: 1px; margin-bottom: 2px;"></span></div>`}
                    </div>
                    <div style="font-size: 8.5pt; font-weight: bold; color: ${primaryColor}; text-transform: uppercase; margin-bottom: 4px; line-height: 1.2;">${escapeHtml(s.role || 'SIGNATORY')}</div>
                    <div style="text-align: right; font-size: 8pt; color: #64748B; line-height: 1.2; margin-top: 6px;">
                      <span style="font-weight: bold;">DATE:</span> 
                      ${dVal ? `<span style="color: ${textColor}; font-weight: 600;">${escapeHtml(dVal)}</span>` : `<span style="display: inline-block; width: 28mm; border-bottom: 1px solid #94A3B8; margin-bottom: 2px;"></span>`}
                    </div>
                  </td>
                `;
              }).join('')}
              ${chunk.length < maxCols ? `<td colspan="${maxCols - chunk.length}" style="border: none; background: transparent;"></td>` : ''}
            </tr>
          `).join('')}
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
      orphans: 3;
      widows: 3;
    }
    body {
      font-family: ${fontFamily}, Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 0;
      color: ${textColor};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      orphans: 3;
      widows: 3;
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
