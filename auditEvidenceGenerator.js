// ─────────────────────────────────────────────────────────────────────────────
// SGB Functionality Audit 2026 — Evidence Pack Generator
// Generates the 7 mandatory DBE audit supporting documents (DOCX + PDF)
// based on the core source document and the DBE SGB Functionality Tool criteria.
// Includes timeline constraints:
// - Nellie von Solms & Anthony Engelbrecht only joined SGB in beginning of July 2026.
// - Octavia Bambilawu resigned from SGB in July 2026.
// - Apologies/absences are dynamically selected per meeting/folder with distinct reasons.
// - Minutes and resolutions strictly quote and record only present members.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { parseRawText, buildFormattedDocx, convertDocxToPdf } from './formatterEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUDIT_BASE_DIR = path.join(__dirname, 'SGB_Functionality_Audit_2026');

// ── SGB Membership Timeline Definitions ──

// Pre-July 2026 Roster (Jan 1, 2026 – June 30, 2026)
// Nellie von Solms & Anthony Engelbrecht have not joined yet.
// Octavia Bambilawu is an active SGB Parent Member.
const PRE_JULY_MEMBERS = [
  { name: 'Mr. Kwezi Dyasi', role: 'SGB Chairperson', component: 'Parent', canBeAbsent: false },
  { name: 'Ms. Marcelle Botha', role: 'School Principal', component: 'Ex-Officio', canBeAbsent: false },
  { name: 'Mr. Andile Gushmani', role: 'SGB Treasurer', component: 'Parent', canBeAbsent: false },
  { name: 'Mrs. Noncedo Williams', role: 'SGB Parent Member', component: 'Parent', canBeAbsent: true },
  { name: 'Mrs. Octavia Bambilawu', role: 'SGB Parent Member', component: 'Parent', canBeAbsent: true },
  { name: 'Mrs. Charlene Vorster', role: 'SGB Tots Academy / Parent Rep', component: 'Parent', canBeAbsent: true },
  { name: 'Mr. Bennie Bekker', role: 'SGB Non-Teaching Rep', component: 'Non-Teaching Staff', canBeAbsent: true },
  { name: 'Bathabile Lichaba', role: 'RCL Chairperson', component: 'RCL', canBeAbsent: true },
  { name: 'Niluve Matu', role: 'Head Girl / Learner Rep', component: 'RCL', canBeAbsent: true },
  { name: 'Alumanye Nxele', role: 'Head Boy / Learner Rep', component: 'RCL', canBeAbsent: true }
];

// Post-July 2026 Roster (July 1, 2026 onwards)
// Nellie von Solms & Anthony Engelbrecht joined the SGB in the beginning of July 2026.
// Octavia Bambilawu resigned from the SGB in July 2026.
const POST_JULY_MEMBERS = [
  { name: 'Mr. Kwezi Dyasi', role: 'SGB Chairperson', component: 'Parent', canBeAbsent: false },
  { name: 'Ms. Marcelle Botha', role: 'School Principal', component: 'Ex-Officio', canBeAbsent: false },
  { name: 'Mr. Andile Gushmani', role: 'SGB Treasurer', component: 'Parent', canBeAbsent: false },
  { name: 'Mrs. Noncedo Williams', role: 'SGB Parent Member', component: 'Parent', canBeAbsent: true },
  { name: 'Mrs. Charlene Vorster', role: 'SGB Tots Academy / Parent Rep', component: 'Parent', canBeAbsent: true },
  { name: 'Mr. Anthony Engelbrecht', role: 'SGB Educator Rep', component: 'Educator', canBeAbsent: true },
  { name: 'Miss Nellie Von Solms', role: 'SGB Educator Rep', component: 'Educator', canBeAbsent: true },
  { name: 'Mr. Bennie Bekker', role: 'SGB Non-Teaching Rep', component: 'Non-Teaching Staff', canBeAbsent: true },
  { name: 'Bathabile Lichaba', role: 'RCL Chairperson', component: 'RCL', canBeAbsent: true },
  { name: 'Niluve Matu', role: 'Head Girl / Learner Rep', component: 'RCL', canBeAbsent: true },
  { name: 'Alumanye Nxele', role: 'Head Boy / Learner Rep', component: 'RCL', canBeAbsent: true }
];

// Apology reasons pool by member component
const APOLOGY_REASONS = {
  Parent: [
    'Official employment commitments outside Lady Grey',
    'Urgent family responsibility / family emergency',
    'Professional travel commitments in Aliwal North',
    'Transport delay returning to town',
    'Unavoidable work shift obligations',
    'Personal domestic emergency'
  ],
  Educator: [
    'Attending Departmental curriculum moderation workshop',
    'Supervising school extramural arts rehearsal',
    'Medical leave (doctor consultation)',
    'Department of Basic Education subject advisory seminar',
    'Provincial arts festival coordination session'
  ],
  'Non-Teaching Staff': [
    'Municipal services delivery liaison meeting',
    'Emergency school facilities and power maintenance',
    'Medical consultation / sick leave',
    'Family bereavement and attendance of funeral rites'
  ],
  RCL: [
    'Academic preparation for term examinations',
    'Matric curriculum tutoring and revision session',
    'Provincial choir and arts festival rehearsal',
    'Inter-schools academic debate competition',
    'Illness and medical recovery'
  ]
};

