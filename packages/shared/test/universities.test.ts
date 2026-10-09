import { describe, expect, it } from 'vitest';
import { findUniversity, universityFromProvider } from '../src/universities.ts';

describe('universityFromProvider', () => {
  it.each([
    ['UNIVERSITY OF EXETER', 'University of Exeter'],
    ['Bpp University Limited', 'BPP University'],
    ['Manchester Metropolitan University', 'Manchester Metropolitan University'],
    ['THE OPEN UNIVERSITY', 'The Open University'],
    ['QA Limited', null],
    ['Middlesbrough College', null],
  ])('%s → %s', (provider, uni) => {
    expect(universityFromProvider(provider)).toBe(uni);
  });
});

describe('findUniversity', () => {
  it('prefers the training provider', () => {
    expect(
      findUniversity({
        provider: 'University of Nottingham',
        texts: ['Study with Aston University'],
      }),
    ).toBe('University of Nottingham');
  });
  it('reads the advert text when the provider is not a university', () => {
    expect(
      findUniversity({
        provider: 'QA Limited',
        texts: ['You will study a BSc (Hons) Data Science with Northumbria University.'],
      }),
    ).toBe('Northumbria University');
  });
  it('picks the longest name, so the federal "University of London" never wins', () => {
    expect(
      findUniversity({ texts: ['Delivered by Queen Mary University of London (QMUL).'] }),
    ).toBe('Queen Mary University of London');
    expect(findUniversity({ texts: ['a degree from Manchester Metropolitan University'] })).toBe(
      'Manchester Metropolitan University',
    );
  });
  it('matches acronyms only in capitals and names only as phrases', () => {
    expect(findUniversity({ texts: ['in partnership with UCL'] })).toBe(
      'University College London',
    );
    expect(findUniversity({ texts: ['we include everyone'] })).toBeNull();
    expect(findUniversity({ texts: ['an open university-style course'] })).toBeNull();
    expect(findUniversity({ texts: ['No need to go to university.'] })).toBeNull();
  });
  it('picks the most-mentioned university', () => {
    expect(
      findUniversity({
        texts: [
          'Previous apprentices studied at Aston University. This year you will join the University of Warwick, and graduate from the University of Warwick.',
        ],
      }),
    ).toBe('University of Warwick');
  });
  it('ignores the employer when the employer is itself a university', () => {
    expect(
      findUniversity({
        employer: 'University of Exeter',
        texts: ['Join the University of Exeter data team.'],
      }),
    ).toBeNull();
  });
});
