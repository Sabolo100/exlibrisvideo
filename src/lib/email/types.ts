/** E-mail message types shared by the providers, templates and the job handler. */

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  /** short tag for logs / the console provider's preview file name, e.g. "collection_ready" */
  kind?: string;
}

export type MailProviderName = 'smtp' | 'resend' | 'console';

export interface SendResult {
  provider: MailProviderName;
  /** provider message id (SMTP Message-ID, Resend id, or the console preview path) */
  id?: string;
}

export interface MailProvider {
  name: MailProviderName;
  send(message: MailMessage, from: string): Promise<SendResult>;
}
