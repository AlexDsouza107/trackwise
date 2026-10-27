/** Illustrative region grouping of states (not the real AICTE regional office map). */
export const REGIONS = ['Northern', 'Southern', 'Eastern', 'Western', 'Central'] as const;
export type Region = (typeof REGIONS)[number];

const BY_STATE: Record<string, Region> = {
  Maharashtra: 'Western', Gujarat: 'Western', Goa: 'Western',
  Rajasthan: 'Northern', 'Uttar Pradesh': 'Northern', Delhi: 'Northern', Punjab: 'Northern', Haryana: 'Northern', Uttarakhand: 'Northern',
  Karnataka: 'Southern', 'Tamil Nadu': 'Southern', Kerala: 'Southern', Telangana: 'Southern', 'Andhra Pradesh': 'Southern',
  'West Bengal': 'Eastern', Assam: 'Eastern', Odisha: 'Eastern', Bihar: 'Eastern', Jharkhand: 'Eastern',
  'Madhya Pradesh': 'Central', Chhattisgarh: 'Central',
};

export const regionOf = (state: string): Region => BY_STATE[state] ?? 'Central';
