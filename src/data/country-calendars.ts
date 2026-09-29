// src/data/country-calendars.ts
// Country-specific cultural buying calendars
// Different from generic Gemini output — these are pre-researched

export interface CalendarPeriod {
  period: string;
  behavior: string;
  contentPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'MAXIMUM';
}

export const COUNTRY_CALENDARS: Record<string, CalendarPeriod[]> = {
  us: [
    { period: 'Jan – Feb', behavior: '🟢 New Year resolutions, fresh budgets, B2B procurement kickoff', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Tax season, Q1 reviews, spring slowdown', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Pre-summer push, graduation season', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🟡 Summer slowdown, vacation period', contentPriority: 'MEDIUM' },
    { period: 'Sep – Oct', behavior: '🟢 Back-to-business, Q4 budget prep', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Holiday shopping, year-end deals, Black Friday/Cyber Monday', contentPriority: 'MAXIMUM' },
  ],
  gb: [
    { period: 'Jan – Feb', behavior: '🟢 New Year career moves, self-assessment tax return season', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟢 End of UK financial year (April 5), ISA season', contentPriority: 'MAXIMUM' },
    { period: 'May – Jun', behavior: '🟡 Spring bank holidays, half-term breaks', contentPriority: 'MEDIUM' },
    { period: 'Jul – Aug', behavior: '🟡 Summer holidays, school break', contentPriority: 'MEDIUM' },
    { period: 'Sep – Oct', behavior: '🟢 Back to work, Q4 planning, autumn budgets', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Christmas shopping, Boxing Day sales, year-end', contentPriority: 'MAXIMUM' },
  ],
  ca: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, RRSP contribution season (deadline March 1)', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟢 Tax season (April 30 deadline), spring thaw', contentPriority: 'MAXIMUM' },
    { period: 'May – Jun', behavior: '🟡 Victoria Day, Canada Day prep, summer kickoff', contentPriority: 'MEDIUM' },
    { period: 'Jul – Aug', behavior: '🟡 Summer holidays, Quebec construction holiday', contentPriority: 'MEDIUM' },
    { period: 'Sep – Oct', behavior: '🟢 Back to school, Q4 planning, Thanksgiving (Oct)', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Holiday shopping, Boxing Day, year-end', contentPriority: 'MAXIMUM' },
  ],
  au: [
    { period: 'Jan – Feb', behavior: '🟢 Post-summer new ventures, back to school, Australia Day (Jan 26)', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Autumn, Easter break, Anzac Day (Apr 25)', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 End of Financial Year (EOFY, June 30), tax planning', contentPriority: 'MAXIMUM' },
    { period: 'Jul – Aug', behavior: '🟢 New financial year, tax returns, EOFY sales', contentPriority: 'HIGH' },
    { period: 'Sep – Oct', behavior: '🟢 Spring, AFL/NRL finals, Q4 planning', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟡 Christmas shopping, summer holidays, year-end', contentPriority: 'MEDIUM' },
  ],
  de: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, Karneval/Fasching season, Q1 budgets', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Easter, tax season (Steuererklärung)', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Spring, Q2 push, Vatertag', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🔴 Sommerpause (summer break), Urlaubszeit', contentPriority: 'LOW' },
    { period: 'Sep – Oct', behavior: '🟢 Back to work, Oktoberfest, Q4 prep, Tag der Deutschen Einheit', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Christmas markets, Weihnachtszeit, year-end', contentPriority: 'MAXIMUM' },
  ],
  sg: [
    { period: 'Jan – Feb', behavior: '🟢 Chinese New Year (CNY), new budgets, ang bao season', contentPriority: 'MAXIMUM' },
    { period: 'Mar – Apr', behavior: '🟡 Qingming Festival, Hari Raya Puasa, mid-Q1 review', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Vesak Day, mid-year reviews, GSS (Great Singapore Sale)', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🟢 National Day (Aug 9), Q3 push, Hari Raya Haji', contentPriority: 'HIGH' },
    { period: 'Sep – Oct', behavior: '🟢 Mid-Autumn Festival, Deepavali, F1 season', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Christmas, year-end shopping, Orchard Road light-up', contentPriority: 'MAXIMUM' },
  ],
  sa: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, Vision 2030 initiatives, winter season', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Ramadan (dates vary), Eid al-Fitr, reduced business activity', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Eid al-Adha, summer prep, Q2 close', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🔴 Summer heat, Hajj period, expat holiday season', contentPriority: 'LOW' },
    { period: 'Sep – Oct', behavior: '🟢 Back to school, Saudi National Day (Sep 23), Q4 prep', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Riyadh Season, year-end spending, winter tourism', contentPriority: 'MAXIMUM' },
  ],
  ae: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, peak recruitment season, Dubai Shopping Festival', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Ramadan, Eid al-Fitr, reduced corporate activity', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Pre-summer hiring push, graduation season, Q2 close', contentPriority: 'MAXIMUM' },
    { period: 'Jul – Aug', behavior: '🔴 Summer exodus, expat holiday season, low activity', contentPriority: 'LOW' },
    { period: 'Sep – Oct', behavior: '🟢 Autumn recruitment acceleration, return to work, Q4 planning', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 UAE National Day (Dec 2), year-end, GITEX post-event', contentPriority: 'HIGH' },
  ],
  pk: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, peak wedding season, corporate budget resets', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟡 Ramadan, Eid al-Fitr, reduced business activity', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Pre-monsoon, Eid al-Adha, Q2 close', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🟡 Monsoon season, Independence Day (Aug 14), back to school prep', contentPriority: 'MEDIUM' },
    { period: 'Sep – Oct', behavior: '🟢 Q4 push, Iqbal Day (Nov 9), business restart', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Wedding season, year-end, Quaid-e-Azam Day (Dec 25)', contentPriority: 'MAXIMUM' },
  ],
  in: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, Union Budget, wedding season, Republic Day', contentPriority: 'MAXIMUM' },
    { period: 'Mar – Apr', behavior: '🟢 Financial year-end (Mar 31), Gudi Padwa, Baisakhi, IPL start', contentPriority: 'MAXIMUM' },
    { period: 'May – Jun', behavior: '🔴 Peak summer, IPL playoff season, school vacations', contentPriority: 'LOW' },
    { period: 'Jul – Aug', behavior: '🟡 Monsoon, Independence Day (Aug 15), Raksha Bandhan', contentPriority: 'MEDIUM' },
    { period: 'Sep – Oct', behavior: '🟢 Navratri, Durga Puja, Dussehra, Diwali — peak festive buying', contentPriority: 'MAXIMUM' },
    { period: 'Nov – Dec', behavior: '🟢 Wedding season, year-end, Christmas', contentPriority: 'HIGH' },
  ],
  tr: [
    { period: 'Jan – Feb', behavior: '🟢 New Year, winter slowdown, Q1 planning', contentPriority: 'HIGH' },
    { period: 'Mar – Apr', behavior: '🟢 Ramazan Bayramı (Eid al-Fitr), spring season', contentPriority: 'HIGH' },
    { period: 'May – Jun', behavior: '🟢 Spring, Q2 push, tourism season starts', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🔴 Summer holidays, Kurban Bayramı, low B2B activity', contentPriority: 'LOW' },
    { period: 'Sep – Oct', behavior: '🟢 Back to work, Cumhuriyet Bayramı (Oct 29), Q4 push', contentPriority: 'HIGH' },
    { period: 'Nov – Dec', behavior: '🟢 Year-end, New Year prep, winter season', contentPriority: 'HIGH' },
  ],
  my: [
    { period: 'Jan – Feb', behavior: '🟢 Chinese New Year, new budgets, ang pow season', contentPriority: 'MAXIMUM' },
    { period: 'Mar – Apr', behavior: '🟡 Hari Raya Puasa, Ramadan, mid-Q1 review', contentPriority: 'MEDIUM' },
    { period: 'May – Jun', behavior: '🟢 Wesak Day, Gawai Dayak, Q2 push', contentPriority: 'HIGH' },
    { period: 'Jul – Aug', behavior: '🟢 Merdeka (Aug 31), National Day, Q3 activities', contentPriority: 'HIGH' },
    { period: 'Sep – Oct', behavior: '🟡 Malaysia Day (Sep 16), Deepavali, mid-Q4', contentPriority: 'MEDIUM' },
    { period: 'Nov – Dec', behavior: '🟢 Year-end sales, Christmas, school holidays', contentPriority: 'MAXIMUM' },
  ],
};

export function getCalendarForCountry(country: string): CalendarPeriod[] {
  return COUNTRY_CALENDARS[country?.toLowerCase()] || COUNTRY_CALENDARS.us;
}