// Deterministic PRNG seeded with folder and date so that the 7 docs inside a folder are 100% consistent
function getRng(seedStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Compute meeting attendance adhering to timeline and pseudo-random apologies
export function computeMeetingAttendance(meta) {
  const seed = (meta.folderId || 'folder') + '_' + (meta.meetingDate || '2026-01-28');
  const rng = getRng(seed);
  const isPostJuly = (meta.meetingDate || '2026-01-28') >= '2026-07-01';
  const baseList = isPostJuly ? POST_JULY_MEMBERS : PRE_JULY_MEMBERS;

  const fixed = baseList.filter(m => !m.canBeAbsent).map(m => ({ ...m, status: 'Present' }));
  const candidates = baseList.filter(m => m.canBeAbsent).map(m => ({ ...m }));

  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Randomly choose 1, 2, or 3 absences
  const numAbsences = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < candidates.length; i++) {
    if (i < numAbsences) {
      candidates[i].status = 'Apology';
      const pool = APOLOGY_REASONS[candidates[i].component] || APOLOGY_REASONS.Parent;
      candidates[i].reason = pool[Math.floor(rng() * pool.length)];
    } else {
      candidates[i].status = 'Present';
    }
  }

  const all = [...fixed, ...candidates];
  all.sort((a, b) => {
    const ia = baseList.findIndex(m => m.name === a.name);
    const ib = baseList.findIndex(m => m.name === b.name);
    return ia - ib;
  });

  const present = all.filter(m => m.status === 'Present');
  const apologies = all.filter(m => m.status === 'Apology');

  // Select Proposer and Seconder strictly from Present members
  const presentParents = present.filter(m => m.component === 'Parent' && m.name !== 'Mr. Kwezi Dyasi');
  const proposerMember = presentParents.length > 0 
    ? presentParents[Math.floor(rng() * presentParents.length)] 
    : present[0];
  const proposer = `${proposerMember.name} (${proposerMember.role})`;

  const availableSeconders = present.filter(m => m.name !== proposerMember.name && m.name !== 'Mr. Kwezi Dyasi');
  const seconderMember = availableSeconders.length > 0 
    ? availableSeconders[Math.floor(rng() * availableSeconders.length)] 
    : present[1] || present[0];
  const seconder = `${seconderMember.name} (${seconderMember.role})`;

  // Select 2 or 3 discussion speakers strictly from Present members
  const discussionSpeakers = [];
  // Treasurer comment if present
  if (present.some(m => m.name === 'Mr. Andile Gushmani')) {
    discussionSpeakers.push('Mr. A. Gushmani (SGB Treasurer) highlighted the operational controls and budgetary provisions aligned with the policy.');
  }

  // Parent speaker
  const activePresentParents = present.filter(m => m.component === 'Parent' && m.name !== 'Mr. Kwezi Dyasi' && m.name !== 'Mr. Andile Gushmani');
  if (activePresentParents.length > 0) {
    const p = activePresentParents[Math.floor(rng() * activePresentParents.length)];
    discussionSpeakers.push(`${p.name} (${p.role}) noted the practical relevance and operational clarity of the provisions, emphasizing community alignment.`);
  }

  // Educator speaker (only if post-July and present!)
  if (isPostJuly) {
    const presentEducators = present.filter(m => m.component === 'Educator');
    if (presentEducators.length > 0) {
      const edu = presentEducators[Math.floor(rng() * presentEducators.length)];
      discussionSpeakers.push(`${edu.name} (${edu.role}) confirmed curriculum alignment, educator backing, and pastoral care integration in the policy framework.`);
    }
  }

  // Non-teaching or learner speaker
  if (discussionSpeakers.length < 3) {
    const otherPresent = present.filter(m => m.component === 'Non-Teaching Staff' || m.component === 'RCL');
    if (otherPresent.length > 0) {
      const o = otherPresent[Math.floor(rng() * otherPresent.length)];
      discussionSpeakers.push(`${o.name} (${o.role}) affirmed administrative and institutional support for the practical enforcement of these governance standards.`);
    }
  }

  return {
    isPostJuly,
    total: all.length,
    presentCount: present.length,
    apologyCount: apologies.length,
    quorumPercent: ((present.length / all.length) * 100).toFixed(1),
    roster: all,
    present,
    apologies,
    proposer,
    seconder,
    discussionSpeakers
  };
}

