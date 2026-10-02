import type { MailStore } from './store.js';
import type { Request } from 'express';
export interface Operator {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'viewer';
}
export interface MailSummary {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  unread: boolean;
  preview?: string;
}
export interface MailMessage extends MailSummary {
  text: string;
  html?: string;
  messageId?: string;
  replyTo?: string;
}
export interface MailProvider {
  list(input: { limit: 25 | 50; query: string; unread: boolean }): Promise<MailSummary[]>;
  get(id: string): Promise<MailMessage>;
  markRead(id: string): Promise<void>;
  /** Move a received message to Trash; never permanently expunge it. Optional for custom providers. */
  trash?(id: string): Promise<void>;
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    messageId: string;
    inReplyTo?: string;
    unsubscribeUrl?: string;
  }): Promise<void>;
  close?(): Promise<void>;
}
export interface CookieMailConfig {
  store: MailStore;
  workspace?: string;
  provider: MailProvider;
  auth(req: Request): Operator | null | Promise<Operator | null>;
  publicOrigin: string;
  publicBasePath?: string;
  brand?: string;
  /** Called for diagnostics; never exposed to clients. */
  logger?: { error(message: string, error: unknown): void };
}
export type BlockKind = 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';
export interface Block {
  id: string;
  kind: BlockKind;
  content: string;
  url?: string;
}
export interface Template {
  id: string;
  name: string;
  subject: string;
  blocks: Block[];
  variables: string[];
  updatedAt: string;
}
export interface Subscriber {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  tags: string[];
  status: 'subscribed' | 'unsubscribed';
  createdAt: string;
}

/** A per-recipient copy accepted by the provider, not a delivery/read receipt. */
export interface SentMessage {
  id: string;
  jobId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  sentAt: string;
}
