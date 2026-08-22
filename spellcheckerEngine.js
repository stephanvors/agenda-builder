/**
 * Spell & Grammar Checker Engine for Document Formatter Studio
 * Tailored specifically for English (South Africa) [en-ZA]
 * Covers South African spelling conventions (-ise, -our, -re, -programme),
 * SASA / SGB legal diction, common South African institutional terminology,
 * and grammar/punctuation rules.
 */

// ── US to en-ZA (South African English) Spelling Map ──
export const EN_ZA_SPELLING_MAP = {
  // -ize to -ise
  'organization': 'organisation',
  'organizations': 'organisations',
  'organizational': 'organisational',
  'authorize': 'authorise',
  'authorized': 'authorised',
  'authorizes': 'authorises',
  'authorizing': 'authorising',
  'authorization': 'authorisation',
  'authorizations': 'authorisations',
  'recognize': 'recognise',
  'recognized': 'recognised',
  'recognizes': 'recognises',
  'recognizing': 'recognising',
  'recognition': 'recognition',
  'standardize': 'standardise',
  'standardized': 'standardised',
  'standardization': 'standardisation',
  'analyze': 'analyse',
  'analyzed': 'analysed',
  'analyzes': 'analyses',
  'analyzing': 'analysing',
  'paralyze': 'paralyse',
  'paralyzed': 'paralysed',
  'categorize': 'categorise',
  'categorized': 'categorised',
  'categorization': 'categorisation',
  'prioritize': 'prioritise',
  'prioritized': 'prioritised',
  'prioritization': 'prioritisation',
  'emphasize': 'emphasise',
  'emphasized': 'emphasised',
  'emphasizing': 'emphasising',
  'criticize': 'criticise',
  'criticized': 'criticised',
  'utilize': 'utilise',
  'utilized': 'utilised',
  'utilization': 'utilisation',
  'maximize': 'maximise',
  'maximized': 'maximised',
  'minimize': 'minimise',
  'minimized': 'minimised',
  'summarize': 'summarise',
  'summarized': 'summarised',
  'summarization': 'summarisation',
  'itemized': 'itemised',
  'memorize': 'memorise',
  'finalize': 'finalise',
  'finalized': 'finalised',
  'finalization': 'finalisation',
  'apologize': 'apologise',
  'penalize': 'penalise',
  'penalized': 'penalised',
  'scrutinize': 'scrutinise',
  'scrutinized': 'scrutinised',
  'exercized': 'exercised',
  'specialized': 'specialised',
  'specialization': 'specialisation',
  'equalize': 'equalise',
  'equalized': 'equalised',
  'synchronize': 'synchronise',
  'synchronized': 'synchronised',

  // -or to -our
  'color': 'colour',
  'colors': 'colours',
  'colored': 'coloured',
  'coloring': 'colouring',
  'flavor': 'flavour',
  'flavors': 'flavours',
  'favor': 'favour',
  'favors': 'favours',
  'favorable': 'favourable',
  'favorably': 'favourably',
  'honor': 'honour',
  'honors': 'honours',
  'honorable': 'honourable',
  'honorary': 'honorary',
  'labor': 'labour',
  'labors': 'labours',
  'neighbor': 'neighbour',
  'neighbors': 'neighbours',
  'neighborhood': 'neighbourhood',
  'behavior': 'behaviour',
  'behaviors': 'behaviours',
  'behavioral': 'behavioural',
  'demeanor': 'demeanour',
  'endeavor': 'endeavour',
  'endeavors': 'endeavours',
  'rumor': 'rumour',
  'rumors': 'rumours',
  'odor': 'odour',
  'vigor': 'vigour',
  'rigor': 'rigour',
  'harbor': 'harbour',

  // -er to -re
  'center': 'centre',
  'centers': 'centres',
  'centered': 'centred',
  'theater': 'theatre',
  'theaters': 'theatres',
  'meter': 'metre',
  'meters': 'metres',
  'millimeter': 'millimetre',
  'millimeters': 'millimetres',
  'centimeter': 'centimetre',
  'centimeters': 'centimetres',
  'kilometer': 'kilometre',
  'kilometers': 'kilometres',
  'fiber': 'fibre',
  'fibers': 'fibres',
  'liter': 'litre',
  'liters': 'litres',
  'caliber': 'calibre',

  // -se / -ce (nouns vs verbs) & double l / others
  'defense': 'defence',
  'defenses': 'defences',
  'offense': 'offence',
  'offenses': 'offences',
  'pretense': 'pretence',
  'licensee': 'licensee',
  'traveling': 'travelling',
  'traveled': 'travelled',
  'traveler': 'traveller',
  'travelers': 'travellers',
  'canceling': 'cancelling',
  'canceled': 'cancelled',
  'modeling': 'modelling',
  'modeled': 'modelled',
  'signaling': 'signalling',
  'signaled': 'signalled',
  'program': 'programme',
  'programs': 'programmes',
  'programmed': 'programmed',
  'programming': 'programming',
  'catalog': 'catalogue',
  'catalogs': 'catalogues',
  'dialog': 'dialogue',
  'dialogs': 'dialogues',
  'monolog': 'monologue',
  'prolog': 'prologue',
  'fulfill': 'fulfil',
  'fulfillment': 'fulfilment',
  'enroll': 'enrol',
  'enrollment': 'enrolment',
  'install': 'instal',
  'installment': 'instalment',
  'skillful': 'skilful',
  'skillfully': 'skilfully',
  'wilful': 'wilful',
  'aging': 'ageing',
  'annex': 'annexure',
  'inquire': 'enquire',
  'inquiry': 'enquiry',
  'inquiries': 'enquiries',
};