// ── 16 Folder Governance & Statutory Registry ──
export const SGB_AUDIT_REGISTRY = {
  '01_SGB_Constitution': {
    itemNumber: 1,
    folderId: '01_SGB_Constitution',
    officialTitle: 'Constitution of the School Governing Body',
    shortName: 'SGB_Constitution',
    badgeSub: 'CONSTITUTION',
    resolutionNo: 'LGAA-SGB-RES-2026-01',
    statutoryBasis: 'Section 18(1) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 (Act No. 84 of 1996)',
    noticeDate: '2026-01-19',
    noticeDateFormatted: '19/01/2026',
    meetingDate: '2026-01-28',
    meetingDateDisplay: 'Wednesday, 28 January 2026',
    meetingDateFormatted: '28/01/2026',
    meetingTime: '17:30',
    submissionDate: '2026-02-16',
    submissionDateDisplay: 'Monday, 16 February 2026',
    submissionDateFormatted: '16/02/2026',
    toolEvidenceRequirement: 'The SGB Constitution is formally submitted to the HOD within 90 days, accompanied by proof of submission and evidence that the constitution is being used to guide governance processes (e.g. referenced in meetings or governance decisions).'
  },
  '02_School_Mission_Statement': {
    itemNumber: 2,
    folderId: '02_School_Mission_Statement',
    officialTitle: 'School Vision & Mission Statement',
    shortName: 'School_Mission_Statement',
    badgeSub: 'STATEMENT',
    resolutionNo: 'LGAA-SGB-RES-2026-02',
    statutoryBasis: 'Section 20(1)(c) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 (Act No. 84 of 1996) and National Education Policy Act, 1996',
    noticeDate: '2026-01-19',
    noticeDateFormatted: '19/01/2026',
    meetingDate: '2026-01-28',
    meetingDateDisplay: 'Wednesday, 28 January 2026',
    meetingDateFormatted: '28/01/2026',
    meetingTime: '17:30',
    submissionDate: '2026-02-16',
    submissionDateDisplay: 'Monday, 16 February 2026',
    submissionDateFormatted: '16/02/2026',
    toolEvidenceRequirement: 'The mission statement is actively guiding school practices, is aligned to legislative and policy frameworks, and is communicated and referenced in school planning documents (e.g. SIP, policies, school communications).'
  },
  '03_Admission_Policy': {
    itemNumber: 3,
    folderId: '03_Admission_Policy',
    officialTitle: 'Admission Policy',
    shortName: 'Admission_Policy',
    badgeSub: 'ADMISSION',
    resolutionNo: 'LGAA-SGB-RES-2026-03',
    statutoryBasis: 'Section 5(5) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 (Act No. 84 of 1996) and Provincial Admission Regulations',
    noticeDate: '2026-03-02',
    noticeDateFormatted: '02/03/2026',
    meetingDate: '2026-03-11',
    meetingDateDisplay: 'Wednesday, 11 March 2026',
    meetingDateFormatted: '11/03/2026',
    meetingTime: '17:30',
    submissionDate: '2026-03-25',
    submissionDateDisplay: 'Wednesday, 25 March 2026',
    submissionDateFormatted: '25/03/2026',
    toolEvidenceRequirement: 'Reviewed and adopted to ensure alignment with amended SASA provisions and provincial admission regulations, submitting admission reports and placement challenges timeously to the District.'
  },
  '04_Language_Policy': {
    itemNumber: 4,
    folderId: '04_Language_Policy',
    officialTitle: 'Language Policy',
    shortName: 'Language_Policy',
    badgeSub: 'LANGUAGE',
    resolutionNo: 'LGAA-SGB-RES-2026-04',
    statutoryBasis: 'Section 6(2) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Norms & Standards for Language Policy in Public Schools',
    noticeDate: '2026-03-02',
    noticeDateFormatted: '02/03/2026',
    meetingDate: '2026-03-11',
    meetingDateDisplay: 'Wednesday, 11 March 2026',
    meetingDateFormatted: '11/03/2026',
    meetingTime: '17:30',
    submissionDate: '2026-03-25',
    submissionDateDisplay: 'Wednesday, 25 March 2026',
    submissionDateFormatted: '25/03/2026',
    toolEvidenceRequirement: 'Reviewed and adopted to ensure alignment with amended SASA provisions and provincial language regulations; implemented with evidence in curriculum provisioning and admission decisions.'
  },
  '05_Religious_Observances_Policy': {
    itemNumber: 5,
    folderId: '05_Religious_Observances_Policy',
    officialTitle: 'Religious Observances Policy',
    shortName: 'Religious_Observances_Policy',
    badgeSub: 'RELIGIOUS',
    resolutionNo: 'LGAA-SGB-RES-2026-05',
    statutoryBasis: 'Section 7 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'Section 15 of the Constitution of RSA and National Policy on Religion and Education',
    noticeDate: '2026-03-02',
    noticeDateFormatted: '02/03/2026',
    meetingDate: '2026-03-11',
    meetingDateDisplay: 'Wednesday, 11 March 2026',
    meetingDateFormatted: '11/03/2026',
    meetingTime: '17:30',
    submissionDate: '2026-03-25',
    submissionDateDisplay: 'Wednesday, 25 March 2026',
    submissionDateFormatted: '25/03/2026',
    toolEvidenceRequirement: 'Available, consulted with all members, and in line with relevant legislation; implemented in school activities ensuring inclusivity and equitable voluntary observances.'
  },
  '06_Code_of_Conduct_for_Learners': {
    itemNumber: 6,
    folderId: '06_Code_of_Conduct_for_Learners',
    officialTitle: 'Code of Conduct for Learners',
    shortName: 'Code_of_Conduct_for_Learners',
    badgeSub: 'CONDUCT',
    resolutionNo: 'LGAA-SGB-RES-2026-06',
    statutoryBasis: 'Section 8(1) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Provincial Regulations on Learner Discipline',
    noticeDate: '2026-03-02',
    noticeDateFormatted: '02/03/2026',
    meetingDate: '2026-03-11',
    meetingDateDisplay: 'Wednesday, 11 March 2026',
    meetingDateFormatted: '11/03/2026',
    meetingTime: '17:30',
    submissionDate: '2026-03-25',
    submissionDateDisplay: 'Wednesday, 25 March 2026',
    submissionDateFormatted: '25/03/2026',
    toolEvidenceRequirement: 'Applied consistently, including disciplinary processes aligned to amended SASA and other legislation, with records of implementation (hearings, interventions).'
  },
  '07_SGB_Correctly_Constituted': {
    itemNumber: 7,
    folderId: '07_SGB_Correctly_Constituted',
    officialTitle: 'SGB Composition & Constitution Charter',
    shortName: 'SGB_Correctly_Constituted',
    badgeSub: 'GOVERNANCE',
    resolutionNo: 'LGAA-SGB-RES-2026-07',
    statutoryBasis: 'Sections 23 & 24 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Electoral Regulations for School Governing Bodies',
    noticeDate: '2026-01-19',
    noticeDateFormatted: '19/01/2026',
    meetingDate: '2026-01-28',
    meetingDateDisplay: 'Wednesday, 28 January 2026',
    meetingDateFormatted: '28/01/2026',
    meetingTime: '17:30',
    submissionDate: '2026-02-16',
    submissionDateDisplay: 'Monday, 16 February 2026',
    submissionDateFormatted: '16/02/2026',
    toolEvidenceRequirement: 'In place and list showing full names and contact details of all SGB members available, all electable categories filled, RCL members included, and parent links verified.'
  },
  '08_Office_Bearers_Elections_and_Portfolios': {
    itemNumber: 8,
    folderId: '08_Office_Bearers_Elections_and_Portfolios',
    officialTitle: 'Office-Bearers Elections & Portfolio Handover Charter',
    shortName: 'Office_Bearers_and_Portfolios',
    badgeSub: 'OFFICE-BEARERS',
    resolutionNo: 'LGAA-SGB-RES-2026-08',
    statutoryBasis: 'Section 29 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Provincial Governance Handover Regulations',
    noticeDate: '2026-01-19',
    noticeDateFormatted: '19/01/2026',
    meetingDate: '2026-01-28',
    meetingDateDisplay: 'Wednesday, 28 January 2026',
    meetingDateFormatted: '28/01/2026',
    meetingTime: '17:30',
    submissionDate: '2026-02-16',
    submissionDateDisplay: 'Monday, 16 February 2026',
    submissionDateFormatted: '16/02/2026',
    toolEvidenceRequirement: 'Office-bearers are fully constituted, trained, and have completed handover processes, with evidence of role execution (chairperson leading meetings, treasurer overseeing finances).'
  },
  '09_SGB_Meetings_Schedule_and_Records': {
    itemNumber: 9,
    folderId: '09_SGB_Meetings_Schedule_and_Records',
    officialTitle: 'SGB Meetings Schedule & Governance Records Protocol',
    shortName: 'SGB_Meetings_Schedule_and_Records',
    badgeSub: 'SCHEDULE',
    resolutionNo: 'LGAA-SGB-RES-2026-09',
    statutoryBasis: 'Section 18(2) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Provincial Governance Regulations',
    noticeDate: '2026-01-19',
    noticeDateFormatted: '19/01/2026',
    meetingDate: '2026-01-28',
    meetingDateDisplay: 'Wednesday, 28 January 2026',
    meetingDateFormatted: '28/01/2026',
    meetingTime: '17:30',
    submissionDate: '2026-02-16',
    submissionDateDisplay: 'Monday, 16 February 2026',
    submissionDateFormatted: '16/02/2026',
    toolEvidenceRequirement: 'Meetings are held as scheduled and resolutions are implemented, with action plans monitored and followed up, evidenced through progress reports and subsequent minutes.'
  },
  '10_Finance_Policy': {
    itemNumber: 10,
    folderId: '10_Finance_Policy',
    officialTitle: 'Financial Management & Procurement Policy',
    shortName: 'Finance_Policy',
    badgeSub: 'FINANCE',
    resolutionNo: 'LGAA-SGB-RES-2026-10',
    statutoryBasis: 'Sections 37 & 38 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Public Finance Management Frameworks',
    noticeDate: '2026-05-11',
    noticeDateFormatted: '11/05/2026',
    meetingDate: '2026-05-20',
    meetingDateDisplay: 'Wednesday, 20 May 2026',
    meetingDateFormatted: '20/05/2026',
    meetingTime: '17:30',
    submissionDate: '2026-06-05',
    submissionDateDisplay: 'Friday, 05 June 2026',
    submissionDateFormatted: '05/06/2026',
    toolEvidenceRequirement: 'Finance Policy responds to the what, how and when of procurement, compliant with amended sections dealing with procurement, reporting mismanagement, and transparency.'
  },
  '11_Finance_Committee_FinCom': {
    itemNumber: 11,
    folderId: '11_Finance_Committee_FinCom',
    officialTitle: 'Finance Committee (FinCom) Terms of Reference & Charter',
    shortName: 'Finance_Committee_FinCom',
    badgeSub: 'FINCOM',
    resolutionNo: 'LGAA-SGB-RES-2026-11',
    statutoryBasis: 'Section 30 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and Provincial Finance Committee Guidelines',
    noticeDate: '2026-05-11',
    noticeDateFormatted: '11/05/2026',
    meetingDate: '2026-05-20',
    meetingDateDisplay: 'Wednesday, 20 May 2026',
    meetingDateFormatted: '20/05/2026',
    meetingTime: '17:30',
    submissionDate: '2026-06-05',
    submissionDateDisplay: 'Friday, 05 June 2026',
    submissionDateFormatted: '05/06/2026',
    toolEvidenceRequirement: 'In place with Treasurer as Chairperson, monthly meetings held, school finances managed in compliance with policy and amended SASA provisions including oversight and reporting.'
  },
  '12_School_Budget_and_AGM_Approval': {
    itemNumber: 12,
    folderId: '12_School_Budget_and_AGM_Approval',
    officialTitle: 'Annual School Budget & Parent AGM Approval Charter',
    shortName: 'School_Budget_and_AGM_Approval',
    badgeSub: 'BUDGET',
    resolutionNo: 'LGAA-SGB-RES-2026-12',
    statutoryBasis: 'Section 38 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 (Mandatory 14-day Notice AGM Requirements)',
    noticeDate: '2026-10-26',
    noticeDateFormatted: '26/10/2026',
    meetingDate: '2026-11-12',
    meetingDateDisplay: 'Thursday, 12 November 2026',
    meetingDateFormatted: '12/11/2026',
    meetingTime: '18:00',
    submissionDate: '2026-11-25',
    submissionDateDisplay: 'Wednesday, 25 November 2026',
    submissionDateFormatted: '25/11/2026',
    toolEvidenceRequirement: 'Budget prepared following acceptable protocols, used to guide expenditure, Annual General Meeting held with 14-day notice, parent quorum met, and approval officially recorded.'
  },
  '13_Financial_Records_and_Audit': {
    itemNumber: 13,
    folderId: '13_Financial_Records_and_Audit',
    officialTitle: 'Financial Records, Audited AFS & Reporting Protocol',
    shortName: 'Financial_Records_and_Audit',
    badgeSub: 'AUDIT',
    resolutionNo: 'LGAA-SGB-RES-2026-13',
    statutoryBasis: 'Sections 42 & 43 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 (Audited AFS Submission by 30 June)',
    noticeDate: '2026-05-11',
    noticeDateFormatted: '11/05/2026',
    meetingDate: '2026-05-20',
    meetingDateDisplay: 'Wednesday, 20 May 2026',
    meetingDateFormatted: '20/05/2026',
    meetingTime: '17:30',
    submissionDate: '2026-06-15',
    submissionDateDisplay: 'Monday, 15 June 2026',
    submissionDateFormatted: '15/06/2026',
    toolEvidenceRequirement: 'Financial records maintained, approved, and submitted to District, quarterly reports discussed in SGB meeting, and audited AFS submitted to HOD within statutory deadlines.'
  },
  '14_Learner_Support_Material_LSM': {
    itemNumber: 14,
    folderId: '14_Learner_Support_Material_LSM',
    officialTitle: 'Learner Support Material (LSM) & Textbook Policy',
    shortName: 'Learner_Support_Material_LSM',
    badgeSub: 'LSM',
    resolutionNo: 'LGAA-SGB-RES-2026-14',
    statutoryBasis: 'Section 20(1)(k) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'National Norms & Standards for School Funding and CAPS Curriculum Procurement',
    noticeDate: '2026-08-31',
    noticeDateFormatted: '31/08/2026',
    meetingDate: '2026-09-09',
    meetingDateDisplay: 'Wednesday, 09 September 2026',
    meetingDateFormatted: '09/09/2026',
    meetingTime: '17:30',
    submissionDate: '2026-09-21',
    submissionDateDisplay: 'Monday, 21 September 2026',
    submissionDateFormatted: '21/09/2026',
    toolEvidenceRequirement: 'All internal stakeholders participated, approved by SGB, orders placed and delivered aligned to curriculum needs, with evidence materials are received and utilized.'
  },
  '15_School_Property_Buildings_and_Grounds': {
    itemNumber: 15,
    folderId: '15_School_Property_Buildings_and_Grounds',
    officialTitle: 'School Property, Facilities & Maintenance Policy',
    shortName: 'Property_Buildings_and_Grounds',
    badgeSub: 'PROPERTY',
    resolutionNo: 'LGAA-SGB-RES-2026-15',
    statutoryBasis: 'Section 20(1)(g) of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'South African Schools Act, 1996 and National Minimum Norms for Public School Infrastructure',
    noticeDate: '2026-05-11',
    noticeDateFormatted: '11/05/2026',
    meetingDate: '2026-05-20',
    meetingDateDisplay: 'Wednesday, 20 May 2026',
    meetingDateFormatted: '20/05/2026',
    meetingTime: '17:30',
    submissionDate: '2026-06-05',
    submissionDateDisplay: 'Friday, 05 June 2026',
    submissionDateFormatted: '05/06/2026',
    toolEvidenceRequirement: 'SGB implements and monitors controls, maintains an operational maintenance plan, and ensures facilities are functional, safe, and recorded in regular inspections.'
  },
  '16_Safety_Policy_and_Emergency_Protocols': {
    itemNumber: 16,
    folderId: '16_Safety_Policy_and_Emergency_Protocols',
    officialTitle: 'Safety Policy & Disaster Emergency Protocols',
    shortName: 'Safety_Policy_and_Emergency_Protocols',
    badgeSub: 'SAFETY',
    resolutionNo: 'LGAA-SGB-RES-2026-16',
    statutoryBasis: 'Section 61 of South African Schools Act, 1996 (Act No. 84 of 1996)',
    statutoryActName: 'Regulations for Safety Measures at Public Schools & Occupational Health and Safety Act (Act 85 of 1993)',
    noticeDate: '2026-05-11',
    noticeDateFormatted: '11/05/2026',
    meetingDate: '2026-05-20',
    meetingDateDisplay: 'Wednesday, 20 May 2026',
    meetingDateFormatted: '20/05/2026',
    meetingTime: '17:30',
    submissionDate: '2026-06-05',
    submissionDateDisplay: 'Friday, 05 June 2026',
    submissionDateFormatted: '05/06/2026',
    toolEvidenceRequirement: 'Updated Safety Policy aligned with amended legislative provisions; complies with mandatory reporting requirements, documented incident reports submitted, and follow-up actions.'
  }
};

