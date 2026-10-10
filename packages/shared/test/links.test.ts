import { describe, expect, it } from 'vitest';
import { linkKind, rankLinks } from '../src/links.ts';

describe('linkKind', () => {
  it.each([
    ['https://thales.wd3.myworkdayjobs.com/Careers/job/x', 'Thales UK Limited', 'official'],
    ['https://careers.thalesgroup.com/global/en/job/R0337760', 'Thales UK Limited', 'official'],
    [
      'https://www.osborneclarke.com/legal-technology-apprenticeship',
      'Osborne Clarke Services',
      'official',
    ],
    ['https://higherin.com/redirect?job_id=45830', 'Thales', 'official'],
    [
      'https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/VAC1',
      'Acme',
      'government',
    ],
    ['https://jobs.army.mod.uk/roles/x', 'The Army', 'government'],
    ['https://becomeanapprentice.qa.com/jobs/8252778-cyber', 'Amtico', 'provider'],
    ['https://higherin.com/jobs/45830/thales/x', 'Thales', 'board'],
    ['https://www.adzuna.co.uk/jobs/land/ad/5879934988', 'Barclays', 'board'],
    ['https://www.jobleads.com/gb/job/ai-engineer', 'Thales', 'third_party'],
    ['https://talents.studysmarter.co.uk/companies/pfizer/data', 'Pfizer', 'third_party'],
  ])('%s (%s) → %s', (url, employer, kind) => {
    expect(linkKind(url, employer)).toBe(kind);
  });
});

describe('rankLinks', () => {
  it("puts the employer's own page first and copy-sites last", () => {
    const links = rankLinks({
      employer_name: 'Barclays',
      url: 'https://www.adzuna.co.uk/jobs/land/ad/1',
      apply_url: null,
      sources: [
        { source: 'adzuna', url: 'https://www.adzuna.co.uk/jobs/land/ad/1' },
        { source: 'google_jobs', url: 'https://uk.jobrapido.com/x' },
        { source: 'employer:barclays', url: 'https://barclays.wd3.myworkdayjobs.com/x' },
        {
          source: 'faa',
          url: 'https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/1',
        },
      ],
    });
    expect(links.map((l) => l.kind)).toEqual(['official', 'government', 'board', 'third_party']);
  });
  it('skips links known to be dead', () => {
    const links = rankLinks({
      employer_name: 'Acme',
      url: 'https://acme.wd3.myworkdayjobs.com/x',
      apply_url: null,
      sources: [{ source: 'google_jobs', url: 'https://acme.wd3.myworkdayjobs.com/x', dead: true }],
    });
    expect(links).toHaveLength(0); // the caller falls back to the employer's careers site
  });
});