// ── Common Legal & Statutory Typo Replacements ──
export const COMMON_TYPOS_MAP = {
  'governess': { fix: 'governance', reason: "In legal and institutional drafting, use 'governance' (the act or process of governing) rather than 'governess' (a tutor)." },
  'governes': { fix: 'governance', reason: "Typo for 'governance'." },
  'govering': { fix: 'governing', reason: "Typo for 'governing'." },
  'supercede': { fix: 'supersede', reason: "Spelled with 's' ('supersede'), not 'c'." },
  'priviledge': { fix: 'privilege', reason: "Typo for 'privilege'." },
  'priviledges': { fix: 'privileges', reason: "Typo for 'privileges'." },
  'independant': { fix: 'independent', reason: "Spelled with 'e' ('independent'), not 'a'." },
  'independance': { fix: 'independence', reason: "Spelled with 'e' ('independence')." },
  'seperate': { fix: 'separate', reason: "Spelled with 'ara' ('separate'), not 'era'." },
  'seperated': { fix: 'separated', reason: "Spelled with 'ara' ('separated')." },
  'seperately': { fix: 'separately', reason: "Spelled with 'ara' ('separately')." },
  'occurance': { fix: 'occurrence', reason: "Spelled with double 'r' and 'e' ('occurrence')." },
  'occurence': { fix: 'occurrence', reason: "Spelled with double 'r' ('occurrence')." },
  'occurances': { fix: 'occurrences', reason: "Spelled with double 'r' ('occurrences')." },
  'refered': { fix: 'referred', reason: "Spelled with double 'r' ('referred')." },
  'refering': { fix: 'referring', reason: "Spelled with double 'r' ('referring')." },
  'agrement': { fix: 'agreement', reason: "Typo for 'agreement'." },
  'agrements': { fix: 'agreements', reason: "Typo for 'agreements'." },
  'amendement': { fix: 'amendment', reason: "Typo for 'amendment' (no 'e' after 'd')." },
  'amendements': { fix: 'amendments', reason: "Typo for 'amendments'." },
  'quorom': { fix: 'quorum', reason: "Latin legal term is 'quorum'." },
  'qurom': { fix: 'quorum', reason: "Latin legal term is 'quorum'." },
  'chairpeson': { fix: 'chairperson', reason: "Typo for 'chairperson'." },
  'chairprson': { fix: 'chairperson', reason: "Typo for 'chairperson'." },
  'treasuror': { fix: 'treasurer', reason: "Spelled with 'er' ('treasurer')." },
  'treasurrer': { fix: 'treasurer', reason: "Spelled with single 'r' ('treasurer')." },
  'secretry': { fix: 'secretary', reason: "Typo for 'secretary'." },
  'secratary': { fix: 'secretary', reason: "Typo for 'secretary'." },
  'constituton': { fix: 'constitution', reason: "Typo for 'constitution'." },
  'contitution': { fix: 'constitution', reason: "Typo for 'constitution'." },
  'unanamously': { fix: 'unanimously', reason: "Spelled with 'i' ('unanimously')." },
  'unanimusly': { fix: 'unanimously', reason: "Spelled with 'ous' ('unanimously')." },
  'provinsional': { fix: 'provincial', reason: "Typo for 'provincial'." },
  'educater': { fix: 'educator', reason: "Spelled with 'or' ('educator')." },
  'educaters': { fix: 'educators', reason: "Spelled with 'or' ('educators')." },
  'resonsibility': { fix: 'responsibility', reason: "Typo for 'responsibility'." },
  'resonsibilities': { fix: 'responsibilities', reason: "Typo for 'responsibilities'." },
  'reponsibility': { fix: 'responsibility', reason: "Typo for 'responsibility'." },
  'reponsibilities': { fix: 'responsibilities', reason: "Typo for 'responsibilities'." },
  'convenne': { fix: 'convene', reason: "Typo for 'convene'." },
  'procede': { fix: 'proceed', reason: "Spelled with double 'e' ('proceed')." },
  'proceding': { fix: 'proceeding', reason: "Spelled with double 'e' ('proceeding')." },
  'procedings': { fix: 'proceedings', reason: "Spelled with double 'e' ('proceedings')." },
  'promulgatd': { fix: 'promulgated', reason: "Typo for 'promulgated'." },
  'promugated': { fix: 'promulgated', reason: "Typo for 'promulgated'." },
  'regulatons': { fix: 'regulations', reason: "Typo for 'regulations'." },
  'signatorys': { fix: 'signatories', reason: "Plural of signatory is 'signatories'." },
  'juridicial': { fix: 'juristic', reason: "In South African law, SASA uses the term 'juristic person'." },
  'jurdical': { fix: 'juristic', reason: "In South African law, use 'juristic person'." },
  'disolusion': { fix: 'dissolution', reason: "Spelled with double 's' ('dissolution')." },
  'disolution': { fix: 'dissolution', reason: "Spelled with double 's' ('dissolution')." },
  'existance': { fix: 'existence', reason: "Spelled with 'e' ('existence')." },
  'consensous': { fix: 'consensus', reason: "Spelled 'consensus'." },
  'concensus': { fix: 'consensus', reason: "Spelled with 's' ('consensus')." },
  'accountabilty': { fix: 'accountability', reason: "Typo for 'accountability'." },
  'transperancy': { fix: 'transparency', reason: "Spelled 'transparency'." },
  'comittee': { fix: 'committee', reason: "Spelled with double 'm', double 't', double 'e' ('committee')." },
  'commitee': { fix: 'committee', reason: "Spelled with double 't' ('committee')." },
  'committies': { fix: 'committees', reason: "Plural is 'committees'." },
  'applicabel': { fix: 'applicable', reason: "Typo for 'applicable'." }
};

