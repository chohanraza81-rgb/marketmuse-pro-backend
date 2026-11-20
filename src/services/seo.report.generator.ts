
  // ── VALIDATE + FILL ──
  analysis = validateAndFillSections(analysis, niche, country, keywords, trendData, serpResults);

  // ✅ CRITICAL: TRUTH RECONCILIATION (must be after all fills)
  analysis = reconcileAll(analysis, keywords, country);
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];
  const sourcePullDate = new Date().toISOString().slice(0, 10);
  const actualSources: any[] = [];
  if (keywords.some((k: any) => k.dataSource === 'dataforseo' && (safeNumber(k.volume, 0) > 0 || safeNumber(k.cpc, 0) > 0 || (k.kd !== null && k.kd !== undefined && Number.isFinite(Number(k.kd)))))) actualSources.push({ data_type: 'Keyword metrics', source: 'DataForSEO', pull_date: sourcePullDate });
  if (trendSource === 'dataforseo') actualSources.push({ data_type: 'Search trends', source: 'DataForSEO Trends', pull_date: sourcePullDate });
  else if (trendSource === 'google_trends') actualSources.push({ data_type: 'Search trends', source: 'Google Trends', pull_date: sourcePullDate });
  else actualSources.push({ data_type: 'Search trends', source: 'Internal country pattern — modeled, not live search data', pull_date: sourcePullDate });
  if (serpResults.length > 0) actualSources.push({ data_type: 'SERP results', source: serpProvider, pull_date: sourcePullDate });
  analysis.current_state.data_sources = actualSources;

  dedupeCaseStudyTitles(safeArray(analysis.case_studies));
  cleanInsightPrefixes(analysis);

  // Country-specific data overrides (after reconcile so they aren't overwritten)
  const preloadedCalendar = getCalendarForCountry(country);
  const preloadedEditors = getEditorsForCountry(country);
  if (!analysis.ground_intel) analysis.ground_intel = {};
  analysis.ground_intel.cultural_calendar = preloadedCalendar.map((c: any) => ({
    period: c.period,
    behavior: String(c.behavior || '').replace(/mid-Q1 review/gi, 'Q1 close / Q2 start').replace(/mid-Q4/gi, 'Q3 close / Q4 start'),
    content_priority: c.contentPriority,
  }));
  analysis.ground_intel.editor_intelligence = preloadedEditors.map((e: any) => ({
    publication: e.site, da: null, what_works: e.whatWorks,
  }));

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || currencyInfo.us;
  const economics = getEconomics(country, analysis);

  analysis.serp_landscape = serpResults.slice(0, 10).map((r: any, i: number) => ({ position: i + 1, title: r.title || 'Untitled', link: r.link || null, da: null, words: null, backlinks: null, traffic: null }));
  const execSum = analysis.executive_summary || {};
  const currentState = analysis.current_state || {};
  const groundIntel = analysis.ground_intel || {};
  const magicGoldmine = analysis.magic_goldmine || {};
  const magicPlaybook = analysis.magic_playbook || {};
  const keyFindings = safeArray(analysis.key_findings);
  const competitive = analysis.competitive_landscape || {};
  const competitorTeardown = analysis.competitor_teardown || {};
  const roadmap = analysis.roadmap_90day || {};
  const financial = analysis.financial_projection || {};
  const unitEconomics = analysis.unit_economics || {};
  const breakEven = analysis.break_even_analysis || {};
  const sensitivity = analysis.sensitivity_analysis || {};
  const caseStudies = safeArray(analysis.case_studies);
  const dataLimitations = safeArray(analysis.data_limitations);

  let serp = Array.isArray(analysis.serp_landscape) ? analysis.serp_landscape.filter((s: any) => s.title && s.link).slice(0, 8) : [];
  if (serp.length === 0 && serpResults.length > 0) {
    serp = serpResults.slice(0, 8).map((r: any, i: number) => ({
      position: i + 1, title: r.title || 'Untitled', link: r.link || '#',
      da: null, words: null, backlinks: null, traffic: null,
      strengths: null, weaknesses: null, gap: null,
    }));
  }

  const languageSplitHeading = isMultilingual[country] ? '3.2  🌍 LANGUAGE SPLIT INTELLIGENCE' : '3.2  🌍 REGIONAL SEARCH VARIATIONS';
  const languageSplitIntro = isMultilingual[country]
    ? 'This section analyzes bilingual (English + local language) search dynamics.'
    : `This section analyzes regional search variations across ${countryNames[country]}.`;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD MARKDOWN
  // ═══════════════════════════════════════════════════════════════════════════
  let markdown = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nexlor