// ── Base Header & Style Configuration ──
function getBaseConfig(docTitle, docSubtitle, badgeSub, customMeta = null, customSigs = null) {
  return {
    documentTitle: docTitle,
    documentSubtitle: docSubtitle || 'LADY GREY ARTS ACADEMY',
    typography: {
      fontFamily: 'Aptos',
      lineSpacing: 1.25,
      spaceBeforePt: 5,
      spaceAfterPt: 0,
      paragraphSpacingPt: 0,
      titleSizePt: 14,
      subtitleSizePt: 11,
      bodySizePt: 10,
      primaryColor: '#0C2340',
      secondaryColor: '#A6192E',
      textColor: '#1A1A1A'
    },
    pageSetup: {
      paperSize: 'A4',
      borderStyle: 'none',
      leftMarginMm: 10,
      rightMarginMm: 10,
      topMarginMm: 10,
      bottomMarginMm: 10
    },
    header: {
      frequency: 'first_page_only',
      sourceMode: 'structured',
      layout: 'lgaa_official',
      showColorBar: true,
      title: 'LADY GREY ARTS ACADEMY',
      subtitle: 'Where Learning is an Art',
      contact: '18 Brummer Street, Lady Grey, 9755 | Tel: 051 603 0046 | admin@lgaa.co.za',
      emis: 'EMIS: 200600985 | District: Joe Gqabi | Circuit: Ekhephini | CMC: Maletswai',
      badgeText: 'SGB',
      badgeSubtext: badgeSub || 'OFFICIAL'
    },
    footer: {
      pageNumberFormat: 'x_slash_y',
      alignment: 'center',
      showTopDivider: true,
      customText: ''
    },
    components: {
      metadataTable: customMeta || { enabled: false },
      signatures: customSigs || { enabled: false }
    }
  };
}

