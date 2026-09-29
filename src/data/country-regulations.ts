// src/data/country-regulations.ts
// Country-specific regulatory + compliance facts

export interface CountryRegulations {
  dataPrivacy: string;
  taxFramework: string;
  keyCompliance: string;
  localAuthority: string;
}

export const COUNTRY_REGULATIONS: Record<string, CountryRegulations> = {
  us: {
    dataPrivacy: 'CCPA / CPRA (California), state-level privacy laws',
    taxFramework: 'Federal + State income tax, sales tax varies by state',
    keyCompliance: 'FTC advertising guidelines, SEC for public cos',
    localAuthority: 'IRS, FTC, State Attorney Generals',
  },
  gb: {
    dataPrivacy: 'UK GDPR + Data Protection Act 2018',
    taxFramework: 'VAT 20%, Corporation Tax 25%',
    keyCompliance: 'ICO registration for data handlers',
    localAuthority: 'HMRC, ICO, CMA',
  },
  ca: {
    dataPrivacy: 'PIPEDA (federal) + Quebec Law 25',
    taxFramework: 'GST/HST 5-15%, Corporate tax 15-26.5%',
    keyCompliance: 'Bilingual (EN/FR) requirements for federal services',
    localAuthority: 'CRA, OPC, Competition Bureau',
  },
  au: {
    dataPrivacy: 'Privacy Act 1988 + Australian Privacy Principles',
    taxFramework: 'GST 10%, Corporate tax 25-30%',
    keyCompliance: 'ACCC advertising standards',
    localAuthority: 'ATO, OAIC, ASIC',
  },
  de: {
    dataPrivacy: 'GDPR + BDSG (Federal Data Protection Act)',
    taxFramework: 'VAT 19%, Corporate tax ~30% (incl. solidarity)',
    keyCompliance: 'Impressum requirement (legal disclosure)',
    localAuthority: 'Bundesfinanzministerium, BfDI, Bundeskartellamt',
  },
  sg: {
    dataPrivacy: 'PDPA (Personal Data Protection Act)',
    taxFramework: 'GST 9%, Corporate tax 17%',
    keyCompliance: 'ACRA registration for businesses',
    localAuthority: 'IRAS, PDPC, ACRA',
  },
  sa: {
    dataPrivacy: 'PDPL (Personal Data Protection Law)',
    taxFramework: 'Zakat 2.5%, Corporate tax 20% for foreign',
    keyCompliance: 'Vision 2030 alignment, Saudization requirements',
    localAuthority: 'ZATCA, SDAIA, MCI',
  },
  ae: {
    dataPrivacy: 'UAE PDPL + DIFC/ADGM data protection',
    taxFramework: 'Corporate tax 9% (above AED 375K), VAT 5%',
    keyCompliance: 'Free zone license, Emiratisation quotas',
    localAuthority: 'FTA, UAE Central Bank, Ministry of Economy',
  },
  pk: {
    dataPrivacy: 'PECA (Prevention of Electronic Crimes Act)',
    taxFramework: 'Sales tax 17-18%, Corporate tax 29%',
    keyCompliance: 'SECP registration, FBR tax filing',
    localAuthority: 'FBR, SECP, PTA',
  },
  in: {
    dataPrivacy: 'DPDP Act 2023 (Digital Personal Data Protection)',
    taxFramework: 'GST 18% (services), Corporate tax 22-30%',
    keyCompliance: 'BIS certification for electronics, GST registration',
    localAuthority: 'CBDT, MeitY, BIS, DGFT',
  },
  tr: {
    dataPrivacy: 'KVKK (Kişisel Verilerin Korunması Kanunu)',
    taxFramework: 'KDV 20%, Corporate tax 25%',
    keyCompliance: 'Turkish Trade Registry, tax ID requirement',
    localAuthority: 'GİB, KVKK, Ticaret Bakanlığı',
  },
  my: {
    dataPrivacy: 'PDPA 2010 (Personal Data Protection Act)',
    taxFramework: 'SST 6-10%, Corporate tax 17-24%',
    keyCompliance: 'SSM registration, halal certification for relevant sectors',
    localAuthority: 'LHDN, JPDP, SSM',
  },
};

export function getRegulationsForCountry(country: string): CountryRegulations {
  return COUNTRY_REGULATIONS[country?.toLowerCase()] || COUNTRY_REGULATIONS.us;
}