// ── Whitelist of Valid SA / SASA / Legal / Latin terms ──
export const SA_LEGAL_WHITELIST = new Set([
  'lgaa', 'sgb', 'sasa', 'emis', 'doe', 'dbe', 'hod', 'mec', 'sace', 'caps', 'fet', 'get',
  'lady', 'grey', 'brummer', 'joe', 'gqabi', 'ekhephini', 'maletswai', 'sterkspruit', 'senqu',
  'isixhosa', 'xhosa', 'afrikaans', 'sesotho', 'sotho', 'zulu', 'isizulu',
  'juristic', 'signatory', 'signatories', 'quorum', 'proceedings', 'promulgated', 'co-opt', 'co-opted',
  'co-option', 'herein', 'hereinafter', 'thereto', 'thereof', 'therein', 'whereof', 'hereof', 'hereunder',
  'mutatis', 'mutandis', 'inter', 'alia', 'prima', 'facie', 'sub', 'judice', 'ultra', 'vires',
  'ipso', 'facto', 'bona', 'fide', 'ex', 'officio', 'pro', 'rata', 'ad', 'hoc', 'in', 'camera',
  'learners', 'learner', 'educator', 'educators', 'headmaster', 'principal', 'treasurer', 'chairperson',
  'vice-chairperson', 'secretary', 'constitution', 'bylaws', 'annexure', 'annexures', 'resolution',
  'resolutions', 'consensus', 'sub-clause', 'sub-clauses', 'subclause', 'subclauses', 'sub-item',
  'sub-items', 'itemised', 'unanimously', 'prescribed', 'exercising', 'dissolution', 'safekeeping'
]);