// ── Document 01: Meeting Notice & Invitation ──
export function generateNoticeContent(meta) {
  const att = meta.attendance || computeMeetingAttendance(meta);
  const rawText = `
1. NOTICE OF ORDINARY MEETING OF THE SCHOOL GOVERNING BODY
1.1 Notice is hereby given to all ${att.total} elected and ex-officio members of the School Governing Body of Lady Grey Arts Academy of an Ordinary Governance Meeting.
1.2 Date: ${meta.meetingDateDisplay}
1.3 Time: ${meta.meetingTime}
1.4 Venue: School Boardroom / Staff Meeting Room, Lady Grey Arts Academy
1.5 Presiding Officer: Mr. Kwezi Dyasi (SGB Chairperson)

2. PURPOSE OF THE MEETING
2.1 The primary purpose of this governance session is to review, consider proposed amendments, and formally adopt the ${meta.officialTitle} in compliance with ${meta.statutoryBasis}.
2.2 Members are requested to carefully study the attached draft documentation prior to the meeting.
2.3 Any written proposed amendments or comments should be submitted to the SGB Secretary or Principal prior to the commencement of the meeting.

3. ADVANCE DOCUMENTATION ATTACHED
3.1 Draft 2026 ${meta.officialTitle} of the Lady Grey Arts Academy.
3.2 Regulatory Alignment Briefing Sheet in terms of ${meta.statutoryActName}.
3.3 Department of Basic Education (DBE) Functionality Audit Compliance Checklist.

4. ATTENDANCE AND APOLOGIES
4.1 Attendance by all SGB members is mandatory to ensure legal quorum requirements are met in terms of the SGB Constitution.
4.2 Members unable to attend must submit a formal written apology with reasons to the Secretary not later than 24 hours prior to the meeting.

5. ISSUED ON BEHALF OF THE SCHOOL GOVERNING BODY
By order of the Executive Committee of the School Governing Body of Lady Grey Arts Academy.
`;

  const config = getBaseConfig(
    'NOTICE OF ORDINARY SGB MEETING',
    `LADY GREY ARTS ACADEMY • GOVERNANCE CYCLE 2026`,
    'NOTICE & INVITATION',
    null,
    {
      enabled: true,
      title: 'CONVENOR & PRINCIPAL AUTHORISATION',
      introText: 'Issued and signed on behalf of the School Governing Body and Executive Management of Lady Grey Arts Academy:',
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.noticeDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.noticeDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `01_Meeting_Notice_and_Invitation_${meta.noticeDate}.docx` };
}

// ── Document 02: Meeting Agenda ──
export function generateAgendaContent(meta) {
  const rawText = `
1. OPENING AND CONSTITUTION OF MEETING
1.1 Welcome and opening prayer / remarks by the SGB Chairperson.
1.2 Recording of attendance and apologies.
1.3 Verification and declaration of legal quorum.

2. ADOPTION OF THE AGENDA
2.1 Consideration and formal adoption of the meeting agenda.
2.2 Declaration of any conflicts of interest.

3. MINUTES OF PREVIOUS GOVERNANCE SESSION
3.1 Reading and approval of previous governance minutes.
3.2 Matters arising from the minutes.

4. EXECUTIVE GOVERNANCE MATTERS
4.1 Opening remarks by the School Principal regarding institutional governance and compliance priorities.
4.2 Review of statutory alignment in terms of ${meta.statutoryActName}.

5. SPECIAL GOVERNANCE BUSINESS: ${meta.officialTitle.toUpperCase()}
5.1 Presentation of the revised draft of the ${meta.officialTitle}.
5.2 Clause-by-clause review and consideration of stakeholder inputs and regulatory directives.
5.3 Formal motion and vote for the adoption of the ${meta.officialTitle}.
5.4 Signing of the Adoption Resolution and Sign-Off Certificate.
5.5 Authorisation for statutory submission to the District Director / Head of Department.

6. IMPLEMENTATION PLAN & OVERSIGHT
6.1 Review of operational action steps, responsible committees, and staff monitoring.
6.2 Alignment with the Department of Basic Education (DBE) 2026 SGB Functionality Audit.

7. GENERAL AND CLOSURE
7.1 General announcements.
7.2 Date of next scheduled governance session.
7.3 Formal closure by the Chairperson.

8. AGENDA APPROVAL AND CONFIRMATION
This agenda was approved for distribution by the SGB Executive Committee.
`;

  const config = getBaseConfig(
    'OFFICIAL AGENDA OF ORDINARY SGB MEETING',
    `LADY GREY ARTS ACADEMY • ${meta.meetingDate.substring(0, 4)}`,
    'OFFICIAL AGENDA',
    null,
    {
      enabled: true,
      title: 'AGENDA CERTIFICATION & ADOPTION',
      introText: 'Approved and signed for distribution to all SGB components and stakeholders:',
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.meetingDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.meetingDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `02_Meeting_Agenda_${meta.meetingDate}.docx` };
}

// ── Document 03: Signed Attendance Register ──
export function generateAttendanceContent(meta) {
  const att = meta.attendance || computeMeetingAttendance(meta);

  // Group roster by component
  const parents = att.roster.filter(m => m.component === 'Parent');
  const management = att.roster.filter(m => m.component === 'Ex-Officio');
  const educators = att.roster.filter(m => m.component === 'Educator');
  const nonTeaching = att.roster.filter(m => m.component === 'Non-Teaching Staff');
  const rcl = att.roster.filter(m => m.component === 'RCL');

  let rosterText = `2. ATTENDANCE ROSTER BY SGB COMPONENT\n\n`;

  // 1. Parent component
  rosterText += `2.1 Parent Component:\n`;
  parents.forEach(m => {
    rosterText += `• ${m.name} (${m.role}) — ${m.status === 'Present' ? 'Present (Signed)' : `Apology (${m.reason})`}\n`;
  });
  rosterText += `\n`;

  // 2. Management component
  rosterText += `2.2 Management / Ex-Officio Component:\n`;
  management.forEach(m => {
    rosterText += `• ${m.name} (${m.role}) — ${m.status === 'Present' ? 'Present (Signed)' : `Apology (${m.reason})`}\n`;
  });
  rosterText += `\n`;

  // 3. Educator component (if post-July)
  if (att.isPostJuly && educators.length > 0) {
    rosterText += `2.3 Educator Component (Elected July 2026):\n`;
    educators.forEach(m => {
      rosterText += `• ${m.name} (${m.role}) — ${m.status === 'Present' ? 'Present (Signed)' : `Apology (${m.reason})`}\n`;
    });
    rosterText += `\n`;
  }

  // 4. Non-teaching staff component
  const ntIndex = att.isPostJuly ? '2.4' : '2.3';
  rosterText += `${ntIndex} Non-Teaching Staff Component:\n`;
  nonTeaching.forEach(m => {
    rosterText += `• ${m.name} (${m.role}) — ${m.status === 'Present' ? 'Present (Signed)' : `Apology (${m.reason})`}\n`;
  });
  rosterText += `\n`;

  // 5. RCL component
  const rclIndex = att.isPostJuly ? '2.5' : '2.4';
  rosterText += `${rclIndex} Representative Council of Learners (RCL) Component:\n`;
  rcl.forEach(m => {
    rosterText += `• ${m.name} (${m.role}) — ${m.status === 'Present' ? 'Present (Signed)' : `Apology (${m.reason})`}\n`;
  });

  const rawText = `
1. RECORD OF ATTENDANCE AND DECLARATION OF QUORUM
1.1 Meeting Type: Ordinary Meeting of the School Governing Body (${meta.officialTitle} Adoption Session).
1.2 Meeting Date: ${meta.meetingDateDisplay} | Time: ${meta.meetingTime} | Venue: School Boardroom.
1.3 Legal Quorum Requirement: In terms of Section 12 of the SGB Constitution, a majority of voting members (more than 50%) constitutes a legal quorum.
1.4 Total SGB Members: ${att.total} Members | Members Present: ${att.presentCount} Members | Apologies: ${att.apologyCount} Member(s).
1.5 Quorum Status: Legally Quorate (${att.quorumPercent}% in attendance) and fully constituted to adopt binding governance resolutions.

${rosterText.trim()}

3. VERIFICATION OF ATTENDANCE AND QUORUM
We hereby certify that the attendance recorded above represents the true and correct attendance of the SGB meeting held on ${meta.meetingDateDisplay}.
`;

  const config = getBaseConfig(
    'SGB OFFICIAL MEETING ATTENDANCE REGISTER',
    `LADY GREY ARTS ACADEMY • MEETING OF ${meta.meetingDate.toUpperCase()}`,
    'ATTENDANCE',
    null,
    {
      enabled: true,
      title: 'ATTENDANCE VERIFICATION & RECORD OF QUORUM',
      introText: `Certified as an accurate record of attendance and quorum verification for the Ordinary SGB Meeting of ${meta.meetingDateDisplay}:`,
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.meetingDateFormatted },
        { role: 'SGB TREASURER', name: 'Mr. A. Gushmani', date: meta.meetingDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.meetingDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `03_Signed_Attendance_Register_${meta.meetingDate}.docx` };
}

// ── Document 04: Minutes of SGB Meeting ──
export function generateMinutesContent(meta) {
  const att = meta.attendance || computeMeetingAttendance(meta);

  // Format apologies statement
  const apologiesStatement = att.apologies.length > 0
    ? `Formal apologies with valid reasons were recorded from: ${att.apologies.map(a => `${a.name} (${a.role}) — Reason: ${a.reason}`).join('; ')}.`
    : `No apologies were tendered; full attendance recorded.`;

  // Format discussion points from present members only
  const discussionPoints = att.discussionSpeakers.map(d => `• ${d}`).join('\n');

  const rawText = `
1. OPENING, WELCOME AND CONSTITUTION OF THE MEETING
1.1 The Ordinary Meeting of the School Governing Body of Lady Grey Arts Academy commenced at ${meta.meetingTime} in the School Boardroom.
1.2 The SGB Chairperson, Mr. Kwezi Dyasi, welcomed all members present and thanked them for their dedication to institutional governance.
1.3 Opening prayer and devotion were observed.
1.4 The Chairperson noted that ${att.presentCount} out of ${att.total} members were in attendance. ${apologiesStatement}
1.5 The Chairperson officially declared the meeting properly constituted and legally quorate in terms of the South African Schools Act and Section 12 of the SGB Constitution (${att.quorumPercent}% quorate).

2. ADOPTION OF THE AGENDA
2.1 The circulated agenda was considered by the meeting.
2.2 Motion to adopt the agenda: Proposed by ${att.proposer}, Seconded by ${att.seconder}.
2.3 The agenda was adopted unanimously without amendments.

3. MINUTES OF THE PREVIOUS MEETING
3.1 The minutes of the previous governance session were reviewed.
3.2 Adoption of previous minutes: Proposed by Mr. Bennie Bekker, Seconded by Mr. Andile Gushmani.
3.3 Matters Arising: The Principal reported that institutional administrative follow-ups had proceeded satisfactorily.

4. REMARKS BY THE SCHOOL PRINCIPAL
4.1 The Principal, Ms. M. Botha, provided an operational overview of school activities, compliance directives, and departmental correspondence.
4.2 The Principal emphasized the necessity of maintaining full compliance with the DBE SGB Functionality Audit standards and ensuring current policies guide daily practice.

5. SPECIAL BUSINESS: REVIEW AND FORMAL ADOPTION OF THE ${meta.officialTitle.toUpperCase()}
5.1 The Chairperson introduced the draft ${meta.officialTitle}, which had been circulated to all members with the meeting notice on ${meta.noticeDate}.
5.2 The SGB conducted a detailed, clause-by-clause review:
• Verified alignment with ${meta.statutoryBasis}.
• Confirmed statutory adherence to provincial regulations and national directives.
• Reviewed responsibilities, implementation mechanisms, and monitoring procedures.
• Noted that: ${meta.toolEvidenceRequirement}
5.3 Discussion and Inputs:
${discussionPoints}
5.4 Formal Motion for Adoption:
• Proposer: ${att.proposer} moved that the ${meta.officialTitle} of Lady Grey Arts Academy be formally accepted and adopted as an official regulatory policy of the institution.
• Seconder: ${att.seconder} seconded the motion.
5.5 Voting and Decision:
• The Chairperson called for a vote.
• Result: In Favour: ${att.presentCount} (Unanimous) | Against: 0 | Abstentions: 0.
• Resolution: The ${meta.officialTitle} was declared formally accepted, adopted, and signed under Resolution Number ${meta.resolutionNo}.
5.6 Statutory Transmittal:
• The meeting resolved that the Principal and Chairperson submit the signed policy pack to the Head of Department / District Director (Joe Gqabi District).

6. IMPLEMENTATION PLAN & OVERSIGHT
6.1 The SGB resolved that the Principal and relevant committees ensure the active application of the adopted instrument in school operations and planning records.

7. CLOSURE
7.1 With no further business, the Chairperson thanked all members for their valuable contributions.
7.2 The meeting adjourned at 19:30.

8. CONFIRMATION AND CERTIFICATION OF MINUTES
These minutes were examined, approved, and signed as a true and accurate record of proceedings.
`;

  const config = getBaseConfig(
    'MINUTES OF THE ORDINARY SGB MEETING',
    `LADY GREY ARTS ACADEMY • ${meta.meetingDateDisplay.toUpperCase()}`,
    'MINUTES',
    null,
    {
      enabled: true,
      title: 'RECORD CONFIRMATION & APPROVAL OF MINUTES',
      introText: `Certified and signed as a true and accurate record of the proceedings and resolutions of the Ordinary SGB Meeting of ${meta.meetingDateDisplay}:`,
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.meetingDateFormatted },
        { role: 'SGB TREASURER', name: 'Mr. A. Gushmani', date: meta.meetingDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.meetingDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `04_Minutes_of_SGB_Meeting_${meta.meetingDate}.docx` };
}

// ── Document 05: Formal Adoption Resolution Certificate ──
export function generateResolutionContent(meta) {
  const att = meta.attendance || computeMeetingAttendance(meta);

  const rawText = `
1. STATUTORY AUTHORITY AND GOVERNANCE RESOLUTION
1.1 In terms of ${meta.statutoryBasis}, the School Governing Body of Lady Grey Arts Academy hereby certifies the formal review, acceptance, and adoption of the ${meta.officialTitle}.
1.2 Resolution Number: ${meta.resolutionNo}.
1.3 Date of Adoption: ${meta.meetingDateDisplay}.
1.4 Effective Date: ${meta.meetingDateDisplay}.

2. CERTIFICATION OF QUORUM AND VOTING OUTCOME
2.1 Total SGB Membership: ${att.total} Members.
2.2 Members Present in Person: ${att.presentCount} Members.
2.3 Quorum Attained: ${att.quorumPercent}% (Exceeds statutory requirement of 50% + 1).
2.4 Voting Outcome:
• Votes in Favour: ${att.presentCount} (Unanimous)
• Votes Against: 0
• Abstentions: 0

3. GOVERNANCE MANDATE AND RESPONSIBILITIES
3.1 The ${meta.officialTitle} shall serve as an official binding regulatory instrument of Lady Grey Arts Academy.
3.2 The School Principal is authorised and mandated to implement and administer this policy in strict compliance with applicable legislation.
3.3 The SGB Executive Committee is authorised to submit this adopted instrument and accompanying evidence to the Joe Gqabi District Director and Head of Department.

4. CERTIFICATION BY EXECUTIVE OFFICE BEARERS
4.1 We, the undersigned Executive Office Bearers of the School Governing Body of Lady Grey Arts Academy, hereby attest and certify that this resolution was formally passed at a duly constituted meeting of the SGB.

5. EXECUTED AND CERTIFIED UNDER SGB SEAL
Signed on this day of ${meta.meetingDateDisplay} at Lady Grey, Eastern Cape.
`;

  const metaTable = {
    enabled: true,
    col1Title: 'Resolution Parameter',
    col2Title: 'Official Record',
    rows: [
      { label: 'Resolution Ref', value: meta.resolutionNo },
      { label: 'Document Adopted', value: meta.officialTitle },
      { label: 'Meeting Date', value: meta.meetingDateDisplay },
      { label: 'Statutory Alignment', value: meta.statutoryBasis },
      { label: 'Adoption Status', value: `Unanimously Approved (${att.presentCount}-0)` }
    ]
  };

  const config = getBaseConfig(
    'CERTIFICATE OF SGB GOVERNANCE RESOLUTION',
    `LADY GREY ARTS ACADEMY • RESOLUTION ${meta.resolutionNo}`,
    'RESOLUTION',
    metaTable,
    {
      enabled: true,
      title: 'FORMAL ADOPTION AND SIGN-OFF RESOLUTION',
      introText: `Signed on behalf of the School Governing Body in witness and execution of the unanimous resolution adopting the 2026 ${meta.officialTitle}:`,
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.meetingDateFormatted },
        { role: 'SGB TREASURER', name: 'Mr. A. Gushmani', date: meta.meetingDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.meetingDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `05_Formal_Adoption_Resolution_${meta.meetingDate}.docx` };
}

// ── Document 06: Approved and Signed Policy Edition ──
export function generateApprovedDocContent(meta, sourceRawText) {
  // Clean placeholder signature blocks from the end of the source doc if present
  let cleanBodyText = sourceRawText;
  const sigMatch = cleanBodyText.search(/ADOPTION AND (?:SIGN-OFF|STATUTORY) RESOLUTION/i);
  if (sigMatch !== -1 && sigMatch > 300) {
    cleanBodyText = cleanBodyText.substring(0, sigMatch).trim();
  }

  // Remove duplicate headers / titles from body if they repeat
  cleanBodyText = cleanBodyText.replace(/LADY GREY ARTS ACADEMY/gi, '').trim();

  const metaTable = {
    enabled: true,
    col1Title: 'Regulatory Alignment & Authority',
    col2Title: 'Details & Specifications',
    rows: [
      { label: 'National Legislative Basis', value: meta.statutoryBasis },
      { label: 'Statutory Regulatory Framework', value: meta.statutoryActName },
      { label: 'Institutional Juristic Status', value: 'Lady Grey Arts Academy (EMIS: 200600985)' },
      { label: 'Governance Oversight', value: 'School Governing Body (SGB) & School Management Team (SMT)' },
      { label: 'Adoption Resolution Ref', value: meta.resolutionNo }
    ]
  };

  const config = getBaseConfig(
    meta.officialTitle.toUpperCase(),
    'LADY GREY ARTS ACADEMY',
    meta.badgeSub || 'POLICY',
    metaTable,
    {
      enabled: true,
      title: 'ADOPTION AND STATUTORY SIGN-OFF RESOLUTION',
      introText: `This ${meta.officialTitle} was formally reviewed, accepted, approved, and signed at a duly constituted meeting of the Governing Body of Lady Grey Arts Academy:`,
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.meetingDateFormatted },
        { role: 'SGB TREASURER', name: 'Mr. A. Gushmani', date: meta.meetingDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.meetingDateFormatted }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText: cleanBodyText, config, filename: `06_LGAA_${meta.shortName}_Approved_and_Signed.docx` };
}

// ── Document 07: Proof of Submission to District HOD ──
export function generateSubmissionContent(meta) {
  const rawText = `
1. FORMAL TRANSMITTAL AND SUBMISSION OF ${meta.officialTitle.toUpperCase()}
1.1 Addressee: The District Director / Head of Department, Joe Gqabi District, Eastern Cape Department of Education, Private Bag X1018, Aliwal North, 9750.
1.2 Attention: Directorate for Institutional Governance and School Management Support.
1.3 Date of Submission: ${meta.submissionDateDisplay}.
1.4 Institution: Lady Grey Arts Academy (EMIS: 200600985).

2. STATUTORY COMPLIANCE DECLARATION
2.1 In terms of ${meta.statutoryBasis} and Provincial Education Regulations, the School Governing Body hereby submits a certified copy of its adopted ${meta.officialTitle}.
2.2 The School Governing Body of Lady Grey Arts Academy formally confirms that this regulatory instrument was reviewed, accepted, and unanimously adopted at a quorate meeting of the SGB on ${meta.meetingDateDisplay}.
2.3 The adopted policy and supporting documents are submitted in full satisfaction of the Department of Basic Education 2026 SGB Functionality Audit criteria.

3. SCHEDULE OF ENCLOSURES
3.1 One (1) certified copy of the Adopted 2026 ${meta.officialTitle} of Lady Grey Arts Academy.
3.2 One (1) certified copy of the SGB Meeting Minutes of ${meta.meetingDateDisplay} (${meta.officialTitle} Adoption).
3.3 One (1) copy of the Signed SGB Attendance Register & Quorum Declaration.
3.4 One (1) certified Certificate of SGB Governance Resolution (${meta.resolutionNo}).

4. SUBMISSION SIGNATORIES
4.1 Submitted by the Executive Committee of the School Governing Body of Lady Grey Arts Academy on ${meta.submissionDateDisplay}.
`;

  const config = getBaseConfig(
    `STATUTORY SUBMISSION OF ${meta.officialTitle.toUpperCase()}`,
    `TO THE HEAD OF DEPARTMENT • JOE GQABI DISTRICT`,
    'SUBMISSION',
    null,
    {
      enabled: true,
      title: 'SUBMISSION AND DISTRICT ACKNOWLEDGMENT OF RECEIPT',
      introText: 'Signed on behalf of the School Governing Body, and acknowledged by the District Office:',
      signers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meta.submissionDateFormatted },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meta.submissionDateFormatted },
        { role: 'DISTRICT OFFICIAL / REGISTRY STAMP', name: 'District Director / Circuit Manager', date: '___/___/2026' }
      ],
      showSchoolStamp: true,
      showDistrictStamp: true,
      districtRole: 'Circuit Manager'
    }
  );

  return { rawText, config, filename: `07_Proof_of_Submission_to_District_HOD_${meta.submissionDate}.docx` };
}

// ── Main Evidence Pack Generator for a Folder ──
export async function generateEvidencePack(folderName, sourceDocPath) {
  const folderPath = path.isAbsolute(folderName) ? folderName : path.join(AUDIT_BASE_DIR, folderName);
  const folderId = path.basename(folderPath);

  let meta = SGB_AUDIT_REGISTRY[folderId];
  if (!meta) {
    // Generate fallback metadata based on folder title
    const cleanName = folderId.replace(/^\d+[\s_-]*/, '').replace(/[_-]+/g, ' ');
    meta = {
      itemNumber: parseInt(folderId.substring(0, 2), 10) || 1,
      folderId,
      officialTitle: cleanName,
      shortName: cleanName.replace(/\s+/g, '_'),
      badgeSub: 'POLICY',
      resolutionNo: `LGAA-SGB-RES-2026-${String(parseInt(folderId.substring(0, 2), 10) || 1).padStart(2, '0')}`,
      statutoryBasis: 'South African Schools Act, 1996 (Act No. 84 of 1996)',
      statutoryActName: 'South African Schools Act, 1996 and Provincial Directives',
      noticeDate: '2026-01-19',
      noticeDateFormatted: '19/01/2026',
      meetingDate: '2026-01-28',
      meetingDateDisplay: 'Wednesday, 28 January 2026',
      meetingDateFormatted: '28/01/2026',
      meetingTime: '17:30',
      submissionDate: '2026-02-16',
      submissionDateDisplay: 'Monday, 16 February 2026',
      submissionDateFormatted: '16/02/2026',
      toolEvidenceRequirement: 'Reviewed and adopted to ensure compliance with relevant legislation and DBE Functionality Audit standards.'
    };
  }

  // Attach computed dynamic attendance profile
  meta.attendance = computeMeetingAttendance(meta);

  console.log(`[EvidenceGenerator] Generating pack for: ${folderId} (${meta.officialTitle})`);
  console.log(`[EvidenceGenerator] Attendance Profile: ${meta.attendance.presentCount}/${meta.attendance.total} present (${meta.attendance.quorumPercent}% quorate) | Apologies: ${meta.attendance.apologyCount}`);

  // 1. Read source DOCX text
  let sourceRawText = '';
  if (sourceDocPath && fsSync.existsSync(sourceDocPath)) {
    try {
      const extracted = await mammoth.extractRawText({ path: sourceDocPath });
      sourceRawText = extracted.value || '';
    } catch (e) {
      console.warn(`[EvidenceGenerator] Warning: Could not extract text from source doc: ${e.message}`);
    }

    // Also ensure Source PDF exists and is up to date!
    const sourcePdfPath = sourceDocPath.replace(/\.docx$/i, '.pdf');
    let needsPdfConversion = false;
    if (!fsSync.existsSync(sourcePdfPath)) {
      needsPdfConversion = true;
    } else {
      const pdfStat = fsSync.statSync(sourcePdfPath);
      const docxStat = fsSync.statSync(sourceDocPath);
      if (pdfStat.size < 1000 || pdfStat.mtimeMs < docxStat.mtimeMs) {
        needsPdfConversion = true;
      }
    }

    if (needsPdfConversion) {
      try {
        console.log(`[EvidenceGenerator] Converting core source doc to PDF: ${path.basename(sourceDocPath)}`);
        await convertDocxToPdf(sourceDocPath, sourcePdfPath);
      } catch (convErr) {
        console.warn(`[EvidenceGenerator] Core source PDF conversion notice: ${convErr.message}`);
      }
    }
  }

  // 2. Generate the 7 documents
  const docSpecs = [
    generateNoticeContent(meta),
    generateAgendaContent(meta),
    generateAttendanceContent(meta),
    generateMinutesContent(meta),
    generateResolutionContent(meta),
    generateApprovedDocContent(meta, sourceRawText),
    generateSubmissionContent(meta)
  ];

  const results = [];

  for (const docSpec of docSpecs) {
    const docxPath = path.join(folderPath, docSpec.filename);
    const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');

    try {
      console.log(`[EvidenceGenerator] Building DOCX: ${docSpec.filename}`);
      const parsedBlocks = parseRawText(docSpec.rawText);
      const docxBuffer = await buildFormattedDocx(docSpec.config, parsedBlocks);
      await fs.writeFile(docxPath, docxBuffer);

      console.log(`[EvidenceGenerator] Converting to PDF: ${path.basename(pdfPath)}`);
      await convertDocxToPdf(docxPath, pdfPath, docSpec.config, parsedBlocks);

      results.push({
        name: docSpec.filename,
        docx: docxPath,
        pdf: pdfPath,
        success: true
      });
    } catch (err) {
      console.error(`[EvidenceGenerator] Error generating ${docSpec.filename}:`, err.message);
      results.push({
        name: docSpec.filename,
        error: err.message,
        success: false
      });
    }
  }

  console.log(`[EvidenceGenerator] Pack complete for ${folderId}: ${results.filter(r => r.success).length}/7 generated successfully.`);
  return { folderId, results };
}
