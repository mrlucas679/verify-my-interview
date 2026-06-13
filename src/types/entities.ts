// Data structures for entities extracted from evidence

export interface Entities {
  companies: string[];
  people: string[];
  emails: string[];
  domains: string[];
  urls: string[];
  phones: string[];
  money_requests: string[];
  job_titles: string[];
  /** Reply-To address when the evidence is a raw email with headers. */
  reply_to?: string;
  /** Originating sender IP extracted from Received: headers. */
  sender_ip?: string;
}