/**
 * Run full English (South Africa) spell & grammar inspection
 * @param {string} text - Raw input document text
 * @returns {object} Inspection results with issues list and statistics
 */
export function checkDocText(text) {
  if (!text || typeof text !== 'string') {
    return { issues: [], summary: { total: 0, enZa: 0, spelling: 0, grammar: 0, legal: 0 } };
  }

  const lines = text.split(/\r?\n/);
  const issues = [];
  let globalCharOffset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // 1. Check Grammar & Punctuation at Line Level
    checkLineGrammar(line, lineNum, globalCharOffset, issues);

    // 2. Check Words (en-ZA Spelling, Common Typos, Legal Diction)
    checkLineWords(line, lineNum, globalCharOffset, issues);

    globalCharOffset += line.length + 1; // +1 for newline
  }

  const summary = {
    total: issues.length,
    enZa: issues.filter(i => i.type === 'en_za').length,
    spelling: issues.filter(i => i.type === 'spelling').length,
    legal: issues.filter(i => i.type === 'legal_term').length,
    grammar: issues.filter(i => i.type === 'grammar' || i.type === 'punctuation').length,
  };

  return { issues, summary };
}

function checkLineGrammar(line, lineNum, lineOffset, issues) {
  // A. Check for repeated consecutive words ("the the", "in in", "of of")
  const repeatRegex = /\b([a-zA-Z]{2,})\s+\1\b/gi;
  let match;
  while ((match = repeatRegex.exec(line)) !== null) {
    issues.push({
      id: `iss_rep_${lineNum}_${match.index}`,
      type: 'grammar',
      category: 'Repeated Word',
      line: lineNum,
      index: match.index,
      globalIndex: lineOffset + match.index,
      length: match[0].length,
      original: match[0],
      suggestion: match[1],
      message: `Repeated word '${match[1]}'. Consider removing the duplicate.`,
      rule: 'Duplicate Word',
    });
  }

  // B. Check for space before comma/period/colon/semicolon ("school , and")
  const spacePunctRegex = /\s+([\,\.\:\;\?\!])/g;
  while ((match = spacePunctRegex.exec(line)) !== null) {
    if (match.index > 0 && !/\d\s+\./.test(line.substr(match.index - 2, 4))) {
      issues.push({
        id: `iss_spc_${lineNum}_${match.index}`,
        type: 'punctuation',
        category: 'Punctuation Spacing',
        line: lineNum,
        index: match.index,
        globalIndex: lineOffset + match.index,
        length: match[0].length,
        original: match[0],
        suggestion: match[1],
        message: `Stray whitespace before punctuation mark '${match[1]}'.`,
        rule: 'Spacing Before Punctuation',
      });
    }
  }

  // C. Check for South African Act Capitalization
  const actRegex = /\b(south african schools act|eastern cape school education act)\b/gi;
  while ((match = actRegex.exec(line)) !== null) {
    const matchedText = match[0];
    const properTitle = matchedText
      .split(' ')
      .map(w => (['act'].includes(w.toLowerCase()) ? 'Act' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
    if (matchedText !== properTitle) {
      issues.push({
        id: `iss_act_${lineNum}_${match.index}`,
        type: 'legal_term',
        category: 'Statute Capitalisation',
        line: lineNum,
        index: match.index,
        globalIndex: lineOffset + match.index,
        length: matchedText.length,
        original: matchedText,
        suggestion: properTitle,
        message: `Formal statutory names must be capitalized in South African legal drafting ('${properTitle}').`,
        rule: 'Statute Title Casing',
      });
    }
  }

  // D. Check for phrase "minutes of the proceeding" -> "minutes of the proceedings"
  const proceedingRegex = /\b(minutes\s+of\s+the\s+proceeding)\b/gi;
  while ((match = proceedingRegex.exec(line)) !== null) {
    issues.push({
      id: `iss_proc_${lineNum}_${match.index}`,
      type: 'legal_term',
      category: 'Legal Plural Agreement',
      line: lineNum,
      index: match.index,
      globalIndex: lineOffset + match.index,
      length: match[0].length,
      original: match[0],
      suggestion: 'minutes of the proceedings',
      message: "In legal meeting records, use plural 'minutes of the proceedings'.",
      rule: 'Legal Plural',
    });
  }
}

function checkLineWords(line, lineNum, lineOffset, issues) {
  // Tokenize words, preserving index
  const wordRegex = /\b[a-zA-Z\-\']+\b/g;
  let match;

  while ((match = wordRegex.exec(line)) !== null) {
    const originalWord = match[0];
    const cleanWord = originalWord.toLowerCase().replace(/^\'+|\'+$/g, '');
    const wordIdx = match.index;

    if (!cleanWord || cleanWord.length < 2 || /^\d+$/.test(cleanWord)) continue;
    if (SA_LEGAL_WHITELIST.has(cleanWord)) continue;

    // 1. Check Specific Common Typos / Legal Terminology
    if (COMMON_TYPOS_MAP[cleanWord]) {
      const entry = COMMON_TYPOS_MAP[cleanWord];
      const suggestion = matchCase(originalWord, entry.fix);
      issues.push({
        id: `iss_typo_${lineNum}_${wordIdx}`,
        type: 'legal_term',
        category: 'Legal Diction / Typo',
        line: lineNum,
        index: wordIdx,
        globalIndex: lineOffset + wordIdx,
        length: originalWord.length,
        original: originalWord,
        suggestion: suggestion,
        message: entry.reason,
        rule: 'Legal Diction',
      });
      continue;
    }

    // 2. Check US -> en-ZA Spelling Rule
    if (EN_ZA_SPELLING_MAP[cleanWord]) {
      const suggestedZA = matchCase(originalWord, EN_ZA_SPELLING_MAP[cleanWord]);
      issues.push({
        id: `iss_enza_${lineNum}_${wordIdx}`,
        type: 'en_za',
        category: 'English (South Africa)',
        line: lineNum,
        index: wordIdx,
        globalIndex: lineOffset + wordIdx,
        length: originalWord.length,
        original: originalWord,
        suggestion: suggestedZA,
        message: `In English (South Africa) legal copy, '${suggestedZA}' is standard (replacing '${originalWord}').`,
        rule: 'en-ZA Standard Spelling',
      });
      continue;
    }

    // 3. Heuristic en-ZA suffix transformations
    // -ize -> -ise (e.g. customized -> customised)
    if (/[a-z]{3,}ize$/i.test(originalWord)) {
      const zaWord = originalWord.replace(/ize$/i, m => (m === 'ize' ? 'ise' : 'ISE'));
      issues.push({
        id: `iss_ize_${lineNum}_${wordIdx}`,
        type: 'en_za',
        category: 'English (South Africa)',
        line: lineNum,
        index: wordIdx,
        globalIndex: lineOffset + wordIdx,
        length: originalWord.length,
        original: originalWord,
        suggestion: zaWord,
        message: `English (South Africa) uses '-ise' instead of US '-ize' ('${zaWord}').`,
        rule: '-ise vs -ize',
      });
      continue;
    }

    if (/[a-z]{3,}ized$/i.test(originalWord)) {
      const zaWord = originalWord.replace(/ized$/i, m => (m === 'ized' ? 'ised' : 'ISED'));
      issues.push({
        id: `iss_ized_${lineNum}_${wordIdx}`,
        type: 'en_za',
        category: 'English (South Africa)',
        line: lineNum,
        index: wordIdx,
        globalIndex: lineOffset + wordIdx,
        length: originalWord.length,
        original: originalWord,
        suggestion: zaWord,
        message: `English (South Africa) uses '-ised' instead of US '-ized' ('${zaWord}').`,
        rule: '-ised vs -ized',
      });
      continue;
    }

    if (/[a-z]{3,}ization$/i.test(originalWord)) {
      const zaWord = originalWord.replace(/ization$/i, m => (m === 'ization' ? 'isation' : 'ISATION'));
      issues.push({
        id: `iss_ization_${lineNum}_${wordIdx}`,
        type: 'en_za',
        category: 'English (South Africa)',
        line: lineNum,
        index: wordIdx,
        globalIndex: lineOffset + wordIdx,
        length: originalWord.length,
        original: originalWord,
        suggestion: zaWord,
        message: `English (South Africa) uses '-isation' instead of US '-ization' ('${zaWord}').`,
        rule: '-isation vs -ization',
      });
      continue;
    }
  }
}

/**
 * Helper to match capitalization of target word to original word
 */
function matchCase(original, replacement) {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original.charAt(0) === original.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.toLowerCase();
}
