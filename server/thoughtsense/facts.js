// ThoughtSense core · facts
// Dates and numbers written in a Footstep, so two Footsteps about the same thing
// can be checked against each other. Server only.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n) => String(n).padStart(2, '0');
const month = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

// Dates as YYYY-MM-DD, or YYYY-MM when no day is given. Each match is taken out of the
// text so its digits are not read again as numbers.
function datesIn(text) {
  let t = ' ' + String(text || '') + ' ';
  const out = [];
  const take = (re, fn) => {
    t = t.replace(re, (...m) => {
      const d = fn(m);
      if (d) out.push(d);
      return ' ';
    });
  };
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => `${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+(\\d{4})\\b`, 'gi'), (m) => `${m[3]}-${pad(month(m[2]))}-${pad(m[1])}`);
  take(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (m) => `${m[3]}-${pad(month(m[1]))}-${pad(m[2])}`);
  take(new RegExp(`\\b${MON}\\.?,?\\s+(\\d{4})\\b`, 'gi'), (m) => `${m[2]}-${pad(month(m[1]))}`);
  take(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m) => `${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  return { dates: [...new Set(out)], rest: t };
}

// Numbers that are not part of a date (counts, sums, percentages).
function numbersIn(text) {
  const { rest } = datesIn(text);
  return [...new Set((rest.match(/\b\d[\d,]*(?:\.\d+)?%?/g) || []).map((n) => n.replace(/,/g, '')))];
}

function factsOf(text) {
  return { dates: datesIn(text).dates, numbers: numbersIn(text) };
}

// Two dates agree when one is a prefix of the other (2024-06 and 2024-06-04).
const sameDate = (a, b) => a.startsWith(b) || b.startsWith(a);

// Facts that disagree: both give dates and none agree, or both give numbers and none agree.
function factsDiffer(a, b) {
  if (a.dates.length && b.dates.length && !a.dates.some((x) => b.dates.some((y) => sameDate(x, y)))) return { kind: 'date', a: a.dates[0], b: b.dates[0] };
  if (a.numbers.length && b.numbers.length && !a.numbers.some((x) => b.numbers.includes(x))) return { kind: 'number', a: a.numbers[0], b: b.numbers[0] };
  return null;
}

// The earliest full date a Footstep names, for ordering.
function firstDate(fs) {
  const own = fs.date ? datesIn(fs.date).dates : [];
  const d = own.length ? own : datesIn(fs.event).dates;
  return d.length ? [...d].sort()[0] : null;
}

export { datesIn, numbersIn, factsOf, factsDiffer, sameDate, firstDate };
