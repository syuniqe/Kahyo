// Sample Journeys for Rhyme, Reason and Juris (Wordwalk's is in sample.js).
// Each point is added the way a writer would add it, already read (no AI needed).
(function (root) {
  const line = (event, section, extra = {}) => ({ event, section, ...extra });
  const id = (n) => 'FS#' + String(n).padStart(3, '0');

  root.KAHYO_NSMM_SAMPLES = {
    rhyme: {
      title: 'Monsoon Letters',
      setup: 'A song about letters between two people kept apart by the monsoon.',
      points: [
        line('The kettle hums before the rain', 'Verse 1', { subjects: ['kettle', 'rain'], intensity: 0.3 }),
        line('Your letters fold along the pane', 'Verse 1', { subjects: ['letters', 'window'], intensity: 0.4 }),
        line('I read them twice, I read them slow', 'Verse 1', { subjects: ['letters'], intensity: 0.4 }),
        line('And wait for words I used to know', 'Verse 1', { subjects: ['words'], intensity: 0.5 }),
        line('So write me when the monsoon breaks', 'Chorus', { subjects: ['monsoon', 'letters'], intensity: 0.8 }),
        line("I'll keep the line for both our sakes", 'Chorus', { subjects: ['line'], intensity: 0.7 }),
        line('The station clock forgot your train', 'Verse 2', { subjects: ['station', 'train'], intensity: 0.5 }),
        line('The ink has run, the words remain, and the paper tears at the fold of every page', 'Verse 2', { subjects: ['ink', 'words', 'paper'], intensity: 0.6, events_count: 2 }),
        line('Your silence, like a song', 'Verse 2', { subjects: ['silence', 'song'], intensity: 0.4, aside: true }),
        line('So write me when the monsoon breaks', 'Chorus 2', { subjects: ['monsoon', 'letters'], intensity: 0.8 }),
        line("I'll hold the line for both our sakes", 'Chorus 2', { subjects: ['line'], intensity: 0.7 }),
        line('And if the river takes the road', 'Bridge', { subjects: ['river', 'road'], intensity: 0.7 }),
        line("I'll carry what the letters owed", 'Bridge', { subjects: ['letters'], intensity: 0.8 }),
        line('The kettle hums, the rain is done', 'Outro', { subjects: ['kettle', 'rain'], intensity: 0.5 }),
      ],
    },

    reason: {
      title: 'Rainfall and School Attendance',
      setup: 'A district study of how monsoon rainfall affects school attendance in rural India.',
      points: [
        { event: 'Does heavy monsoon rainfall reduce school attendance in rural districts?', phase: 'Introduction', role: 'main', intensity: 0.9 },
        { event: 'Why it matters: missed school days add up to learning loss for rural children.', phase: 'Introduction', role: 'work', intensity: 0.5 },
        { event: 'Research question: how much of the attendance drop do roads and access explain?', phase: 'Introduction', role: 'work', intensity: 0.7 },
        { event: 'Earlier studies link monsoon floods to lower attendance, but not to road access.', phase: 'Literature', role: 'main', intensity: 0.7 },
        { event: 'Monsoon and health: waterborne illness keeps children at home.', phase: 'Literature', role: 'work', source: 'Kumar et al. 2019', intensity: 0.5 },
        { event: 'Attendance studies report 8 to 15% drops in flood weeks.', phase: 'Literature', role: 'work', source: 'Rao 2021', intensity: 0.5 },
        { event: 'Roads and access: villages without all-weather roads lose more school days.', phase: 'Literature', role: 'work', intensity: 0.6 },
        { event: 'The gap: no study separates rainfall from road access.', phase: 'Literature', role: 'work', source: 'This review', intensity: 0.8 },
        { event: 'We combine district rainfall data with school attendance records from 2015 to 2023.', phase: 'Methodology', role: 'main', intensity: 0.8 },
        { event: 'District rainfall data, daily, from the meteorological department.', phase: 'Methodology', role: 'work', intensity: 0.5 },
        { event: 'Sample: 42 schools across 6 districts.', phase: 'Methodology', role: 'work', intensity: 0.6 },
        { event: 'Regression of weekly attendance on rainfall and road access.', phase: 'Methodology', role: 'work', intensity: 0.6 },
        { event: 'Eight schools lost their attendance records in the 2022 flood.', phase: 'Methodology', role: 'work', unplanned: true, intensity: 0.6 },
        { event: 'Attendance falls 11% in weeks with heavy rainfall.', phase: 'Results & Inference', role: 'main', intensity: 0.9, supports: [10, 11] },
        { event: 'Girls are hit harder: their attendance falls 15%.', phase: 'Results & Inference', role: 'work', intensity: 0.7, supports: [12] },
        { event: 'Road access explains most of the drop.', phase: 'Results & Inference', role: 'work', intensity: 0.9, supports: [12] },
        { event: 'Teachers also miss more days in the monsoon.', phase: 'Results & Inference', role: 'work', intensity: 0.4 },
      ],
    },

    juris: {
      title: 'Sharma v. Metro Housing Board',
      setup: 'R. Sharma sues Metro Housing Board before the consumer commission for delayed possession of a flat allotted in 2021.',
      points: [
        { event: 'Sharma filed the consumer complaint for delayed possession.', kind: 'filing', date: '2023-01-10', parent: 'CASE', subjects: ['Sharma'], intensity: 0.8 },
        { event: 'Allotment letter dated 12 May 2021, promising possession by March 2022.', kind: 'evidence', date: '2021-05-12', parent: 'CASE', subjects: ['Metro Housing Board', 'Sharma'], intensity: 0.9 },
        { event: "The Board's possession letter offering possession to Sharma, dated Jan 2024.", kind: 'evidence', date: '2024-01', parent: 'CASE', subjects: ['Metro Housing Board', 'Sharma'], intensity: 0.8 },
        { event: 'Hearing 1 on 14 Mar 2024: the Board asked for time to file its reply.', kind: 'hearing', date: '2024-03-14', parent: 'CASE', subjects: ['Metro Housing Board'], intensity: 0.5 },
        { event: 'Adjourned; the Board to file its reply within four weeks.', kind: 'outcome', parent: 4, intensity: 0.3 },
        { event: 'The commission noted the promised possession date in the allotment letter.', kind: 'outcome', parent: 4, relates: [2], intensity: 0.6 },
        { event: 'Hearing 2 on 4 Jun 2024: the Board argued force majeure because of COVID.', kind: 'hearing', date: '2024-06-04', parent: 'CASE', subjects: ['Metro Housing Board'], intensity: 0.7 },
        { event: 'The Board said it offered possession to Sharma in Feb 2023.', kind: 'outcome', date: '2024-06-04', parent: 7, subjects: ['Metro Housing Board', 'Sharma'], intensity: 0.7 },
        { event: "Sharma's counsel disputed the force majeure claim.", kind: 'outcome', parent: 7, subjects: ['Sharma'], intensity: 0.6 },
        { event: 'The commission asked the Board to produce the possession letter.', kind: 'outcome', parent: 9, relates: [3], intensity: 0.6 },
        { event: 'Order on 20 Sep 2024 directing the Board to pay interest for the delay.', kind: 'order', date: '2024-09-20', parent: 'CASE', subjects: ['Metro Housing Board'], intensity: 0.9 },
        { event: 'The Board filed an appeal against the order.', kind: 'outcome', date: '2024-08-02', parent: 11, subjects: ['Metro Housing Board'], intensity: 0.7 },
        { event: 'Interest to run from the promised date in the allotment letter.', kind: 'outcome', parent: 11, relates: [2], intensity: 0.7 },
        { event: "Site engineer's statement on construction delays.", kind: 'evidence', parent: null, intensity: 0.5 },
      ],
    },
  };
  root.KAHYO_NSMM_SAMPLES.id = id;
})(typeof window !== 'undefined' ? window : globalThis);
