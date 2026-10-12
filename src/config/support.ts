// Optional "support this project" card. Ships disabled and empty.
//
// To enable it, the maintainer adds only links and addresses they control and have verified,
// then sets `enabled: true`. The card shows them as plain links and copyable text. It never
// connects a wallet, requests a signature, shows donation totals or contacts any service.
export interface SupportLink {
  label: string;
  url: string;
}

export interface SupportAddress {
  /** Network name as the maintainer wants it shown, e.g. "Ethereum". */
  network: string;
  /** A recipient address the maintainer controls. Never a token contract address. */
  address: string;
  note?: string;
}

export interface SupportConfig {
  enabled: boolean;
  message: string;
  links: SupportLink[];
  addresses: SupportAddress[];
}

export const SUPPORT: SupportConfig = {
  enabled: false,
  message: '',
  links: [],
  addresses: [],
};

/** True only when enabled and there is something verified to show. */
export function supportReady(c: SupportConfig = SUPPORT): boolean {
  return c.enabled && (c.links.some((l) => /^https:\/\//.test(l.url)) || c.addresses.some((a) => a.address.trim().length > 0));
}
