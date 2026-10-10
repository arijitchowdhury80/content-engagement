/**
 * Neutral default instance — a look-less, brand-less scaffold so the widget
 * never crashes before attributes/slots are applied. Real branding (logo,
 * title, attribution, sample questions, source facets) is supplied per embed
 * via <algolia-chat> attributes + child elements and merged in by
 * config/runtime.ts. No Algolia-specific values appear here.
 */
import type { InstanceConfig } from './instance';
import { defaultStrings } from './strings';

export const defaultInstance: InstanceConfig = {
  id: 'default',
  brandName: '',
  productTitle: '',
  subtitle: '',
  logo: { header: '', mark: '' },
  newChatIcon: '',
  poweredBy: { label: '', logo: '' },
  corpusName: '',
  theme: '',
  agents: {
    primary: { key: 'primary', id: '', label: 'Assistant', accentToken: '--algolia-agent-primary' },
    specialists: [],
    classifier: undefined,
  },
  sampleQuestions: [],
  sampleQuestionsGroupCap: 3,
  sampleQuestionsPerGroup: 1,
  sourceFacets: [],
  sourceDisplay: undefined,
  disclaimer: '',
  canonicalBaseUrl: '',
  strings: defaultStrings,
  welcome: { present: false, show: true },
  userAvatar: '',
  defaultOpenMode: 'normal',
  launcherIcon: '',
  icons: {},
  autoEngage: true,
  discoveryEnabled: false,
  analyzingTimeoutMs: 30_000,
  autoEngageToggle: false,
};
