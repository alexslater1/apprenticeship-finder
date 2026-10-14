import { describe, expect, it } from 'vitest';
import { extractClosingDate, extractStartDate } from '../src/start.ts';

const today = '2026-10-10';
const start = (text: string, title = 'Data Apprentice') => extractStartDate(title, text, today);

describe('extractStartDate', () => {
  it('reads an exact start date', () => {
    expect(start('Start Date: 06 September 2027 Salary: £24,000 per annum')).toEqual({
      date: '2027-09-06',
      precision: 'day',
    });
    expect(start('Job Description: Start date: 31st August 2027 Location: Newport')).toEqual({
      date: '2027-08-31',
      precision: 'day',
    });
    expect(start('The start date for this role is on 14 September 2027.')?.date).toBe('2027-09-14');
    expect(start('Expected start: 06/09/2027')?.date).toBe('2027-09-06');
  });

  it('settles for the month when that is all it says', () => {
    expect(start('Job Description: Start date: September 2027 Location: Broughton')).toEqual({
      date: '2027-09-01',
      precision: 'month',
    });
    expect(start('52 Weeks per year, fixed-term, Apprenticeship, October 2026 start')).toEqual({
      date: '2026-10-01',
      precision: 'month',
    });
    expect(
      start(
        'no gaps in your right to work during your apprenticeship (August 2027 to August 2031).',
      ),
    ).toEqual({ date: '2027-08-01', precision: 'month' });
  });

  it('reads an induction week whose year comes later', () => {
    expect(
      start(
        'Induction week for all Graduate and Apprentices will take place from Monday 6 September - Friday 10 September 2027.',
      )?.date,
    ).toBe('2027-09-06');
  });

  it('prefers the exact day in the text to the month in the title', () => {
    expect(
      extractStartDate(
        'Audit Data Analytics School Leaver Apprenticeship - Manchester - September 2027',
        'The start date for this role is on 14 September 2027.',
        today,
      ),
    ).toEqual({ date: '2027-09-14', precision: 'day' });
    expect(extractStartDate('Data Analyst Apprentice - September 2027', '', today)).toEqual({
      date: '2027-09-01',
      precision: 'month',
    });
  });

  it('falls back to the year when that is all it says', () => {
    expect(extractStartDate('2027 Data Analyst Apprentice', '', today)).toEqual({
      date: '2027-01-01',
      precision: 'year',
    });
    expect(
      extractStartDate('Degree Apprenticeships 2027', 'Join our 2027 intake.', today)?.precision,
    ).toBe('year');
    expect(start('Start date: 2027. Applications close 17 February 2027.')?.precision).toBe('year');
    // A month beats the year.
    expect(
      extractStartDate('2027 Data Analyst Apprentice', 'Start date: September 2027', today),
    ).toEqual({
      date: '2027-09-01',
      precision: 'month',
    });
    // A start this year is still possible in October; last year's isn't.
    expect(extractStartDate('2026 Apprenticeship', '', today)?.date).toBe('2026-01-01');
    expect(extractStartDate('2025 Apprenticeship', '', today)).toBeNull();
  });

  it('ignores closing dates and dates that cannot be a start', () => {
    expect(start('Closing date: 17 February 2027. Apply early.')).toBeNull();
    expect(start('Start date: TBC. Applications close 17 February 2027.')).toBeNull();
    expect(start('We started in March 2019 and now employ 300 people.')).toBeNull();
  });
});

describe('extractClosingDate', () => {
  const close = (text: string) => extractClosingDate(text, today);

  it('reads the deadline the advert gives', () => {
    expect(
      close(
        'Recruitment Process This vacancy will close on 8th November 2026 , but we review applications as they come in',
      ),
    ).toBe('2026-11-08');
    expect(close('Closing Date: Monday 30 November 2026 Please let us know')).toBe('2026-11-30');
    expect(
      close('Application closing date: Applications will be open until 26 October 2026.'),
    ).toBe('2026-10-26');
    expect(
      close('Key dates Applications close: 8 November 2026 Assessment centre: 16 February 2027'),
    ).toBe('2026-11-08');
    expect(close('Deadline: 05/12/2026')).toBe('2026-12-05');
  });

  it('fills in a missing year with the next such day', () => {
    expect(
      close('The final application date is 4th March, but we may close before 4th March'),
    ).toBe('2027-03-04');
    expect(close('Applications close 4th August.')).toBeNull(); // ten months off: too vague
  });

  it('counts a deadline that has passed', () => {
    expect(close('Closing Date for Applications - 20thMarch 2026 To Apply')).toBe('2026-03-20');
  });

  it('ignores closing words without a deadline after them', () => {
    expect(
      close(
        'if applications are high the role will close before the closing date given. Job title: Data Scientist, starting 1 September 2027',
      ),
    ).toBeNull();
    expect(close('Close attention to detail. Start date: 1 September 2027')).toBeNull();
    expect(
      close('Applications close when we have enough, with a start date of 6 September 2027.'),
    ).toBeNull();
  });
});