Real-Time Market Research | Intelligence Division
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    SEO RESEARCH REPORT

Prepared For:      ${safeString(options?.clientName || analysis.client_name, 'Client details pending')}
Website:            ${safeString(options?.website || analysis.client_website, 'Not supplied')}
Date:              ${today}
Reference:         ${reference}
Classification:    CONFIDENTIAL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE:
"${safeString(execSum.headline)}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 REPORT STANDARDS
Only source-backed metrics are presented as measured. Modeled estimates are labeled.
Missing client, analytics, competitor-provider or commercial inputs are shown as
"Not supplied" / "Not verified" and are not converted into performance claims.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP 3 FINDINGS (Ranked by Business Impact)

`;
  safeArray(execSum.top_findings).slice(0, 3).forEach((f: any) => {
    markdown += `┌──────────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ #${f.rank || ''} — ${f.priority || 'HIGH'}: ${safeString(f.title)}\n`;
    markdown += `├──────────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ 💰 Size of Prize: ${safeString(f.size_of_prize)}\n`;
    markdown += `│ 🎯 Root Cause: ${safeString(f.root_cause)}\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `📌 WHAT THIS MEANS FOR YOU\n${safeString(execSum.what_this_means)}\n\n`;
  markdown += `🚀 NEXT 90 DAYS — RECOMMENDED PRIORITIES\n`;
  safeArray(execSum.next_90_days).forEach((a: string, i: number) => markdown += `  ${i + 1}. ${a}\n`);
  markdown += `\n💵 PROJECTED ROI (6 MONTHS)\n`;
  markdown += `  Investment:           ${safeString(execSum.estimated_roi?.investment)}\n`;
  markdown += `  Projected Pipeline:   ${safeString(execSum.estimated_roi?.pipeline)}\n`;
  markdown += `  Projected ROI:        ${safeString(execSum.estimated_roi?.roi_percent)}\n`;
  markdown += `  Pipeline / Investment: ${safeString(execSum.estimated_roi?.pipeline_to_investment_ratio)}\n\n`;

  const health = execSum.health_score || {};
  markdown += `📊 OVERALL HEALTH SCORE\n\n`;
  markdown += `  Overall: ${health.overall || 0}/100   ${health.status || '🟡'}\n\n`;
  safeArray(health.breakdown).forEach((b: any) => {
    markdown += `  ${safeString(b.category).padEnd(20)} ${b.score || 0}/100  ${b.status || ''}\n`;
  });
  markdown += `\n`;

  markdown += `2. CURRENT STATE & BASELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 DATA SOURCES & PULL DATES

`;
  markdown += formatTable(
    ['Data Type', 'Source', 'Pull Date'],
    safeArray(currentState.data_sources).map((d: any) => [safeString(d.data_type), safeString(d.source), safeString(d.pull_date)])
  );
  markdown += `\n📊 CORE KPI DASHBOARD\n\n`;
  markdown += formatTable(
    ['Metric', 'Current', 'Previous', 'Change', 'Target'],
    safeArray(currentState.kpi_dashboard).map((k: any) => [safeString(k.metric), safeString(k.current), safeString(k.previous), safeString(k.change), safeString(k.target)])
  );
  markdown += `\n📝 NARRATIVE\n"${safeString(currentState.narrative)}"\n\n`;

  markdown += `2.5 KEYWORD PORTFOLIO — 50 TIERED KEYWORDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 TIER BREAKDOWN

  Tier 1 (Money Keywords):      14
  Tier 2 (Growth Keywords):     18
  Tier 3 (Long-tail Keywords):  18
  ─────────────────────────────────
  TOTAL:                        50

📈 PRIORITIZATION LOGIC

